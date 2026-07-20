import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type SeoulRealtimeQuery = {
  placeId: string;
  areaName: string;
  areaCode?: string;
};

type SeoulRealtimePopulationItem = {
  congestionLevel: string;
  congestionMessage?: string;
  populationMin?: number;
  populationMax?: number;
  observedAt: string;
};

type SeoulRealtimeCityData = {
  resultCode: string;
  resultMessage: string;
  areaName: string;
  areaCode: string;
  population: SeoulRealtimePopulationItem[];
};

export type SeoulRealtimeResponse = {
  cityData: SeoulRealtimeCityData;
};

export type NormalizedSeoulRealtimeSignal = {
  placeId: string;
  dimension: "crowd";
  valueCode: "quiet" | "normal" | "busy" | "packed";
  valueText: string;
  valueNumber?: number;
  unit?: "명";
  sourceKey: "seoul_realtime_city";
  sourceType: "official_live";
  sourceName: "서울시 실시간 도시데이터";
  attributionText: "서울특별시";
  observedAt: string;
  fetchedAt: string;
  expiresAt: string;
  confidenceScore: 0.8;
  isEstimated: true;
  externalObservationId: string;
  areaName: string;
  areaCode: string;
  congestionMessage?: string;
};

export type SeoulRealtimeAdapterOptions = {
  serviceKey: string;
  ttlSeconds: number;
  endpointUrl?: string;
  now?: () => Date;
};

const defaultEndpoint = "https://openapi.seoul.go.kr:8088";
const sourceName = "서울시 실시간 도시데이터";
const attribution = "서울특별시";

export function createSeoulRealtimeAdapter(
  options: SeoulRealtimeAdapterOptions,
): PublicDataAdapter<SeoulRealtimeQuery, SeoulRealtimeResponse, NormalizedSeoulRealtimeSignal> {
  const serviceKey = options.serviceKey.trim();
  const endpoint = validateEndpoint(options.endpointUrl ?? defaultEndpoint);
  const now = options.now ?? (() => new Date());
  if (!serviceKey) throw new Error("Seoul realtime service key is required");
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 300 || options.ttlSeconds > 3_600) {
    throw new Error("Seoul realtime TTL must be between 300 and 3600 seconds");
  }

  const adapter: PublicDataAdapter<SeoulRealtimeQuery, SeoulRealtimeResponse, NormalizedSeoulRealtimeSignal> = {
    sourceKey: "seoul_realtime_city",

    validateQuery(query) {
      validatePlaceId(query.placeId);
      if (!isAreaName(query.areaName)) throw new Error("invalid Seoul realtime areaName");
      if (query.areaCode !== undefined && !isAreaCode(query.areaCode)) {
        throw new Error("invalid Seoul realtime areaCode");
      }
    },

    cacheKey(query) {
      return `${query.areaCode ?? "name"}:${encodeURIComponent(query.areaName)}`;
    },

    async fetch(query, context) {
      const url = new URL(
        `${encodeURIComponent(serviceKey)}/json/citydata/1/5/${encodeURIComponent(query.areaName)}`,
        `${endpoint}/`,
      );
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      if (!isRecord(raw)) throw new Error("missing Seoul realtime response");
      const root = raw["SeoulRtd.citydata"] ?? raw.CITYDATA ?? raw.citydata;
      if (!isRecord(root)) throw new Error("missing Seoul realtime citydata root");

      const result = root.RESULT;
      if (!isRecord(result) || typeof result.CODE !== "string" || typeof result.MESSAGE !== "string") {
        throw new Error("missing Seoul realtime result");
      }
      if (result.CODE !== "INFO-000") throw new Error("Seoul realtime provider error");

      const areaName = nonEmptyString(root.AREA_NM) ? root.AREA_NM : undefined;
      const areaCode = nonEmptyString(root.AREA_CD) ? root.AREA_CD : undefined;
      if (!areaName || !areaCode) throw new Error("missing Seoul realtime area identity");

      const population = root.LIVE_PPLTN_STTS;
      if (!Array.isArray(population)) throw new Error("missing Seoul realtime population data");

      return {
        cityData: {
          resultCode: result.CODE,
          resultMessage: result.MESSAGE,
          areaName,
          areaCode,
          population: population.map(validatePopulationItem),
        },
      };
    },

    normalize(raw, query) {
      if (raw.cityData.areaName !== query.areaName.trim()) {
        throw new Error("Seoul realtime area identity mismatch");
      }
      if (query.areaCode !== undefined && raw.cityData.areaCode !== query.areaCode) {
        throw new Error("Seoul realtime area code mismatch");
      }
      const fetchedAt = now();
      return raw.cityData.population.map((item) => {
        const observedAt = parseProviderTimestamp(item.observedAt);
        if (!observedAt) throw new Error("invalid Seoul realtime observation time");
        const expiresAt = new Date(observedAt.getTime() + options.ttlSeconds * 1_000);
        const valueCode = crowdValueCode(item.congestionLevel);
        const population = item.populationMax ?? item.populationMin;
        return {
          placeId: query.placeId,
          dimension: "crowd" as const,
          valueCode,
          valueText: `서울 실시간 혼잡도: ${item.congestionLevel}`,
          ...(population === undefined ? {} : { valueNumber: population, unit: "명" as const }),
          sourceKey: "seoul_realtime_city" as const,
          sourceType: "official_live" as const,
          sourceName,
          attributionText: attribution,
          observedAt: observedAt.toISOString(),
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          confidenceScore: 0.8 as const,
          isEstimated: true as const,
          externalObservationId: `${raw.cityData.areaCode}:${item.observedAt}:${valueCode}`,
          areaName: raw.cityData.areaName,
          areaCode: raw.cityData.areaCode,
          ...(item.congestionMessage ? { congestionMessage: item.congestionMessage } : {}),
        };
      });
    },

    getObservedAt(item) {
      return validDate(item.observedAt);
    },

    getExpiresAt(item) {
      return validDate(item.expiresAt);
    },

    getAttribution() {
      return attribution;
    },

    async healthCheck(query, context): Promise<AdapterHealthResult> {
      const startedAt = Date.now();
      try {
        adapter.validateQuery(query);
        adapter.validateResponse(await adapter.fetch(query, context));
        return { status: "healthy", checkedAt: now().toISOString(), responseTimeMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
          checkedAt: now().toISOString(),
          responseTimeMs: Date.now() - startedAt,
          message: "Seoul realtime source check failed",
        };
      }
    },
  };

  return adapter;
}

function validatePopulationItem(value: unknown): SeoulRealtimePopulationItem {
  if (!isRecord(value) || !nonEmptyString(value.AREA_CONGEST_LVL) || !nonEmptyString(value.PPLTN_TIME)) {
    throw new Error("invalid Seoul realtime population item");
  }
  if (!parseProviderTimestamp(value.PPLTN_TIME)) throw new Error("invalid Seoul realtime population time");
  const populationMin = optionalPopulation(value.AREA_PPLTN_MIN);
  const populationMax = optionalPopulation(value.AREA_PPLTN_MAX);
  if (populationMin !== undefined && populationMax !== undefined && populationMin > populationMax) {
    throw new Error("invalid Seoul realtime population range");
  }
  if (value.AREA_CONGEST_MSG !== undefined && typeof value.AREA_CONGEST_MSG !== "string") {
    throw new Error("invalid Seoul realtime congestion message");
  }
  return {
    congestionLevel: value.AREA_CONGEST_LVL,
    ...(typeof value.AREA_CONGEST_MSG === "string" && value.AREA_CONGEST_MSG.trim()
      ? { congestionMessage: value.AREA_CONGEST_MSG.trim().slice(0, 300) }
      : {}),
    ...(populationMin === undefined ? {} : { populationMin }),
    ...(populationMax === undefined ? {} : { populationMax }),
    observedAt: value.PPLTN_TIME,
  };
}

function crowdValueCode(value: string): NormalizedSeoulRealtimeSignal["valueCode"] {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (normalized === "여유") return "quiet";
  if (normalized === "보통") return "normal";
  if (normalized === "약간붐빔" || normalized === "붐빔") return "busy";
  if (normalized === "매우붐빔" || normalized === "혼잡") return "packed";
  throw new Error("unsupported Seoul realtime congestion level");
}

function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Seoul realtime endpoint must be an HTTPS origin");
  }
  return url.toString().replace(/\/$/, "");
}

function validatePlaceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/.test(value)) throw new Error("invalid placeId");
}

function isAreaName(value: string): boolean {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 100 && !/[\u0000-\u001f]/.test(value);
}

function isAreaCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

function parseProviderTimestamp(value: string): Date | null {
  const normalized = value.trim().replace(/\./g, "-").replace(/\//g, "-").replace("T", " ");
  const withTimezone = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/);
  if (withTimezone) {
    const seconds = withTimezone[3] ?? "00";
    const parsed = new Date(`${withTimezone[1]}T${withTimezone[2]}:${seconds}+09:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const iso = new Date(value);
  return Number.isFinite(iso.getTime()) ? iso : null;
}

function optionalPopulation(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000_000) throw new Error("invalid Seoul realtime population");
  return parsed;
}

function validDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

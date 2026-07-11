import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type NationalTrafficQuery = {
  placeId: string;
  roadType: "all" | "ex" | "its";
  routeNo?: string;
  direction?: "all" | "up" | "down" | "start" | "end";
  bbox?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
};

type NationalTrafficItem = {
  roadName: string;
  roadDrcType?: string;
  linkNo?: string;
  linkId: string;
  startNodeId?: string;
  endNodeId?: string;
  speed: string;
  travelTime?: string;
  createdDate: string;
};

export type NationalTrafficResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      totalCount: string | number;
      items: { item: NationalTrafficItem[] };
    };
  };
};

export type NormalizedNationalTrafficSignal = {
  placeId: string;
  dimension: "road_traffic";
  valueCode: "smooth" | "slow" | "blocked";
  valueText: string;
  roadName: string;
  speedKph: number;
  sourceKey: "national_traffic";
  sourceType: "official_live";
  sourceName: "국가교통정보센터 교통소통정보";
  attributionText: "국토교통부";
  observedAt: string;
  fetchedAt: string;
  expiresAt: string;
  confidenceScore: 0.85;
  isEstimated: true;
  externalObservationId: string;
};

export type NationalTrafficAdapterOptions = {
  serviceKey: string;
  ttlSeconds: number;
  now?: () => Date;
};

const endpoint = "https://openapi.its.go.kr:9443/trafficInfo";
const attribution = "국가교통정보센터 교통소통정보";

export function createNationalTrafficAdapter(
  options: NationalTrafficAdapterOptions,
): PublicDataAdapter<NationalTrafficQuery, NationalTrafficResponse, NormalizedNationalTrafficSignal> {
  const serviceKey = options.serviceKey.trim();
  const now = options.now ?? (() => new Date());
  if (!serviceKey) throw new Error("National traffic service key is required");
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds < 30 || options.ttlSeconds > 3_600) {
    throw new Error("National traffic TTL must be between 30 and 3600 seconds");
  }

  const adapter: PublicDataAdapter<NationalTrafficQuery, NationalTrafficResponse, NormalizedNationalTrafficSignal> = {
    sourceKey: "national_traffic",

    validateQuery(query) {
      validatePlaceId(query.placeId);
      if (!(["all", "ex", "its"] as const).includes(query.roadType)) throw new Error("invalid roadType");
      if (query.roadType === "all") {
        validateBbox(query.bbox);
        if (query.routeNo !== undefined || query.direction !== undefined) throw new Error("all traffic query cannot use route filters");
        return;
      }
      if (!query.routeNo || !/^\d{1,6}$/.test(query.routeNo)) throw new Error("routeNo is required");
      if (!query.direction || !(["all", "up", "down", "start", "end"] as const).includes(query.direction)) {
        throw new Error("direction is required");
      }
      if (query.bbox !== undefined) validateBbox(query.bbox);
    },

    cacheKey(query) {
      return query.roadType === "all"
        ? `${query.placeId}:all:${bboxKey(query.bbox!)}`
        : `${query.placeId}:${query.roadType}:${query.routeNo}:${query.direction}${query.bbox ? `:${bboxKey(query.bbox)}` : ""}`;
    },

    async fetch(query, context) {
      const url = new URL(endpoint);
      url.searchParams.set("apiKey", serviceKey);
      url.searchParams.set("type", query.roadType);
      url.searchParams.set("getType", "json");
      if (query.roadType !== "all") {
        url.searchParams.set("routeNo", query.routeNo!);
        url.searchParams.set("drcType", query.direction!);
      }
      if (query.bbox) appendBbox(url, query.bbox);
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      if (!isRecord(raw) || !isRecord(raw.response) || !isRecord(raw.response.header) || !isRecord(raw.response.body)) {
        throw new Error("missing response");
      }
      const header = raw.response.header;
      const body = raw.response.body;
      if (String(header.resultCode) !== "0" || typeof header.resultMsg !== "string") throw new Error("provider error");
      if (!isRecord(body.items) || !Array.isArray(body.items.item) || !isCount(body.totalCount)) {
        throw new Error("invalid body");
      }
      const items = body.items.item.map(validateTrafficItem);
      if (items.length === 0) throw new Error("empty traffic items");
      return {
        response: {
          header: { resultCode: String(header.resultCode), resultMsg: header.resultMsg },
          body: { totalCount: body.totalCount, items: { item: items } },
        },
      };
    },

    normalize(raw, query) {
      const fetchedAt = now();
      return raw.response.body.items.item.map((item) => {
        const observedAt = parseCompactKoreaTimestamp(item.createdDate);
        if (!observedAt) throw new Error("invalid provider observation time");
        const speedKph = numericString(item.speed, 0, 250);
        const expiresAt = new Date(observedAt.getTime() + options.ttlSeconds * 1_000);
        return {
          placeId: query.placeId,
          dimension: "road_traffic" as const,
          valueCode: trafficValueCode(speedKph),
          valueText: `${item.roadName} ${speedKph}km/h`,
          roadName: item.roadName,
          speedKph,
          sourceKey: "national_traffic" as const,
          sourceType: "official_live" as const,
          sourceName: attribution,
          attributionText: "국토교통부" as const,
          observedAt: observedAt.toISOString(),
          fetchedAt: fetchedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          confidenceScore: 0.85 as const,
          isEstimated: true as const,
          externalObservationId: `${item.linkId}:${item.createdDate}`,
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
          message: "National traffic source check failed",
        };
      }
    },
  };

  return adapter;
}

function validateTrafficItem(value: unknown): NationalTrafficItem {
  if (!isRecord(value) || !nonEmpty(value.roadName) || !nonEmpty(value.linkId) || !nonEmpty(value.createdDate)) {
    throw new Error("invalid traffic item");
  }
  const speed = stringOrNumber(value.speed);
  numericString(speed, 0, 250);
  if (!parseCompactKoreaTimestamp(value.createdDate)) throw new Error("invalid traffic observation time");
  const optionalFields = ["roadDrcType", "linkNo", "startNodeId", "endNodeId", "travelTime"] as const;
  for (const field of optionalFields) {
    if (value[field] !== undefined && typeof value[field] !== "string" && typeof value[field] !== "number") {
      throw new Error("invalid traffic item field");
    }
  }
  return {
    roadName: value.roadName,
    linkId: value.linkId,
    speed,
    createdDate: value.createdDate,
    ...optionalStringFields(value, optionalFields),
  };
}

function validatePlaceId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/.test(value)) throw new Error("invalid placeId");
}

function validateBbox(value: NationalTrafficQuery["bbox"]): asserts value is NonNullable<NationalTrafficQuery["bbox"]> {
  if (!value) throw new Error("bbox is required");
  const { minLng, maxLng, minLat, maxLat } = value;
  if (
    ![minLng, maxLng, minLat, maxLat].every(Number.isFinite) ||
    minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 ||
    minLng >= maxLng || minLat >= maxLat
  ) {
    throw new Error("invalid bbox");
  }
}

function appendBbox(url: URL, bbox: NonNullable<NationalTrafficQuery["bbox"]>): void {
  url.searchParams.set("minX", String(bbox.minLng));
  url.searchParams.set("maxX", String(bbox.maxLng));
  url.searchParams.set("minY", String(bbox.minLat));
  url.searchParams.set("maxY", String(bbox.maxLat));
}

function bboxKey(bbox: NonNullable<NationalTrafficQuery["bbox"]>): string {
  return [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat].map((value) => value.toFixed(6)).join(":");
}

function trafficValueCode(speedKph: number): NormalizedNationalTrafficSignal["valueCode"] {
  if (speedKph >= 50) return "smooth";
  if (speedKph >= 20) return "slow";
  return "blocked";
}

function parseCompactKoreaTimestamp(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  return validDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`);
}

function validDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function numericString(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("invalid numeric value");
  return parsed;
}

function stringOrNumber(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("invalid string value");
  return String(value);
}

function optionalStringFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) => value[field] === undefined ? [] : [[field, String(value[field])]]),
  );
}

function isCount(value: unknown): value is string | number {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

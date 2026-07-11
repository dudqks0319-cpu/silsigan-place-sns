import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type KmaWeatherQuery = {
  placeId: string;
  nx: number;
  ny: number;
  baseDate: string;
  baseTime: string;
};

type KmaWeatherItem = {
  baseDate: string;
  baseTime: string;
  category: string;
  nx: number;
  ny: number;
  obsrValue: string;
};

export type KmaWeatherResponse = {
  response: {
    header: {
      resultCode: string;
      resultMsg: string;
    };
    body: {
      totalCount: number;
      items: {
        item: KmaWeatherItem[];
      };
    };
  };
};

export type NormalizedKmaWeatherSignal = {
  placeId: string;
  dimension: "weather";
  valueCode: "clear" | "rain" | "snow" | "windy" | "storm";
  valueText: string;
  temperatureC?: number;
  precipitationMm?: number;
  windSpeedMps?: number;
  sourceKey: "kma_weather";
  sourceType: "official_periodic";
  sourceName: "기상청 단기예보 조회서비스";
  attributionText: "기상청";
  observedAt: string;
  fetchedAt: string;
  expiresAt: string;
  confidenceScore: 0.9;
  isEstimated: false;
  externalObservationId: string;
};

export type KmaWeatherAdapterOptions = {
  serviceKey: string;
  ttlSeconds: number;
  now?: () => Date;
};

const kmaNowcastUrl = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const attribution = "기상청 단기예보 조회서비스";

export function createKmaWeatherAdapter(
  options: KmaWeatherAdapterOptions,
): PublicDataAdapter<KmaWeatherQuery, KmaWeatherResponse, NormalizedKmaWeatherSignal> {
  const serviceKey = options.serviceKey.trim();
  const now = options.now ?? (() => new Date());
  if (!serviceKey) {
    throw new Error("KMA service key is required");
  }
  if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new Error("KMA TTL is required");
  }

  const adapter: PublicDataAdapter<KmaWeatherQuery, KmaWeatherResponse, NormalizedKmaWeatherSignal> = {
    sourceKey: "kma_weather",

    validateQuery(query) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,99}$/.test(query.placeId)) throw new Error("invalid placeId");
      if (!Number.isInteger(query.nx) || query.nx < 1 || query.nx > 200) throw new Error("invalid nx");
      if (!Number.isInteger(query.ny) || query.ny < 1 || query.ny > 200) throw new Error("invalid ny");
      if (!/^\d{8}$/.test(query.baseDate) || !/^\d{4}$/.test(query.baseTime)) throw new Error("invalid base time");
      if (!parseKoreaTimestamp(query.baseDate, query.baseTime)) throw new Error("invalid base timestamp");
    },

    cacheKey(query) {
      return `${query.baseDate}:${query.baseTime}:${query.nx}:${query.ny}`;
    },

    async fetch(query, context) {
      const url = new URL(kmaNowcastUrl);
      url.searchParams.set("ServiceKey", serviceKey);
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("numOfRows", "20");
      url.searchParams.set("dataType", "JSON");
      url.searchParams.set("base_date", query.baseDate);
      url.searchParams.set("base_time", query.baseTime);
      url.searchParams.set("nx", String(query.nx));
      url.searchParams.set("ny", String(query.ny));
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      if (!isRecord(raw) || !isRecord(raw.response)) throw new Error("missing response");
      const header = raw.response.header;
      const body = raw.response.body;
      if (!isRecord(header) || header.resultCode !== "00" || typeof header.resultMsg !== "string") {
        throw new Error("provider error");
      }
      if (!isRecord(body) || !isRecord(body.items) || !Array.isArray(body.items.item)) {
        throw new Error("missing items");
      }
      const items = body.items.item.map(validateWeatherItem);
      if (items.length === 0) throw new Error("empty items");

      return {
        response: {
          header: { resultCode: header.resultCode, resultMsg: header.resultMsg },
          body: {
            totalCount: typeof body.totalCount === "number" ? body.totalCount : items.length,
            items: { item: items },
          },
        },
      };
    },

    normalize(raw, query) {
      const items = raw.response.body.items.item;
      const observedItem = items[0];
      const observedAt = parseKoreaTimestamp(observedItem.baseDate, observedItem.baseTime);
      if (!observedAt) throw new Error("invalid provider observation time");
      const metrics = Object.fromEntries(items.map((item) => [item.category, numericValue(item.obsrValue)]));
      const temperatureC = metrics.T1H;
      const precipitationMm = metrics.RN1;
      const windSpeedMps = metrics.WSD;
      const precipitationType = metrics.PTY;
      const valueCode = weatherValueCode({ precipitationMm, windSpeedMps, precipitationType });
      const fetchedAt = now();
      const expiresAt = new Date(observedAt.getTime() + options.ttlSeconds * 1_000);
      const descriptions = [
        temperatureC === undefined ? null : `기온 ${temperatureC}도`,
        precipitationMm === undefined ? null : `강수 ${precipitationMm}mm`,
        windSpeedMps === undefined ? null : `풍속 ${windSpeedMps}m/s`,
      ].filter((value): value is string => Boolean(value));

      return [{
        placeId: query.placeId,
        dimension: "weather",
        valueCode,
        valueText: descriptions.join(" · ") || "기상청 관측",
        ...(temperatureC === undefined ? {} : { temperatureC }),
        ...(precipitationMm === undefined ? {} : { precipitationMm }),
        ...(windSpeedMps === undefined ? {} : { windSpeedMps }),
        sourceKey: "kma_weather",
        sourceType: "official_periodic",
        sourceName: attribution,
        attributionText: "기상청",
        observedAt: observedAt.toISOString(),
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        confidenceScore: 0.9,
        isEstimated: false,
        externalObservationId: `${observedItem.baseDate}${observedItem.baseTime}:${observedItem.nx}:${observedItem.ny}`,
      }];
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
        return {
          status: "healthy",
          checkedAt: now().toISOString(),
          responseTimeMs: Date.now() - startedAt,
        };
      } catch (error) {
        return {
          status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
          checkedAt: now().toISOString(),
          responseTimeMs: Date.now() - startedAt,
          message: "KMA source check failed",
        };
      }
    },
  };

  return adapter;
}

function validateWeatherItem(value: unknown): KmaWeatherItem {
  if (!isRecord(value)) throw new Error("invalid weather item");
  const { baseDate, baseTime, category, nx, ny, obsrValue } = value;
  if (
    typeof baseDate !== "string" ||
    typeof baseTime !== "string" ||
    typeof category !== "string" ||
    typeof nx !== "number" ||
    typeof ny !== "number" ||
    (typeof obsrValue !== "string" && typeof obsrValue !== "number")
  ) {
    throw new Error("invalid weather item fields");
  }
  if (!parseKoreaTimestamp(baseDate, baseTime)) throw new Error("invalid item timestamp");

  return { baseDate, baseTime, category, nx, ny, obsrValue: String(obsrValue) };
}

function weatherValueCode(input: {
  precipitationMm?: number;
  windSpeedMps?: number;
  precipitationType?: number;
}): NormalizedKmaWeatherSignal["valueCode"] {
  if ((input.windSpeedMps ?? 0) >= 14 || (input.precipitationMm ?? 0) >= 30) return "storm";
  if (input.precipitationType === 3 || input.precipitationType === 7) return "snow";
  if ((input.precipitationType ?? 0) > 0 || (input.precipitationMm ?? 0) > 0) return "rain";
  if ((input.windSpeedMps ?? 0) >= 9) return "windy";
  return "clear";
}

function parseKoreaTimestamp(date: string, time: string): Date | null {
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return null;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`;
  return validDate(iso);
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function numericValue(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

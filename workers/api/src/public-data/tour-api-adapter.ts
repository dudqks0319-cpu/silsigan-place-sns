import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type TourApiAreaQuery = {
  searchMode?: "area";
  areaCode: string;
  contentTypeId?: string;
  pageNo?: number;
  numOfRows?: number;
};

export type TourApiLocationQuery = {
  searchMode: "location";
  latitude: number;
  longitude: number;
  radiusM: number;
  contentTypeId?: string;
  pageNo?: number;
  numOfRows?: number;
};

export type TourApiQuery = TourApiAreaQuery | TourApiLocationQuery;

type TourApiItem = {
  contentid: string;
  title: string;
  addr1?: string;
  mapx?: string;
  mapy?: string;
  modifiedtime?: string;
};

export type TourApiResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      totalCount: number;
      items: { item: TourApiItem[] };
    };
  };
};

export type NormalizedTourApiPlace = {
  externalId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  sourceUpdatedAt?: string;
  sourceKey: "tour_api";
  sourceType: "official_static";
  sourceName: "한국관광공사 TourAPI";
  attributionText: "한국관광공사";
};

export type TourApiAdapterOptions = {
  serviceKey: string;
  now?: () => Date;
};

const areaEndpoint = "https://apis.data.go.kr/B551011/KorService2/areaBasedList2";
const locationEndpoint = "https://apis.data.go.kr/B551011/KorService2/locationBasedList2";
const attribution = "한국관광공사 TourAPI";

export function createTourApiAdapter(
  options: TourApiAdapterOptions,
): PublicDataAdapter<TourApiQuery, TourApiResponse, NormalizedTourApiPlace> {
  const serviceKey = requiredServiceKey(options.serviceKey, "Tour API");
  const now = options.now ?? (() => new Date());

  const adapter: PublicDataAdapter<TourApiQuery, TourApiResponse, NormalizedTourApiPlace> = {
    sourceKey: "tour_api",

    validateQuery(query) {
      if (query.searchMode === "location") {
        validateLocationQuery(query);
      } else if (!/^\d{1,3}$/.test(query.areaCode)) {
        throw new Error("invalid areaCode");
      }
      if (query.contentTypeId !== undefined && !/^\d{1,3}$/.test(query.contentTypeId)) {
        throw new Error("invalid contentTypeId");
      }
      validatePage(query.pageNo, query.numOfRows);
    },

    cacheKey(query) {
      const scope = query.searchMode === "location"
        ? ["location", query.latitude, query.longitude, query.radiusM]
        : ["area", query.areaCode];
      return [...scope, query.contentTypeId ?? "all", query.pageNo ?? 1, query.numOfRows ?? 20].join(":");
    },

    async fetch(query, context) {
      const url = new URL(query.searchMode === "location" ? locationEndpoint : areaEndpoint);
      url.searchParams.set("serviceKey", serviceKey);
      url.searchParams.set("MobileOS", "ETC");
      url.searchParams.set("MobileApp", "silsigan");
      url.searchParams.set("_type", "json");
      if (query.searchMode === "location") {
        url.searchParams.set("mapX", String(query.longitude));
        url.searchParams.set("mapY", String(query.latitude));
        url.searchParams.set("radius", String(query.radiusM));
      } else {
        url.searchParams.set("areaCode", query.areaCode);
      }
      url.searchParams.set("pageNo", String(query.pageNo ?? 1));
      url.searchParams.set("numOfRows", String(query.numOfRows ?? 20));
      if (query.contentTypeId) url.searchParams.set("contentTypeId", query.contentTypeId);
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      const { header, body } = responseParts(raw);
      if (header.resultCode !== "0000") throw new Error("provider error");
      if (!isRecord(body.items) || !Array.isArray(body.items.item) || !isNonNegativeInteger(body.totalCount)) {
        throw new Error("invalid body");
      }
      const items = body.items.item.map(validateItem);
      return { response: { header, body: { totalCount: body.totalCount, items: { item: items } } } };
    },

    normalize(raw) {
      return raw.response.body.items.item.map((item) => {
        const longitude = optionalCoordinate(item.mapx, -180, 180);
        const latitude = optionalCoordinate(item.mapy, -90, 90);
        const sourceUpdatedAt = item.modifiedtime ? parseCompactKoreaTimestamp(item.modifiedtime) : undefined;
        if (item.modifiedtime && !sourceUpdatedAt) throw new Error("invalid provider source time");
        return {
          externalId: item.contentid,
          name: item.title,
          ...(item.addr1 ? { address: item.addr1 } : {}),
          ...(latitude === undefined ? {} : { latitude }),
          ...(longitude === undefined ? {} : { longitude }),
          ...(sourceUpdatedAt ? { sourceUpdatedAt: sourceUpdatedAt.toISOString() } : {}),
          sourceKey: "tour_api" as const,
          sourceType: "official_static" as const,
          sourceName: attribution,
          attributionText: "한국관광공사" as const,
        };
      });
    },

    getObservedAt() {
      return null;
    },

    getExpiresAt() {
      return null;
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
        return healthFailure("Tour API", error, now(), startedAt);
      }
    },
  };

  return adapter;
}

function validateItem(value: unknown): TourApiItem {
  if (!isRecord(value) || !isNonEmptyString(value.contentid) || !isNonEmptyString(value.title)) {
    throw new Error("invalid tour item");
  }
  for (const field of ["addr1", "mapx", "mapy", "modifiedtime"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("invalid tour item field");
  }
  const addr1 = typeof value.addr1 === "string" ? value.addr1 : undefined;
  const mapx = typeof value.mapx === "string" ? value.mapx : undefined;
  const mapy = typeof value.mapy === "string" ? value.mapy : undefined;
  const modifiedtime = typeof value.modifiedtime === "string" ? value.modifiedtime : undefined;
  optionalCoordinate(mapx, -180, 180);
  optionalCoordinate(mapy, -90, 90);
  if (modifiedtime && !parseCompactKoreaTimestamp(modifiedtime)) throw new Error("invalid tour source time");
  return {
    contentid: value.contentid,
    title: value.title,
    ...(addr1 ? { addr1 } : {}),
    ...(mapx ? { mapx } : {}),
    ...(mapy ? { mapy } : {}),
    ...(modifiedtime ? { modifiedtime } : {}),
  };
}

function responseParts(raw: unknown): {
  header: { resultCode: string; resultMsg: string };
  body: Record<string, unknown>;
} {
  if (!isRecord(raw) || !isRecord(raw.response) || !isRecord(raw.response.header) || !isRecord(raw.response.body)) {
    throw new Error("missing response");
  }
  const { resultCode, resultMsg } = raw.response.header;
  if (typeof resultCode !== "string" || typeof resultMsg !== "string") throw new Error("invalid header");
  return { header: { resultCode, resultMsg }, body: raw.response.body };
}

function validatePage(pageNo?: number, numOfRows?: number): void {
  if (pageNo !== undefined && (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10_000)) throw new Error("invalid pageNo");
  if (numOfRows !== undefined && (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > 100)) throw new Error("invalid numOfRows");
}

function validateLocationQuery(query: TourApiLocationQuery): void {
  if (!Number.isFinite(query.latitude) || query.latitude < -90 || query.latitude > 90) {
    throw new Error("invalid latitude");
  }
  if (!Number.isFinite(query.longitude) || query.longitude < -180 || query.longitude > 180) {
    throw new Error("invalid longitude");
  }
  if (!Number.isInteger(query.radiusM) || query.radiusM < 10 || query.radiusM > 20_000) {
    throw new Error("invalid radiusM");
  }
}

function optionalCoordinate(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error("invalid coordinate");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("invalid coordinate");
  return parsed;
}

function parseCompactKoreaTimestamp(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function requiredServiceKey(value: string, label: string): string {
  const key = value.trim();
  if (!key) throw new Error(`${label} service key is required`);
  return key;
}

function healthFailure(label: string, error: unknown, checkedAt: Date, startedAt: number): AdapterHealthResult {
  return {
    status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
    checkedAt: checkedAt.toISOString(),
    responseTimeMs: Date.now() - startedAt,
    message: `${label} source check failed`,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

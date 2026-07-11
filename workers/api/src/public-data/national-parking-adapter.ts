import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type NationalParkingQuery = {
  pageNo?: number;
  numOfRows?: number;
};

type NationalParkingItem = {
  parkingId: string;
  name: string;
  roadAddress?: string;
  latitude?: string;
  longitude?: string;
  referenceDate?: string;
  managingAuthority: string;
};

export type NationalParkingResponse = {
  currentCount: number;
  data: Array<Record<string, unknown>>;
  matchCount: number;
  page: number;
  perPage: number;
  totalCount: number;
};

type ValidatedNationalParkingResponse = Omit<NationalParkingResponse, "data"> & {
  data: NationalParkingItem[];
};

export type NormalizedNationalParkingPlace = {
  externalId: string;
  name: string;
  roadAddress?: string;
  latitude?: number;
  longitude?: number;
  managingAuthority: string;
  sourceUpdatedAt?: string;
  sourceKey: "national_parking";
  sourceType: "official_static";
  sourceName: "전국주차장정보표준데이터";
  attributionText: "공공데이터포털";
};

export type NationalParkingAdapterOptions = {
  serviceKey: string;
  endpointUrl: string;
  now?: () => Date;
};

const attribution = "전국주차장정보표준데이터";

export function createNationalParkingAdapter(
  options: NationalParkingAdapterOptions,
): PublicDataAdapter<NationalParkingQuery, ValidatedNationalParkingResponse, NormalizedNationalParkingPlace> {
  const serviceKey = options.serviceKey.trim();
  const endpoint = validateEndpoint(options.endpointUrl);
  const now = options.now ?? (() => new Date());
  if (!serviceKey) throw new Error("National parking service key is required");

  const adapter: PublicDataAdapter<NationalParkingQuery, ValidatedNationalParkingResponse, NormalizedNationalParkingPlace> = {
    sourceKey: "national_parking",

    validateQuery(query) {
      validatePage(query.pageNo, query.numOfRows);
    },

    cacheKey(query) {
      return `${query.pageNo ?? 1}:${query.numOfRows ?? 100}`;
    },

    async fetch(query, context) {
      const url = new URL(endpoint);
      url.searchParams.set("serviceKey", serviceKey);
      url.searchParams.set("page", String(query.pageNo ?? 1));
      url.searchParams.set("perPage", String(query.numOfRows ?? 100));
      url.searchParams.set("returnType", "JSON");
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      if (!isRecord(raw) || !Array.isArray(raw.data)) throw new Error("missing response");
      const currentCount = countField(raw.currentCount);
      const matchCount = countField(raw.matchCount);
      const page = countField(raw.page);
      const perPage = countField(raw.perPage);
      const totalCount = countField(raw.totalCount);
      return {
        currentCount,
        matchCount,
        page,
        perPage,
        totalCount,
        data: raw.data.map(validateParkingItem),
      };
    },

    normalize(raw) {
      return raw.data.map((item) => ({
        externalId: item.parkingId,
        name: item.name,
        ...(item.roadAddress ? { roadAddress: item.roadAddress } : {}),
        ...(item.latitude ? { latitude: coordinate(item.latitude, -90, 90) } : {}),
        ...(item.longitude ? { longitude: coordinate(item.longitude, -180, 180) } : {}),
        managingAuthority: item.managingAuthority,
        ...(item.referenceDate ? { sourceUpdatedAt: parseDate(item.referenceDate).toISOString() } : {}),
        sourceKey: "national_parking" as const,
        sourceType: "official_static" as const,
        sourceName: attribution,
        attributionText: "공공데이터포털" as const,
      }));
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
        return {
          status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
          checkedAt: now().toISOString(),
          responseTimeMs: Date.now() - startedAt,
          message: "National parking source check failed",
        };
      }
    },
  };

  return adapter;
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("National parking endpoint is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.odcloud.kr" ||
    !url.pathname.startsWith("/api/15012896/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("National parking endpoint is not an approved data.go.kr endpoint");
  }
  return url.toString();
}

function validateParkingItem(value: unknown): NationalParkingItem {
  if (!isRecord(value)) throw new Error("invalid parking item");
  const parkingId = requiredField(value, "주차장관리번호");
  const name = requiredField(value, "주차장명");
  const managingAuthority = requiredField(value, "관리기관명");
  const roadAddress = optionalField(value, "소재지도로명주소");
  const latitude = optionalNumberField(value, "위도", -90, 90);
  const longitude = optionalNumberField(value, "경도", -180, 180);
  const referenceDate = optionalField(value, "데이터기준일자");
  if (referenceDate) parseDate(referenceDate);
  return {
    parkingId,
    name,
    managingAuthority,
    ...(roadAddress ? { roadAddress } : {}),
    ...(latitude ? { latitude } : {}),
    ...(longitude ? { longitude } : {}),
    ...(referenceDate ? { referenceDate } : {}),
  };
}

function validatePage(pageNo?: number, numOfRows?: number): void {
  if (pageNo !== undefined && (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10_000)) throw new Error("invalid pageNo");
  if (numOfRows !== undefined && (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > 1_000)) throw new Error("invalid numOfRows");
}

function requiredField(value: Record<string, unknown>, field: string): string {
  const raw = value[field];
  if (typeof raw !== "string" || !raw.trim()) throw new Error("invalid parking field");
  return raw.trim();
}

function optionalField(value: Record<string, unknown>, field: string): string | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error("invalid parking field");
  return raw.trim() || undefined;
}

function optionalNumberField(
  value: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): string | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const normalized = typeof raw === "number" || typeof raw === "string" ? String(raw) : "";
  coordinate(normalized, min, max);
  return normalized;
}

function coordinate(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("invalid coordinate");
  return parsed;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid reference date");
  const parsed = new Date(`${value}T00:00:00+09:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("invalid reference date");
  return parsed;
}

function countField(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error("invalid parking count");
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

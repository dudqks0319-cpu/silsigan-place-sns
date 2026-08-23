export const OFFICIAL_SOURCE_KEYS = [
  "kma_weather",
  "tour_api",
  "national_parking",
  "national_traffic",
  "national_cctv",
] as const;

export type OfficialSourceKey = (typeof OFFICIAL_SOURCE_KEYS)[number];
export type IngestionTargetQuery = Record<string, unknown>;

type BBox = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

const MATCH_METHODS = ["provider_id", "normalized_name", "address", "distance", "phone", "building", "manual"] as const;
const KMA_SOURCE_KEY = "kma_weather" satisfies OfficialSourceKey;

export function isOfficialSourceKey(value: string): value is OfficialSourceKey {
  return (OFFICIAL_SOURCE_KEYS as readonly string[]).includes(value);
}

export function parseIngestionTargetQuery(value: unknown): IngestionTargetQuery {
  if (!isRecord(value)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }

  rejectSecretLikeKeys(value);
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 4_000) {
    throw new Error("INGESTION_TARGET_QUERY_TOO_LARGE");
  }

  return value;
}

export function validateIngestionTargetQuery(sourceKey: OfficialSourceKey, query: IngestionTargetQuery): void {
  parseIngestionTargetQuery(query);

  if ("placeId" in query || "sourceKey" in query) {
    throw new Error("INGESTION_TARGET_QUERY_RESERVED_FIELD");
  }

  switch (sourceKey) {
    case KMA_SOURCE_KEY:
      validateKmaQuery(query);
      return;
    case "tour_api":
      validateTourQuery(query);
      return;
    case "national_parking":
      validateParkingQuery(query);
      return;
    case "national_traffic":
      validateTrafficQuery(query);
      return;
    case "national_cctv":
      validateCctvQuery(query);
      return;
  }
}

export function buildIngestionRequestBody(
  sourceKey: OfficialSourceKey,
  placeId: string,
  query: IngestionTargetQuery,
  now = new Date(),
): IngestionTargetQuery {
  validateIngestionTargetQuery(sourceKey, query);
  const body: IngestionTargetQuery = { ...query, placeId };

  if (sourceKey === KMA_SOURCE_KEY && query.useLatestKmaNowcast === true) {
    const latest = latestKmaNowcastParts(now);
    body.baseDate = latest.baseDate;
    body.baseTime = latest.baseTime;
  }

  delete body.useLatestKmaNowcast;
  return body;
}

export function nextIngestionAt(
  now: Date,
  refreshIntervalSeconds: number | null,
  status: "succeeded" | "partial" | "failed" | "skipped",
): string {
  const configured = Number.isInteger(refreshIntervalSeconds) && (refreshIntervalSeconds as number) > 0
    ? (refreshIntervalSeconds as number)
    : 86_400;
  const delaySeconds = status === "failed" ? Math.max(configured, 300) : configured;
  return new Date(now.getTime() + delaySeconds * 1_000).toISOString();
}

function validateKmaQuery(query: IngestionTargetQuery): void {
  requiredInteger(query, "nx", 1, 200);
  requiredInteger(query, "ny", 1, 200);
  const useLatest = query.useLatestKmaNowcast;
  if (useLatest !== undefined && typeof useLatest !== "boolean") {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }

  if (useLatest === true) {
    return;
  }

  requiredPattern(query, "baseDate", /^\d{8}$/);
  requiredPattern(query, "baseTime", /^\d{4}$/);
}

function validateTourQuery(query: IngestionTargetQuery): void {
  validateStaticPlaceMatchQuery(query);
  requiredString(query, "areaCode", 3);
  optionalInteger(query, "pageNo", 1, 10_000);
  optionalInteger(query, "numOfRows", 1, 100);
  optionalString(query, "contentTypeId", 3);
}

function validateParkingQuery(query: IngestionTargetQuery): void {
  validateStaticPlaceMatchQuery(query);
  optionalInteger(query, "pageNo", 1, 10_000);
  optionalInteger(query, "numOfRows", 1, 1_000);
}

function validateStaticPlaceMatchQuery(query: IngestionTargetQuery): void {
  requiredString(query, "externalId", 200);
  const matchMethod = requiredString(query, "matchMethod", 32);
  if (!(MATCH_METHODS as readonly string[]).includes(matchMethod)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  const manuallyVerified = query.manuallyVerified;
  if (typeof manuallyVerified !== "boolean" || (matchMethod === "manual" && manuallyVerified !== true)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
}

function validateTrafficQuery(query: IngestionTargetQuery): void {
  requiredString(query, "linkId", 80);
  const roadType = requiredString(query, "roadType", 3);
  if (roadType !== "all" && roadType !== "ex" && roadType !== "its") {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }

  const bbox = optionalBbox(query);
  if (roadType === "all") {
    if (!bbox) throw new Error("INGESTION_TARGET_QUERY_INVALID");
    if (query.routeNo !== undefined || query.direction !== undefined) {
      throw new Error("INGESTION_TARGET_QUERY_INVALID");
    }
    return;
  }

  const routeNo = requiredString(query, "routeNo", 6);
  if (!/^\d{1,6}$/.test(routeNo)) throw new Error("INGESTION_TARGET_QUERY_INVALID");
  const direction = requiredString(query, "direction", 8);
  if (!( ["all", "up", "down", "start", "end"] as readonly string[]).includes(direction)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  if (query.bbox !== undefined && !bbox) throw new Error("INGESTION_TARGET_QUERY_INVALID");
}

function validateCctvQuery(query: IngestionTargetQuery): void {
  validateStaticPlaceMatchQuery(query);
  const roadType = requiredString(query, "roadType", 3);
  const cctvType = requiredString(query, "cctvType", 1);
  if (!( ["ex", "its"] as readonly string[]).includes(roadType)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  if (!( ["1", "2", "3", "4", "5"] as readonly string[]).includes(cctvType)) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  if (!optionalBbox(query)) throw new Error("INGESTION_TARGET_QUERY_INVALID");
}

function optionalBbox(query: IngestionTargetQuery): BBox | null {
  const fields = ["minLng", "maxLng", "minLat", "maxLat"] as const;
  const present = fields.filter((field) => query[field] !== undefined && query[field] !== null);
  if (present.length === 0) return null;
  if (present.length !== fields.length) throw new Error("INGESTION_TARGET_QUERY_INVALID");

  const bbox = {
    minLng: finiteNumber(query.minLng),
    maxLng: finiteNumber(query.maxLng),
    minLat: finiteNumber(query.minLat),
    maxLat: finiteNumber(query.maxLat),
  };
  if (
    bbox.minLng < -180 || bbox.maxLng > 180 ||
    bbox.minLat < -90 || bbox.maxLat > 90 ||
    bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat
  ) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  return bbox;
}

function requiredString(query: IngestionTargetQuery, field: string, maxLength: number): string {
  const value = query[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  return value.trim();
}

function optionalString(query: IngestionTargetQuery, field: string, maxLength: number): string | undefined {
  const value = query[field];
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(query, field, maxLength);
}

function requiredPattern(query: IngestionTargetQuery, field: string, pattern: RegExp): string {
  const value = requiredString(query, field, 16);
  if (!pattern.test(value)) throw new Error("INGESTION_TARGET_QUERY_INVALID");
  return value;
}

function requiredInteger(query: IngestionTargetQuery, field: string, min: number, max: number): number {
  const value = query[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error("INGESTION_TARGET_QUERY_INVALID");
  }
  return value;
}

function optionalInteger(query: IngestionTargetQuery, field: string, min: number, max: number): number | undefined {
  if (query[field] === undefined || query[field] === null) return undefined;
  return requiredInteger(query, field, min, max);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("INGESTION_TARGET_QUERY_INVALID");
  return value;
}

function rejectSecretLikeKeys(value: unknown): void {
  if (!isRecord(value)) {
    if (Array.isArray(value)) value.forEach(rejectSecretLikeKeys);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/(?:secret|token|password|authorization|servicekey|apikey)/i.test(key)) {
      throw new Error("INGESTION_TARGET_QUERY_SECRET_FIELD");
    }
    rejectSecretLikeKeys(child);
  }
}

function latestKmaNowcastParts(now: Date): { baseDate: string; baseTime: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  let hour = Number(parts.hour);
  let minute = Math.floor(Number(parts.minute) / 10) * 10 - 10;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (minute < 0) {
    minute += 60;
    hour -= 1;
  }
  if (hour < 0) {
    hour = 23;
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return {
    baseDate: `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`,
    baseTime: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

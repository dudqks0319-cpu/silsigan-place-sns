import type { Place, PlaceLaunchStage, RegionId, ReportCategory } from "./domain.ts";

export const STATIC_PLACE_DIRECTORY_PATH = "/silsigan/snapshots/nationwide-places.v1.json";
export const STATIC_PLACE_DIRECTORY_SCHEMA = "silsigan-nationwide-place-directory/v1" as const;
export const STATIC_PLACE_DIRECTORY_TRUTH_POLICY = "verified-place-directory-only-no-live-status" as const;

const MAX_DIRECTORY_BYTES = 256 * 1024;
const MAX_DIRECTORY_PLACES = 500;
const DEFAULT_DIRECTORY_LIMIT = 100;
const MAX_DIRECTORY_LIMIT = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 3_000;
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TOP_LEVEL_KEYS = new Set(["schemaVersion", "catalogVersion", "catalogGeneratedAt", "truthPolicy", "places"]);
const PLACE_KEYS = new Set([
  "id",
  "name",
  "address",
  "categoryId",
  "areaId",
  "regionId",
  "latitude",
  "longitude",
  "launchStage",
  "coordinateStatus",
]);
const REGION_IDS = new Set<RegionId>([
  "busan",
  "ulsan",
  "gyeongju",
  "daegu",
  "changwon",
  "gimhae",
  "yangsan",
  "pohang",
  "seoul",
  "jeju",
  "gangneung",
  "jeonju",
  "yeosu",
  "sokcho",
]);
const CATEGORY_IDS = new Set<ReportCategory>([
  "tourism",
  "festival",
  "restaurant_cafe",
  "hospital",
  "public_office",
  "parking",
]);
const LAUNCH_STAGES = new Set<PlaceLaunchStage>(["seed", "beta", "active"]);

export type StaticPlaceDirectoryRecord = {
  id: string;
  name: string;
  address: string;
  categoryId: ReportCategory;
  areaId: string;
  regionId: RegionId;
  latitude: number;
  longitude: number;
  launchStage: PlaceLaunchStage;
  coordinateStatus: "verified";
};

export type StaticPlaceDirectory = {
  schemaVersion: typeof STATIC_PLACE_DIRECTORY_SCHEMA;
  catalogVersion: string;
  catalogGeneratedAt: string;
  truthPolicy: typeof STATIC_PLACE_DIRECTORY_TRUTH_POLICY;
  places: StaticPlaceDirectoryRecord[];
};

export type StaticPlaceDirectoryOptions = {
  regionId?: string | null;
  query?: string | null;
  limit?: number;
};

export type StaticPlaceDirectoryResult = {
  schemaVersion: typeof STATIC_PLACE_DIRECTORY_SCHEMA;
  catalogVersion: string;
  catalogGeneratedAt: string;
  truthPolicy: typeof STATIC_PLACE_DIRECTORY_TRUTH_POLICY;
  places: Place[];
};

export function parseStaticPlaceDirectory(value: unknown): StaticPlaceDirectory {
  if (!isPlainObject(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) {
    throw new Error("기본 장소 목록 형식이 올바르지 않습니다.");
  }
  if (value.schemaVersion !== STATIC_PLACE_DIRECTORY_SCHEMA || value.truthPolicy !== STATIC_PLACE_DIRECTORY_TRUTH_POLICY) {
    throw new Error("기본 장소 목록의 안전 정책을 확인할 수 없습니다.");
  }
  if (!isBoundedString(value.catalogVersion, 1, 80) || !isIsoDate(value.catalogGeneratedAt)) {
    throw new Error("기본 장소 목록 버전을 확인할 수 없습니다.");
  }
  if (!Array.isArray(value.places) || value.places.length === 0 || value.places.length > MAX_DIRECTORY_PLACES) {
    throw new Error("기본 장소 목록 크기가 허용 범위를 벗어났습니다.");
  }

  const seenIds = new Set<string>();
  const places = value.places.map((candidate) => parseDirectoryPlace(candidate, seenIds));
  return {
    schemaVersion: STATIC_PLACE_DIRECTORY_SCHEMA,
    catalogVersion: value.catalogVersion,
    catalogGeneratedAt: value.catalogGeneratedAt,
    truthPolicy: STATIC_PLACE_DIRECTORY_TRUTH_POLICY,
    places,
  };
}

export function filterStaticPlaceDirectory(
  directory: StaticPlaceDirectory,
  options: StaticPlaceDirectoryOptions = {},
): StaticPlaceDirectoryResult {
  const regionId = normalizeRegionId(options.regionId);
  const query = normalizeDirectoryQuery(options.query);
  const limit = normalizeLimit(options.limit);
  const places: Place[] = [];

  if (options.regionId?.trim() && !regionId) {
    return {
      schemaVersion: directory.schemaVersion,
      catalogVersion: directory.catalogVersion,
      catalogGeneratedAt: directory.catalogGeneratedAt,
      truthPolicy: directory.truthPolicy,
      places,
    };
  }

  for (const candidate of directory.places) {
    if (regionId && candidate.regionId !== regionId) {
      continue;
    }
    if (query && !directoryPlaceSearchText(candidate).includes(query)) {
      continue;
    }

    places.push({
      id: candidate.id,
      name: candidate.name,
      address: candidate.address,
      category: candidate.categoryId,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      region: candidate.regionId,
      regionId: candidate.regionId,
      launchStage: candidate.launchStage,
    });
    if (places.length >= limit) {
      break;
    }
  }

  return {
    schemaVersion: directory.schemaVersion,
    catalogVersion: directory.catalogVersion,
    catalogGeneratedAt: directory.catalogGeneratedAt,
    truthPolicy: directory.truthPolicy,
    places,
  };
}

export async function fetchStaticPlaceDirectory(
  options: StaticPlaceDirectoryOptions & { timeoutMs?: number } = {},
): Promise<StaticPlaceDirectoryResult> {
  const controller = new AbortController();
  const timeoutMs = Math.min(10_000, Math.max(500, Math.round(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)));
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(STATIC_PLACE_DIRECTORY_PATH, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "force-cache",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`기본 장소 목록을 불러오지 못했습니다. (HTTP ${response.status})`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DIRECTORY_BYTES) {
      throw new Error("기본 장소 목록 응답이 너무 큽니다.");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_DIRECTORY_BYTES) {
      throw new Error("기본 장소 목록 응답이 너무 큽니다.");
    }

    return filterStaticPlaceDirectory(parseStaticPlaceDirectory(JSON.parse(body)), options);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseDirectoryPlace(value: unknown, seenIds: Set<string>): StaticPlaceDirectoryRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, PLACE_KEYS)) {
    throw new Error("기본 장소 항목에 허용되지 않은 필드가 있습니다.");
  }
  if (!isSafeIdentifier(value.id) || seenIds.has(value.id)) {
    throw new Error("기본 장소 ID가 올바르지 않거나 중복됐습니다.");
  }
  if (!isBoundedString(value.name, 1, 80) || !isBoundedString(value.address, 1, 160)) {
    throw new Error("기본 장소 이름 또는 주소가 올바르지 않습니다.");
  }
  if (!isSafeIdentifier(value.areaId) || !CATEGORY_IDS.has(value.categoryId as ReportCategory)) {
    throw new Error("기본 장소 분류가 올바르지 않습니다.");
  }
  if (!REGION_IDS.has(value.regionId as RegionId) || !LAUNCH_STAGES.has(value.launchStage as PlaceLaunchStage)) {
    throw new Error("기본 장소 지역 또는 공개 단계가 올바르지 않습니다.");
  }
  if (
    value.coordinateStatus !== "verified"
    || typeof value.latitude !== "number"
    || typeof value.longitude !== "number"
    || !isKoreanCoordinate(value.latitude, value.longitude)
  ) {
    throw new Error("검증되지 않은 기본 장소 좌표가 포함됐습니다.");
  }

  seenIds.add(value.id);
  return {
    id: value.id,
    name: value.name,
    address: value.address,
    categoryId: value.categoryId as ReportCategory,
    areaId: value.areaId,
    regionId: value.regionId as RegionId,
    latitude: value.latitude,
    longitude: value.longitude,
    launchStage: value.launchStage as PlaceLaunchStage,
    coordinateStatus: "verified",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowedKeys.size && keys.every((key) => allowedKeys.has(key));
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= minLength && value.length <= maxLength;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isKoreanCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && latitude >= 33
    && latitude <= 39
    && Number.isFinite(longitude)
    && longitude >= 124
    && longitude <= 132;
}

function normalizeRegionId(regionId: string | null | undefined): RegionId | null {
  const normalized = regionId?.normalize("NFKC").trim().toLowerCase() ?? "";
  return REGION_IDS.has(normalized as RegionId) ? normalized as RegionId : null;
}

function normalizeDirectoryQuery(query: string | null | undefined): string {
  return query?.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").slice(0, 80) ?? "";
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_DIRECTORY_LIMIT;
  }
  return Math.min(MAX_DIRECTORY_LIMIT, Math.max(1, Math.floor(limit as number)));
}

function directoryPlaceSearchText(place: StaticPlaceDirectoryRecord): string {
  return [place.name, place.address, place.categoryId, place.areaId, place.regionId]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
}

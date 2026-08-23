import type { CloudflarePlace } from "./cloudflare-api";
import { getSilsiganApiFetcher } from "./cloudflare-service-fetch.ts";
import { listPlaces } from "./mock-store.ts";

export type SharedPlace = Pick<CloudflarePlace, "id" | "name" | "categoryId" | "areaId" | "regionId" | "latitude" | "longitude" | "score" | "status" | "coordinateStatus">;

type SharedPlaceLookupEnv = Record<string, string | undefined>;

type SharedPlaceLookupOptions = {
  env?: SharedPlaceLookupEnv;
  fetcher?: typeof fetch;
  clientIp?: string;
};

const placeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/;

export async function findSharedPlace(placeId: string, options: SharedPlaceLookupOptions = {}): Promise<SharedPlace | null> {
  const normalizedPlaceId = placeId.trim();
  if (!placeIdPattern.test(normalizedPlaceId)) {
    return null;
  }

  const runtimeEnv = options.env ?? defaultSharedPlaceLookupEnv();
  const workerBaseUrl = sharedPlaceWorkerBaseUrl(runtimeEnv);

  if (!workerBaseUrl) {
    return runtimeEnv.NODE_ENV === "production" ? null : findLocalPreviewPlace(normalizedPlaceId);
  }

  return findWorkerSharedPlace(normalizedPlaceId, workerBaseUrl, options.fetcher ?? getSilsiganApiFetcher(), options.clientIp);
}

function defaultSharedPlaceLookupEnv(): SharedPlaceLookupEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL,
  };
}

function findLocalPreviewPlace(placeId: string): SharedPlace | null {
  const place = listPlaces({ limit: 100 }).find((candidate) => candidate.id === placeId);
  if (!place) {
    return null;
  }

  const status = place.launchStage === "active" ? "active" : place.launchStage === "beta" ? "beta" : "paused";
  return {
    id: place.id,
    name: place.name,
    categoryId: place.category,
    areaId: place.regionId,
    regionId: place.regionId,
    latitude: place.latitude,
    longitude: place.longitude,
    score: 0,
    status,
    coordinateStatus: "TODO_COORDINATE_VERIFY",
  };
}

export function sharedPlaceRegionLabel(regionId: string): string {
  const labels: Record<string, string> = {
    busan: "부산",
    ulsan: "울산",
    gyeongju: "경주",
    seoul: "서울",
    daegu: "대구",
    jeju: "제주",
  };

  return labels[regionId] ?? regionId;
}

export function sharedPlaceCategoryLabel(categoryId: string): string {
  const labels: Record<string, string> = {
    tourism: "관광지",
    festival: "축제",
    restaurant_cafe: "음식점·카페",
    parking: "주차장",
    hospital: "병원",
    public_office: "공공시설",
  };

  return labels[categoryId] ?? "장소";
}

export function sharedPlaceFallbackImagePath(placeId: string): string | null {
  const paths: Record<string, string> = {
    "busan-gwangalli": "/silsigan/fallback/gwangalli.png",
    "gyeongju-hwangridan": "/silsigan/fallback/hwangridan.png",
    "ulsan-taehwagang": "/silsigan/fallback/taehwagang.png",
  };

  return paths[placeId] ?? null;
}

function sharedPlaceWorkerBaseUrl(env: SharedPlaceLookupEnv): string {
  return (env.SILSIGAN_WORKER_API_BASE_URL ?? env.SILSIGAN_STAGING_API_BASE_URL ?? env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}

async function findWorkerSharedPlace(placeId: string, baseUrl: string, fetcher: typeof fetch, clientIp?: string): Promise<SharedPlace | null> {
  const url = new URL(`/api/places/${encodeURIComponent(placeId)}`, `${baseUrl}/`);
  const headers = new Headers({ accept: "application/json" });
  const normalizedClientIp = normalizeCloudflareClientIp(clientIp);
  if (normalizedClientIp) {
    headers.set("cf-connecting-ip", normalizedClientIp);
  }

  try {
    const response = await fetcher(url, {
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("[shared-place] Worker lookup returned a non-success status.", {
        status: response.status,
        code: await safeWorkerErrorCode(response),
      });
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || payload.success !== true || !isSharedPlace(payload.data)) {
      return null;
    }

    return payload.data;
  } catch (error) {
    console.warn("[shared-place] Worker lookup failed.", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

function normalizeCloudflareClientIp(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return /^[0-9A-Fa-f:.]{2,64}$/.test(normalized) ? normalized : null;
}

async function safeWorkerErrorCode(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as unknown;
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(payload.error.code)) {
      return payload.error.code;
    }
  } catch {
    // Platform responses may not be JSON; keep diagnostics coarse.
  }

  return "UNKNOWN";
}

function isSharedPlace(value: unknown): value is SharedPlace {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    placeIdPattern.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.categoryId === "string" &&
    typeof value.areaId === "string" &&
    typeof value.regionId === "string" &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    isPlaceStatus(value.status) &&
    isCoordinateStatus(value.coordinateStatus)
  );
}

function isPlaceStatus(value: unknown): value is SharedPlace["status"] {
  return value === "seed" || value === "beta" || value === "active" || value === "paused";
}

function isCoordinateStatus(value: unknown): value is SharedPlace["coordinateStatus"] {
  return value === "verified" || value === "TODO_COORDINATE_VERIFY" || value === "rejected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

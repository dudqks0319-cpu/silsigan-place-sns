import { PHOTO_MAX_DIMENSION as CONTRACT_PHOTO_MAX_DIMENSION, PHOTO_UPLOAD_MAX_BYTES } from "../../../packages/contracts/src/index.ts";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_REGION_RANKING_LIMIT = 50;
export const MAX_PLACE_RADIUS_M = 100_000;
export const PHOTO_MAX_BYTES = PHOTO_UPLOAD_MAX_BYTES;
export const PHOTO_MAX_DIMENSION = CONTRACT_PHOTO_MAX_DIMENSION;
export const PHOTO_ALLOWED_MIME_TYPES = ["image/webp", "image/jpeg"] as const;

export type ApiResponse<TData> =
  | {
      success: true;
      data: TData;
      meta?: Record<string, unknown>;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
      meta?: Record<string, unknown>;
    };

export type BBox = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

export type RadiusSearch = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  bbox: BBox;
};

export type PlaceRecord = {
  id: string;
  name: string;
  categoryId: string;
  areaId: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number;
  status: "seed" | "beta" | "active" | "paused";
  coordinateStatus: "verified" | "TODO_COORDINATE_VERIFY" | "rejected";
};

export type RankingRecord = {
  placeId: string;
  name: string;
  regionId: string;
  regionCode: string;
  areaCode: string;
  category: string;
  score: number;
  rank: number;
  windowHours: number;
  clickCount: number;
  likeCount: number;
  commentCount: number;
  photoCount: number;
  reportCount: number;
  uniqueUserCount: number;
  trend: "up" | "down" | "same";
  summary: string;
};

export type LikePolicyState = {
  likedPlaceIds: Set<string>;
  likedCommentIds: Set<string>;
  clickedPhotoIds: Set<string>;
};

export type RateLimitState = {
  count: number;
  resetsAt: number;
};

export type RateLimitResult =
  | {
      allowed: true;
      remaining: number;
      resetsAt: number;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      resetsAt: number;
    };

export function clampLimit(rawLimit: string | number | null | undefined, max = MAX_LIMIT, fallback = DEFAULT_LIMIT): number {
  const parsed = typeof rawLimit === "number" ? rawLimit : Number.parseInt(rawLimit ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, parsed));
}

export function parseBBox(rawBBox: string | null): BBox | null {
  if (!rawBBox) {
    return null;
  }

  const parts = rawBBox.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLat > maxLat || minLng > maxLng) {
    return null;
  }

  return { minLat, minLng, maxLat, maxLng };
}

export function parseRadiusSearch(rawLatitude: string | null, rawLongitude: string | null, rawRadius: string | null): RadiusSearch | null {
  if (!rawLatitude || !rawLongitude || !rawRadius) {
    return null;
  }

  const latitude = Number.parseFloat(rawLatitude);
  const longitude = Number.parseFloat(rawLongitude);
  const radius = Number.parseFloat(rawRadius);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius)) {
    return null;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radius <= 0) {
    return null;
  }

  const radiusMeters = Math.min(radius, MAX_PLACE_RADIUS_M);
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(Math.cos(toRadians(latitude)), 0.01));

  return {
    latitude,
    longitude,
    radiusMeters,
    bbox: {
      minLat: Math.max(-90, latitude - latDelta),
      minLng: Math.max(-180, longitude - lngDelta),
      maxLat: Math.min(90, latitude + latDelta),
      maxLng: Math.min(180, longitude + lngDelta),
    },
  };
}

export function intersectBBoxes(left: BBox | null, right: BBox | null): BBox | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const bbox = {
    minLat: Math.max(left.minLat, right.minLat),
    minLng: Math.max(left.minLng, right.minLng),
    maxLat: Math.min(left.maxLat, right.maxLat),
    maxLng: Math.min(left.maxLng, right.maxLng),
  };

  if (bbox.minLat > bbox.maxLat || bbox.minLng > bbox.maxLng) {
    return null;
  }

  return bbox;
}

export function filterPlacesByBBox<TPlace extends Pick<PlaceRecord, "latitude" | "longitude">>(
  places: TPlace[],
  bbox: BBox | null,
): TPlace[] {
  if (!bbox) {
    return places;
  }

  return places.filter(
    (place) =>
      place.latitude >= bbox.minLat &&
      place.latitude <= bbox.maxLat &&
      place.longitude >= bbox.minLng &&
      place.longitude <= bbox.maxLng,
  );
}

export function filterPlacesByRadius<TPlace extends Pick<PlaceRecord, "latitude" | "longitude">>(
  places: TPlace[],
  radiusSearch: RadiusSearch | null,
): TPlace[] {
  if (!radiusSearch) {
    return places;
  }

  return places.filter(
    (place) =>
      distanceMeters(
        { latitude: radiusSearch.latitude, longitude: radiusSearch.longitude },
        { latitude: place.latitude, longitude: place.longitude },
      ) <= radiusSearch.radiusMeters,
  );
}

export function rankRegionPlaces<TPlace extends Pick<PlaceRecord, "regionId" | "score">>(
  places: TPlace[],
  regionId: string | null,
  rawLimit: string | number | null | undefined,
): TPlace[] {
  const limit = clampLimit(rawLimit, MAX_REGION_RANKING_LIMIT, 10);

  return [...places]
    .filter((place) => !regionId || place.regionId === regionId)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function applySlidingWindowRateLimit(
  bucket: RateLimitState | undefined,
  nowMs: number,
  limit: number,
  windowMs: number,
): {
  state: RateLimitState;
  result: RateLimitResult;
} {
  if (!bucket || bucket.resetsAt <= nowMs) {
    const state = { count: 1, resetsAt: nowMs + windowMs };
    return {
      state,
      result: {
        allowed: true,
        remaining: limit - 1,
        resetsAt: state.resetsAt,
      },
    };
  }

  if (bucket.count >= limit) {
    return {
      state: bucket,
      result: {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - nowMs) / 1000)),
        resetsAt: bucket.resetsAt,
      },
    };
  }

  const state = { count: bucket.count + 1, resetsAt: bucket.resetsAt };
  return {
    state,
    result: {
      allowed: true,
      remaining: limit - state.count,
      resetsAt: state.resetsAt,
    },
  };
}

export function applyBoundedSlidingWindowRateLimit({
  buckets,
  key,
  nowMs,
  limit,
  windowMs,
  capacity,
}: {
  buckets: Map<string, RateLimitState>;
  key: string;
  nowMs: number;
  limit: number;
  windowMs: number;
  capacity: number;
}): {
  result: RateLimitResult;
  capacityExceeded: boolean;
} {
  const current = buckets.get(key);
  if (current && current.resetsAt > nowMs) {
    const { state, result } = applySlidingWindowRateLimit(current, nowMs, limit, windowMs);
    buckets.set(key, state);
    return { result, capacityExceeded: false };
  }

  if (current) {
    buckets.delete(key);
  }

  if (buckets.size >= capacity) {
    for (const [candidateKey, bucket] of buckets) {
      if (bucket.resetsAt <= nowMs) {
        buckets.delete(candidateKey);
      }
    }
  }

  if (buckets.size >= capacity) {
    const nextResetAt = Math.min(...[...buckets.values()].map((bucket) => bucket.resetsAt));
    return {
      result: {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((nextResetAt - nowMs) / 1_000)),
        resetsAt: nextResetAt,
      },
      capacityExceeded: true,
    };
  }

  const { state, result } = applySlidingWindowRateLimit(undefined, nowMs, limit, windowMs);
  buckets.set(key, state);
  return { result, capacityExceeded: false };
}

export function registerUniqueCommentLike(state: LikePolicyState, commentId: string): boolean {
  if (state.likedCommentIds.has(commentId)) {
    return false;
  }

  state.likedCommentIds.add(commentId);
  return true;
}

export function registerUniquePlaceLike(state: LikePolicyState, placeId: string): boolean {
  if (state.likedPlaceIds.has(placeId)) {
    return false;
  }

  state.likedPlaceIds.add(placeId);
  return true;
}

export function unregisterUniquePlaceLike(state: LikePolicyState, placeId: string): boolean {
  if (!state.likedPlaceIds.has(placeId)) {
    return false;
  }

  state.likedPlaceIds.delete(placeId);
  return true;
}

export function registerUniquePhotoClick(state: LikePolicyState, photoId: string): boolean {
  if (state.clickedPhotoIds.has(photoId)) {
    return false;
  }

  state.clickedPhotoIds.add(photoId);
  return true;
}

export type PhotoCompleteInput = {
  uploadId: string;
  placeId: string;
  regionCode?: string;
  byteSize: number;
  mimeType: string;
  width: number;
  height: number;
  clientReencoded: boolean;
  originalFilename?: string;
};

export function validatePhotoComplete(input: PhotoCompleteInput): {
  accepted: true;
  storageKey: string;
  policy: {
    maxBytes: number;
    maxDimension: number;
    allowedMimeTypes: readonly string[];
    originalFilenameStored: false;
    processing: "worker-metadata-stripped-client-reencoded";
  };
} {
  if (!input.uploadId.trim() || !input.placeId.trim()) {
    throw new Error("PHOTO_UPLOAD_INVALID_TARGET");
  }

  if (input.originalFilename) {
    throw new Error("PHOTO_ORIGINAL_FILENAME_FORBIDDEN");
  }

  if (input.byteSize < 1 || input.byteSize > PHOTO_MAX_BYTES) {
    throw new Error("PHOTO_SIZE_LIMIT");
  }

  if (!PHOTO_ALLOWED_MIME_TYPES.includes(input.mimeType as (typeof PHOTO_ALLOWED_MIME_TYPES)[number])) {
    throw new Error("PHOTO_MIME_TYPE");
  }

  if (input.width < 1 || input.height < 1 || input.width > PHOTO_MAX_DIMENSION || input.height > PHOTO_MAX_DIMENSION) {
    throw new Error("PHOTO_DIMENSION_LIMIT");
  }

  if (!input.clientReencoded) {
    throw new Error("PHOTO_CLIENT_REENCODE_REQUIRED");
  }

  const extension = input.mimeType === "image/webp" ? "webp" : "jpg";
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const regionCode = input.regionCode?.trim() || "unknown";

  return {
    accepted: true,
    storageKey: `photos/${regionCode}/${input.placeId}/${year}/${month}/${crypto.randomUUID()}.${extension}`,
    policy: {
      maxBytes: PHOTO_MAX_BYTES,
      maxDimension: PHOTO_MAX_DIMENSION,
      allowedMimeTypes: PHOTO_ALLOWED_MIME_TYPES,
      originalFilenameStored: false,
      processing: "worker-metadata-stripped-client-reencoded",
    },
  };
}

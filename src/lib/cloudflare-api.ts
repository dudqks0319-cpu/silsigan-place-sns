import {
  DEFAULT_FEATURE_FLAGS,
  PHOTO_RIGHTS_TERMS_VERSION,
  featureFlagKeys,
  liveSignalDimensions,
  type FeatureFlagKey,
  type HashtagSummary,
  type ListHashtagParams,
  type LiveSignalDimension,
} from "../../packages/contracts/src/index.ts";
import type { OfficialTourismPlace } from "./travel-guide";

type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDimensionSettings(value: unknown): CloudflareRuntimeConfig["dimensionSettings"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!isUnknownRecord(candidate)) {
      return [];
    }

    const { settingKey, dimension, defaultTtlSeconds, currentEligible } = candidate;
    const validDimension = dimension === null
      || (typeof dimension === "string" && liveSignalDimensions.includes(dimension as LiveSignalDimension));
    if (
      typeof settingKey !== "string"
      || settingKey.trim().length === 0
      || !validDimension
      || !Number.isInteger(defaultTtlSeconds)
      || (defaultTtlSeconds as number) <= 0
      || typeof currentEligible !== "boolean"
    ) {
      return [];
    }

    return [{
      settingKey: settingKey.trim(),
      dimension: dimension as LiveSignalDimension | null,
      defaultTtlSeconds: defaultTtlSeconds as number,
      currentEligible,
    }];
  });
}

export type CloudflareApiSuccess<TData> = {
  success: true;
  data: TData;
  meta?: Record<string, unknown>;
};

export type CloudflareApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
};

export type CloudflareApiResponse<TData> = CloudflareApiSuccess<TData> | CloudflareApiFailure;

export type CloudflareApiClientOptions = {
  baseUrl: string;
  anonymousId?: string;
  fetcher?: typeof fetch;
};

export type CloudflarePlace = {
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

export type CloudflareRanking = {
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

export type CloudflareComment = {
  id: string;
  placeId: string;
  body: string;
  likeCount: number;
  hiddenAt: string | null;
  createdAt: string;
  ownedByCurrentSession: boolean;
};

export type CloudflarePhoto = {
  id: string;
  placeId: string;
  previewUrl?: string | null;
  mimeType: "image/webp" | "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: "pending" | "ready" | "rejected";
  createdAt: string;
};

export type CloudflareReport = {
  id: string;
  targetType: "place" | "post" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  anonymousUserId: string;
  note: string | null;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
};

export type CloudflareRealtimeEvent = {
  type: "place.liked" | "comment.created" | "photo.ready" | "report.created" | "heartbeat";
  scope: "place" | "region" | "global";
  roomId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CloudflareRealtimeRoom = {
  mode: "polling" | "durable-object-polling" | "durable-object";
  scope: "place" | "region" | "global";
  roomId: string;
  events: CloudflareRealtimeEvent[];
};

export type CloudflareRuntimeConfig = {
  contractVersion: 2;
  dataMode: "live" | "demo";
  featureFlags: Record<FeatureFlagKey, boolean>;
  dimensionSettings: Array<{
    settingKey: string;
    dimension: LiveSignalDimension | null;
    defaultTtlSeconds: number;
    currentEligible: boolean;
  }>;
  photoUploadProtection: {
    turnstileRequired: boolean;
    turnstileSiteKey: string | null;
  };
};

export const FAIL_CLOSED_PHOTO_UPLOAD_PROTECTION: CloudflareRuntimeConfig["photoUploadProtection"] = {
  turnstileRequired: true,
  turnstileSiteKey: null,
};

export function normalizeCloudflareRuntimeConfig(value: unknown): CloudflareRuntimeConfig {
  if (!isUnknownRecord(value) || value.contractVersion !== 2 || (value.dataMode !== "live" && value.dataMode !== "demo")) {
    throw new Error("실시간 API 설정 응답이 올바르지 않습니다.");
  }

  const rawFlags = isUnknownRecord(value.featureFlags) ? value.featureFlags : {};
  const featureFlags = Object.fromEntries(
    featureFlagKeys.map((key) => [key, rawFlags[key] === true]),
  ) as Record<FeatureFlagKey, boolean>;
  const rawProtection = isUnknownRecord(value.photoUploadProtection) ? value.photoUploadProtection : null;
  const hasValidProtection = rawProtection !== null
    && typeof rawProtection.turnstileRequired === "boolean"
    && Object.hasOwn(rawProtection, "turnstileSiteKey")
    && (rawProtection.turnstileSiteKey === null || typeof rawProtection.turnstileSiteKey === "string");
  const photoUploadProtection = hasValidProtection
    ? {
        turnstileRequired: rawProtection.turnstileRequired as boolean,
        turnstileSiteKey: typeof rawProtection.turnstileSiteKey === "string"
          ? rawProtection.turnstileSiteKey.trim() || null
          : null,
      }
    : { ...FAIL_CLOSED_PHOTO_UPLOAD_PROTECTION };

  return {
    contractVersion: 2,
    dataMode: value.dataMode,
    featureFlags: { ...DEFAULT_FEATURE_FLAGS, ...featureFlags },
    dimensionSettings: normalizeDimensionSettings(value.dimensionSettings),
    photoUploadProtection,
  };
}

export type CloudflarePlaceStatus = {
  contractVersion: 2;
  placeId: string;
  dataMode: "live" | "demo";
  status: "likely_good" | "check_before_visit" | "likely_crowded" | "insufficient";
  currentSignals: Array<{
    id: string;
    placeId: string;
    dimension: LiveSignalDimension;
    valueCode: string;
    valueNumber?: number;
    valueText?: string;
    unit?: string;
    sourceId: string;
    sourceType: string;
    sourceName: string;
    attributionText?: string;
    observedAt: string;
    fetchedAt: string;
    expiresAt: string;
    confidenceScore: number;
    isEstimated: boolean;
    isExpired: false;
  }>;
  missingRequiredDimensions: LiveSignalDimension[];
  conflictingDimensions: LiveSignalDimension[];
  independentSourceCount: number;
  confidenceScore: number;
  reasonCodes: string[];
  officialTourismPlace: OfficialTourismPlace | null;
  observedAt: string | null;
  computedAt: string;
};

export type UploadPhotoInput = {
  placeId: string;
  byteSize: number;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  clientReencoded: true;
  rightsAttested: true;
  rightsPolicyVersion: typeof PHOTO_RIGHTS_TERMS_VERSION;
  blob: Blob;
};

export type PhotoUploadTicket = {
  uploadId: string;
  method: "POST";
  uploadUrl: "/api/photos/upload";
  storageKey: string;
  ticket: string | null;
  expiresAt: string | null;
  rightsPolicyVersion: typeof PHOTO_RIGHTS_TERMS_VERSION;
};

export type ListRankingParams = {
  limit?: number;
  regionId?: string;
  areaId?: string;
  categoryId?: string;
  bbox?: string;
};

export type CloudflareApiClient = {
  anonymousId: string | null;
  getRuntimeConfig: (regionCode?: string) => Promise<CloudflareApiSuccess<CloudflareRuntimeConfig>>;
  getPlaceStatus: (placeId: string) => Promise<CloudflareApiSuccess<CloudflarePlaceStatus>>;
  listPlaces: (params?: { limit?: number; bbox?: string; lat?: number; lng?: number; radius?: number; regionId?: string; categoryId?: string }) => Promise<CloudflareApiSuccess<CloudflarePlace[]>>;
  listRankings: (params?: ListRankingParams) => Promise<CloudflareApiSuccess<CloudflareRanking[]>>;
  listHashtags: (params?: ListHashtagParams) => Promise<CloudflareApiSuccess<HashtagSummary[]>>;
  listComments: (params?: { placeId?: string; limit?: number }) => Promise<CloudflareApiSuccess<CloudflareComment[]>>;
  createComment: (input: { placeId: string; body: string }) => Promise<CloudflareApiSuccess<CloudflareComment>>;
  likePlace: (placeId: string) => Promise<CloudflareApiSuccess<{ placeId: string; likeCount: number; created: boolean }>>;
  unlikePlace: (placeId: string) => Promise<CloudflareApiSuccess<{ placeId: string; likeCount: number; deleted: boolean }>>;
  likeComment: (commentId: string) => Promise<CloudflareApiSuccess<{ commentId: string; likeCount: number; created: boolean }>>;
  uploadPhoto: (input: UploadPhotoInput) => Promise<CloudflareApiSuccess<{ photo: CloudflarePhoto; storageKey: string }>>;
  clickPhoto: (photoId: string) => Promise<CloudflareApiSuccess<{ photoId: string; clickCount: number; created: boolean }>>;
  createReport: (input: Pick<CloudflareReport, "targetType" | "targetId" | "reason"> & { note?: string }) => Promise<CloudflareApiSuccess<CloudflareReport>>;
  getRealtimeRoom: (scope: CloudflareRealtimeRoom["scope"], roomId?: string) => Promise<CloudflareApiSuccess<CloudflareRealtimeRoom>>;
};

export function createCloudflareApiClient(options: CloudflareApiClientOptions): CloudflareApiClient {
  const fetcher = options.fetcher ?? fetch;
  let anonymousId = options.anonymousId ?? null;

  async function request<TData>(path: string, init: RequestInit = {}): Promise<CloudflareApiSuccess<TData>> {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && typeof init.body === "string") {
      headers.set("content-type", "application/json");
    }

    if (anonymousId) {
      headers.set("x-silsigan-anon-id", anonymousId);
    }

    const response = await fetcher(new URL(path, options.baseUrl), {
      ...init,
      headers,
      credentials: "include",
    });
    const nextAnonymousId = response.headers.get("x-silsigan-anon-id");
    if (nextAnonymousId) {
      anonymousId = nextAnonymousId;
    }

    const payload = (await response.json()) as CloudflareApiResponse<TData>;
    if (!payload.success) {
      throw new CloudflareApiError(response.status, payload.error.code, payload.error.message, payload.error.details);
    }

    return payload;
  }

  return {
    get anonymousId() {
      return anonymousId;
    },
    getRuntimeConfig(regionCode) {
      return request(`/api/config${query({ regionCode })}`);
    },
    getPlaceStatus(placeId) {
      return request(`/api/places/${encodeURIComponent(placeId)}/status`);
    },
    listPlaces(params = {}) {
      return request(`/api/places${query(params)}`);
    },
    listRankings(params = {}) {
      return request(`/api/rankings${query(params)}`);
    },
    listHashtags(params = {}) {
      return request(`/api/hashtags${query(params)}`);
    },
    listComments(params = {}) {
      return request(`/api/comments${query(params)}`);
    },
    createComment(input) {
      return request("/api/comments", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    likePlace(placeId) {
      return request(`/api/places/${encodeURIComponent(placeId)}/like`, {
        method: "POST",
      });
    },
    unlikePlace(placeId) {
      return request(`/api/places/${encodeURIComponent(placeId)}/like`, {
        method: "DELETE",
      });
    },
    likeComment(commentId) {
      return request(`/api/comments/${encodeURIComponent(commentId)}/like`, {
        method: "POST",
      });
    },
    async uploadPhoto(input) {
      const ticket = await request<PhotoUploadTicket>("/api/photos/upload-ticket", {
        method: "POST",
        body: JSON.stringify({
          placeId: input.placeId,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          rightsAttested: input.rightsAttested,
          rightsPolicyVersion: input.rightsPolicyVersion,
        }),
      });

      if (
        ticket.data.method !== "POST"
        || ticket.data.uploadUrl !== "/api/photos/upload"
        || ticket.data.rightsPolicyVersion !== input.rightsPolicyVersion
      ) {
        throw new CloudflareApiError(502, "PHOTO_UPLOAD_CONTRACT_INVALID", "사진 업로드 계약을 확인할 수 없습니다.");
      }

      const formData = new FormData();
      formData.set("uploadId", ticket.data.uploadId);
      if (ticket.data.ticket && ticket.data.expiresAt) {
        formData.set("ticket", ticket.data.ticket);
        formData.set("ticketExpiresAt", ticket.data.expiresAt);
      }
      formData.set("placeId", input.placeId);
      formData.set("byteSize", String(input.byteSize));
      formData.set("mimeType", input.mimeType);
      formData.set("width", String(input.width));
      formData.set("height", String(input.height));
      formData.set("clientReencoded", "true");
      formData.set("file", input.blob, `upload.${input.mimeType === "image/jpeg" ? "jpg" : "webp"}`);

      return request("/api/photos/upload", {
        method: "POST",
        body: formData,
      });
    },
    clickPhoto(photoId) {
      return request(`/api/photos/${encodeURIComponent(photoId)}/click`, {
        method: "POST",
      });
    },
    createReport(input) {
      return request("/api/moderation/reports", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getRealtimeRoom(scope, roomId) {
      const path = scope === "global" ? "/api/realtime/global" : `/api/realtime/${scope}/${encodeURIComponent(roomId ?? "")}`;
      return request(path);
    },
  };
}

export class CloudflareApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  });

  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

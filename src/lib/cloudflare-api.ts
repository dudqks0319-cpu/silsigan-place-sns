import type { FeatureFlagKey, LiveSignalDimension } from "../../packages/contracts/src/index.ts";

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
  costControls: {
    photoUploadsEnabled: boolean;
    photoMaxBytes: number;
    photoMaxDimension: number;
    photoDailyLimit: number;
    photoReadMinuteLimit: number;
    enforcement: "d1-persistent-plus-worker-ip" | "worker-session-plus-ip";
  };
  dimensionSettings: Array<{
    settingKey: string;
    dimension: LiveSignalDimension | null;
    defaultTtlSeconds: number;
    currentEligible: boolean;
  }>;
};

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
    expiresAt?: string;
    confidenceScore: number;
    isEstimated: boolean;
    isExpired: false;
  }>;
  missingRequiredDimensions: LiveSignalDimension[];
  conflictingDimensions: LiveSignalDimension[];
  independentSourceCount: number;
  confidenceScore: number;
  reasonCodes: string[];
  observedAt: string | null;
  computedAt: string;
};

export type CompletePhotoInput = {
  uploadId: string;
  placeId: string;
  byteSize: number;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  clientReencoded: true;
  imageBase64?: string;
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
  listComments: (params?: { placeId?: string; limit?: number }) => Promise<CloudflareApiSuccess<CloudflareComment[]>>;
  createComment: (input: { placeId: string; body: string }) => Promise<CloudflareApiSuccess<CloudflareComment>>;
  likePlace: (placeId: string) => Promise<CloudflareApiSuccess<{ placeId: string; likeCount: number; created: boolean }>>;
  unlikePlace: (placeId: string) => Promise<CloudflareApiSuccess<{ placeId: string; likeCount: number; deleted: boolean }>>;
  likeComment: (commentId: string) => Promise<CloudflareApiSuccess<{ commentId: string; likeCount: number; created: boolean }>>;
  completePhoto: (input: CompletePhotoInput) => Promise<CloudflareApiSuccess<{ photo: CloudflarePhoto; storageKey: string }>>;
  clickPhoto: (photoId: string) => Promise<CloudflareApiSuccess<{ photoId: string; clickCount: number; created: boolean }>>;
  createReport: (input: Pick<CloudflareReport, "targetType" | "targetId" | "reason"> & { note?: string }) => Promise<CloudflareApiSuccess<CloudflareReport>>;
  getRealtimeRoom: (scope: CloudflareRealtimeRoom["scope"], roomId?: string) => Promise<CloudflareApiSuccess<CloudflareRealtimeRoom>>;
};

export function createCloudflareApiClient(options: CloudflareApiClientOptions): CloudflareApiClient {
  const fetcher = options.fetcher ?? fetch;
  let anonymousId = options.anonymousId ?? null;

  async function request<TData>(path: string, init: RequestInit = {}): Promise<CloudflareApiSuccess<TData>> {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && init.body) {
      headers.set("content-type", "application/json");
    }

    if (anonymousId) {
      headers.set("x-silsigan-anon-id", anonymousId);
    }

    const response = await fetcher(new URL(path, options.baseUrl), {
      ...init,
      headers,
      credentials: "omit",
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
    completePhoto(input) {
      return request("/api/photos/complete", {
        method: "POST",
        body: JSON.stringify(input),
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

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  });

  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

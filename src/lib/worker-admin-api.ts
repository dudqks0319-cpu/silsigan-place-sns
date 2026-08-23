import { ApiError } from "./errors.ts";

export type WorkerModerationStatus = "open" | "accepted" | "rejected";
export type WorkerCoordinateStatus = "verified" | "TODO_COORDINATE_VERIFY" | "rejected";

export type WorkerModerationReportSummary = {
  id: string;
  targetType: "place" | "post" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  status: WorkerModerationStatus;
  createdAt: string;
};

export type WorkerFieldReportModerationStatus = "pending" | "approved" | "rejected";

export type WorkerFieldReportDecisionResult = {
  reportId: string;
  decision: Exclude<WorkerFieldReportModerationStatus, "pending">;
  public: boolean;
  previousStatus: WorkerFieldReportModerationStatus;
};

export type WorkerFieldReportSummary = {
  id: string;
  placeId: string;
  placeName: string;
  category: "tourism" | "festival" | "restaurant_cafe" | "hospital" | "public_office" | "parking";
  crowdLevel: "quiet" | "normal" | "busy" | "packed" | null;
  lineStatus: "none" | "short" | "medium" | "long" | null;
  parkingStatus: "available" | "limited" | "full" | "unknown" | null;
  verifiedRadiusM: 50 | 150 | 300 | null;
  observedDimensions: Array<"crowd" | "queue" | "parking" | "local_condition">;
  createdAt: string;
  expiresAt: string;
  moderationStatus: WorkerFieldReportModerationStatus;
  isExpired: boolean;
};

export type WorkerPlaceCoordinateStatusSummary = {
  placeId: string;
  coordinateStatus: WorkerCoordinateStatus;
  latitude: number | null;
  longitude: number | null;
};

export type WorkerUserRestrictionSummary = {
  anonymousUserId: string;
  restricted: boolean;
  blockedUntil: string | null;
};

export type WorkerSourceHealthStatus = "healthy" | "degraded" | "down";

export type WorkerSourceHealthSummary = {
  id: string;
  sourceId: string;
  sourceKey: string;
  status: WorkerSourceHealthStatus;
  message: string | null;
  responseTimeMs: number | null;
  checkedAt: string;
};

export type WorkerDataSourceSummary = {
  sourceKey: string;
  sourceName: string;
  providerName: string;
  sourceType: "official_live" | "official_periodic" | "official_static" | "venue_operator" | "verified_ugc" | "ugc" | "consensus" | "model_estimate";
  commercialUseStatus: "pending" | "allowed" | "allowed_with_attribution" | "agreement_required" | "prohibited" | "unknown";
  enabled: boolean;
  healthStatus: "unknown" | WorkerSourceHealthStatus;
  activationStatus: "active" | "awaiting_rights" | "unhealthy" | "inactive";
  lastTermsCheckedAt: string | null;
  lastHealthCheckedAt: string | null;
};

type WorkerApiSuccess<TData> = {
  success: true;
  data: TData;
};

type WorkerApiFailure = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type WorkerApiResponse<TData> = WorkerApiSuccess<TData> | WorkerApiFailure;

type WorkerAdminApiEnv = Record<string, string | undefined>;

type WorkerAdminRequestOptions = {
  env?: WorkerAdminApiEnv;
  fetcher?: typeof fetch;
};

export async function listWorkerModerationReports(
  input: { status?: WorkerModerationStatus; limit?: number } = {},
  options: WorkerAdminRequestOptions = {},
) {
  const status = input.status ?? "open";
  const limit = clampAdminLimit(input.limit, 20);
  const url = workerAdminUrl(`/api/moderation/reports?status=${encodeURIComponent(status)}&limit=${limit}`, options.env);
  const response = await requestWorkerAdmin<unknown[]>(url, { method: "GET" }, options);

  return response.map(toModerationReportSummary);
}

export async function moderateWorkerReport(
  input: { reportId: string; status: Exclude<WorkerModerationStatus, "open">; reason?: string },
  options: WorkerAdminRequestOptions = {},
) {
  if (!input.reportId) {
    throw new ApiError(400, "WORKER_REPORT_ID_REQUIRED", "신고 ID가 필요합니다.");
  }

  const url = workerAdminUrl(`/api/moderation/reports/${encodeURIComponent(input.reportId)}/action`, options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        status: input.status,
        reason: input.reason ?? "admin queue action",
      }),
    },
    options,
  );

  return toModerationReportSummary(response);
}

export async function listWorkerFieldReports(
  input: { status?: WorkerFieldReportModerationStatus | "all"; limit?: number } = {},
  options: WorkerAdminRequestOptions = {},
) {
  const status = input.status ?? "pending";
  const limit = clampAdminLimit(input.limit, 50);
  const url = workerAdminUrl(`/api/admin/field-reports?status=${encodeURIComponent(status)}&limit=${limit}`, options.env);
  const response = await requestWorkerAdmin<unknown[]>(url, { method: "GET" }, options);

  return response.map(toFieldReportSummary);
}

export async function listWorkerSourceHealth(
  input: { limit?: number } = {},
  options: WorkerAdminRequestOptions = {},
) {
  const limit = clampAdminLimit(input.limit, 50);
  const url = workerAdminUrl(`/api/admin/sources/health?limit=${limit}`, options.env);
  const response = await requestWorkerAdmin<unknown[]>(url, { method: "GET" }, options);

  if (!Array.isArray(response)) {
    throw new ApiError(502, "WORKER_SOURCE_HEALTH_SHAPE_INVALID", "Worker 데이터 출처 상태 응답 형식이 올바르지 않습니다.");
  }

  return response.map(toSourceHealthSummary);
}

export async function listWorkerDataSources(options: WorkerAdminRequestOptions = {}) {
  const url = workerAdminUrl("/api/sources", options.env);
  const response = await requestWorkerAdmin<unknown>(url, { method: "GET" }, options);

  if (!Array.isArray(response)) {
    throw new ApiError(502, "WORKER_SOURCE_REGISTRY_SHAPE_INVALID", "Worker 데이터 출처 목록 응답 형식이 올바르지 않습니다.");
  }

  return response.map(toDataSourceSummary);
}

export async function moderateWorkerFieldReport(
  input: { reportId: string; decision: Exclude<WorkerFieldReportModerationStatus, "pending">; reason?: string },
  options: WorkerAdminRequestOptions = {},
) {
  if (!/^field_report_[a-zA-Z0-9-]{8,100}$/.test(input.reportId)) {
    throw new ApiError(400, "FIELD_REPORT_ID_INVALID", "현장 제보 ID가 올바르지 않습니다.");
  }

  const url = workerAdminUrl(`/api/admin/field-reports/${encodeURIComponent(input.reportId)}/moderation`, options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        decision: input.decision,
        reason: input.reason ?? "admin field report moderation",
      }),
    },
    options,
  );

  return toFieldReportDecisionResult(response);
}

export async function updateWorkerPlaceCoordinateStatus(
  input: {
    placeId: string;
    coordinateStatus: WorkerCoordinateStatus;
    latitude?: number;
    longitude?: number;
    source: string;
    reason: string;
  },
  options: WorkerAdminRequestOptions = {},
) {
  if (!input.placeId) {
    throw new ApiError(400, "WORKER_PLACE_ID_REQUIRED", "장소 ID가 필요합니다.");
  }

  if (input.coordinateStatus === "verified" && (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude))) {
    throw new ApiError(400, "WORKER_COORDINATE_REQUIRED", "검증된 장소 좌표가 필요합니다.");
  }

  const url = workerAdminUrl("/api/admin/places/coordinate-status", options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        placeId: input.placeId,
        coordinateStatus: input.coordinateStatus,
        ...(input.coordinateStatus === "verified"
          ? {
              latitude: input.latitude,
              longitude: input.longitude,
            }
          : {}),
        source: input.source,
        reason: input.reason,
      }),
    },
    options,
  );

  return toCoordinateStatusSummary(response);
}

export async function restrictWorkerAnonymousUser(
  input: { anonymousUserId: string; reason: string; blockedUntil?: string },
  options: WorkerAdminRequestOptions = {},
) {
  if (!input.anonymousUserId) {
    throw new ApiError(400, "WORKER_ANONYMOUS_USER_ID_REQUIRED", "익명 사용자 ID가 필요합니다.");
  }

  const url = workerAdminUrl("/api/admin/users/restrict", options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        anonymousUserId: input.anonymousUserId,
        reason: input.reason,
        ...(input.blockedUntil ? { blockedUntil: input.blockedUntil } : {}),
      }),
    },
    options,
  );

  return toUserRestrictionSummary(response);
}

export async function unrestrictWorkerAnonymousUser(
  input: { anonymousUserId: string; reason?: string },
  options: WorkerAdminRequestOptions = {},
) {
  if (!input.anonymousUserId) {
    throw new ApiError(400, "WORKER_ANONYMOUS_USER_ID_REQUIRED", "익명 사용자 ID가 필요합니다.");
  }

  const url = workerAdminUrl("/api/admin/users/unrestrict", options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        anonymousUserId: input.anonymousUserId,
        reason: input.reason ?? "admin unrestricted user",
      }),
    },
    options,
  );

  return toUserRestrictionSummary(response);
}

export function workerAdminApiConfigured(env: WorkerAdminApiEnv = process.env) {
  return Boolean(workerApiBaseUrl(env) && workerAdminToken(env));
}

async function requestWorkerAdmin<TData>(url: URL, init: RequestInit, options: WorkerAdminRequestOptions) {
  const token = workerAdminToken(options.env);
  if (!token) {
    throw new ApiError(503, "WORKER_ADMIN_TOKEN_NOT_CONFIGURED", "Worker 운영 토큰이 설정되지 않았습니다.");
  }

  const headers = new Headers(init.headers);
  headers.set("x-silsigan-admin-token", token);
  headers.set("x-silsigan-admin-subject", "next-admin");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, {
    ...init,
    headers,
  });
  const payload = (await response.json()) as WorkerApiResponse<TData>;
  if (!response.ok || !payload.success) {
    throw new ApiError(
      response.status,
      payload.success ? "WORKER_ADMIN_REQUEST_FAILED" : payload.error?.code ?? "WORKER_ADMIN_REQUEST_FAILED",
      payload.success ? "Worker 운영 요청이 실패했습니다." : payload.error?.message ?? "Worker 운영 요청이 실패했습니다.",
      payload.success ? undefined : payload.error?.details,
    );
  }

  return payload.data;
}

function workerAdminUrl(path: string, env: WorkerAdminApiEnv = process.env) {
  const baseUrl = workerApiBaseUrl(env);
  if (!baseUrl) {
    throw new ApiError(503, "WORKER_API_BASE_URL_NOT_CONFIGURED", "Worker API URL이 설정되지 않았습니다.");
  }

  return new URL(path, `${baseUrl}/`);
}

function workerApiBaseUrl(env: WorkerAdminApiEnv = process.env) {
  return (env.SILSIGAN_WORKER_API_BASE_URL ?? env.SILSIGAN_STAGING_API_BASE_URL ?? env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function workerAdminToken(env: WorkerAdminApiEnv = process.env) {
  return (env.SILSIGAN_WORKER_ADMIN_TOKEN ?? env.SILSIGAN_STAGING_ADMIN_TOKEN ?? "").trim();
}

function clampAdminLimit(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value ?? fallback)) {
    return fallback;
  }

  return Math.min(50, Math.max(1, Math.trunc(value ?? fallback)));
}

function toModerationReportSummary(value: unknown): WorkerModerationReportSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_REPORT_SHAPE_INVALID", "Worker 신고 응답 형식이 올바르지 않습니다.");
  }

  const targetType = stringEnum(value.targetType, ["place", "post", "comment", "photo"] as const, "targetType");
  const reason = stringEnum(value.reason, ["false_content", "spam", "privacy_face", "privacy_plate", "sensitive_info", "other"] as const, "reason");
  const status = stringEnum(value.status, ["open", "accepted", "rejected"] as const, "status");
  const id = stringField(value.id, "id");
  const targetId = stringField(value.targetId, "targetId");
  const createdAt = stringField(value.createdAt, "createdAt");

  return {
    id,
    targetType,
    targetId,
    reason,
    status,
    createdAt,
  };
}

function toFieldReportSummary(value: unknown): WorkerFieldReportSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_FIELD_REPORT_SHAPE_INVALID", "Worker 현장 제보 응답 형식이 올바르지 않습니다.");
  }

  return {
    id: stringField(value.id, "id", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    placeId: stringField(value.placeId, "placeId", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    placeName: stringField(value.placeName, "placeName", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    category: stringEnum(value.category, ["tourism", "festival", "restaurant_cafe", "hospital", "public_office", "parking"] as const, "category", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    crowdLevel: nullableStringEnum(value.crowdLevel, ["quiet", "normal", "busy", "packed"] as const, "crowdLevel"),
    lineStatus: nullableStringEnum(value.lineStatus, ["none", "short", "medium", "long"] as const, "lineStatus"),
    parkingStatus: nullableStringEnum(value.parkingStatus, ["available", "limited", "full", "unknown"] as const, "parkingStatus"),
    verifiedRadiusM: nullableNumberEnum(value.verifiedRadiusM, [50, 150, 300] as const, "verifiedRadiusM"),
    observedDimensions: stringArrayEnum(value.observedDimensions, ["crowd", "queue", "parking", "local_condition"] as const, "observedDimensions"),
    createdAt: stringField(value.createdAt, "createdAt", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    expiresAt: stringField(value.expiresAt, "expiresAt", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    moderationStatus: stringEnum(value.moderationStatus, ["pending", "approved", "rejected"] as const, "moderationStatus", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    isExpired: booleanField(value.isExpired, "isExpired", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
  };
}

function toFieldReportDecisionResult(value: unknown): WorkerFieldReportDecisionResult {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_FIELD_REPORT_DECISION_SHAPE_INVALID", "Worker 현장 제보 처리 응답 형식이 올바르지 않습니다.");
  }

  return {
    reportId: stringField(value.reportId, "reportId", "WORKER_FIELD_REPORT_DECISION_SHAPE_INVALID"),
    decision: stringEnum(value.decision, ["approved", "rejected"] as const, "decision", "WORKER_FIELD_REPORT_DECISION_SHAPE_INVALID"),
    public: booleanField(value.public, "public", "WORKER_FIELD_REPORT_DECISION_SHAPE_INVALID"),
    previousStatus: stringEnum(value.previousStatus, ["pending", "approved", "rejected"] as const, "previousStatus", "WORKER_FIELD_REPORT_DECISION_SHAPE_INVALID"),
  };
}

function toSourceHealthSummary(value: unknown): WorkerSourceHealthSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_SOURCE_HEALTH_SHAPE_INVALID", "Worker 데이터 출처 상태 응답 형식이 올바르지 않습니다.");
  }

  return {
    id: stringField(value.id, "id", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    sourceId: stringField(value.sourceId, "sourceId", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    sourceKey: stringField(value.sourceKey, "sourceKey", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    status: stringEnum(value.status, ["healthy", "degraded", "down"] as const, "status", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    message: nullableStringField(value.message, "message", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    responseTimeMs: nullableNonNegativeNumberField(value.responseTimeMs, "responseTimeMs", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
    checkedAt: stringField(value.checkedAt, "checkedAt", "WORKER_SOURCE_HEALTH_SHAPE_INVALID"),
  };
}

function toDataSourceSummary(value: unknown): WorkerDataSourceSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_SOURCE_REGISTRY_SHAPE_INVALID", "Worker 데이터 출처 목록 응답 형식이 올바르지 않습니다.");
  }

  return {
    sourceKey: stringField(value.sourceKey, "sourceKey", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    sourceName: stringField(value.sourceName, "sourceName", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    providerName: stringField(value.providerName, "providerName", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    sourceType: stringEnum(
      value.sourceType,
      ["official_live", "official_periodic", "official_static", "venue_operator", "verified_ugc", "ugc", "consensus", "model_estimate"] as const,
      "sourceType",
      "WORKER_SOURCE_REGISTRY_SHAPE_INVALID",
    ),
    commercialUseStatus: stringEnum(
      value.commercialUseStatus,
      ["pending", "allowed", "allowed_with_attribution", "agreement_required", "prohibited", "unknown"] as const,
      "commercialUseStatus",
      "WORKER_SOURCE_REGISTRY_SHAPE_INVALID",
    ),
    enabled: booleanField(value.enabled, "enabled", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    healthStatus: stringEnum(value.healthStatus, ["unknown", "healthy", "degraded", "down"] as const, "healthStatus", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    activationStatus: stringEnum(value.activationStatus, ["active", "awaiting_rights", "unhealthy", "inactive"] as const, "activationStatus", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    lastTermsCheckedAt: nullableStringField(value.lastTermsCheckedAt, "lastTermsCheckedAt", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
    lastHealthCheckedAt: nullableStringField(value.lastHealthCheckedAt, "lastHealthCheckedAt", "WORKER_SOURCE_REGISTRY_SHAPE_INVALID"),
  };
}

function toCoordinateStatusSummary(value: unknown): WorkerPlaceCoordinateStatusSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_COORDINATE_STATUS_SHAPE_INVALID", "Worker 좌표 상태 응답 형식이 올바르지 않습니다.");
  }

  return {
    placeId: stringField(value.placeId, "placeId", "WORKER_COORDINATE_STATUS_SHAPE_INVALID"),
    coordinateStatus: stringEnum(value.coordinateStatus, ["verified", "TODO_COORDINATE_VERIFY", "rejected"] as const, "coordinateStatus", "WORKER_COORDINATE_STATUS_SHAPE_INVALID"),
    latitude: nullableNumberField(value.latitude, "latitude", "WORKER_COORDINATE_STATUS_SHAPE_INVALID"),
    longitude: nullableNumberField(value.longitude, "longitude", "WORKER_COORDINATE_STATUS_SHAPE_INVALID"),
  };
}

function toUserRestrictionSummary(value: unknown): WorkerUserRestrictionSummary {
  if (!isRecord(value)) {
    throw new ApiError(502, "WORKER_USER_RESTRICTION_SHAPE_INVALID", "Worker 사용자 제한 응답 형식이 올바르지 않습니다.");
  }

  return {
    anonymousUserId: stringField(value.anonymousUserId, "anonymousUserId", "WORKER_USER_RESTRICTION_SHAPE_INVALID"),
    restricted: booleanField(value.restricted, "restricted", "WORKER_USER_RESTRICTION_SHAPE_INVALID"),
    blockedUntil: nullableStringField(value.blockedUntil, "blockedUntil", "WORKER_USER_RESTRICTION_SHAPE_INVALID"),
  };
}

function stringField(value: unknown, field: string, code = "WORKER_REPORT_SHAPE_INVALID") {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
  }

  return value;
}

function nullableStringField(value: unknown, field: string, code: string) {
  if (value === null || value === undefined) {
    return null;
  }

  return stringField(value, field, code);
}

function nullableNumberField(value: unknown, field: string, code: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function nullableNonNegativeNumberField(value: unknown, field: string, code: string) {
  const numberValue = nullableNumberField(value, field, code);
  if (numberValue === null || numberValue >= 0) {
    return numberValue;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function booleanField(value: unknown, field: string, code: string) {
  if (typeof value === "boolean") {
    return value;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function stringEnum<const TValue extends string>(value: unknown, allowed: readonly TValue[], field: string, code = "WORKER_REPORT_SHAPE_INVALID"): TValue {
  if (typeof value === "string" && allowed.includes(value as TValue)) {
    return value as TValue;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function nullableStringEnum<const TValue extends string>(value: unknown, allowed: readonly TValue[], field: string, code = "WORKER_REPORT_SHAPE_INVALID"): TValue | null {
  if (value === null) {
    return null;
  }

  return stringEnum(value, allowed, field, code);
}

function nullableNumberEnum<const TValue extends number>(value: unknown, allowed: readonly TValue[], field: string, code = "WORKER_REPORT_SHAPE_INVALID"): TValue | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && allowed.includes(value as TValue)) {
    return value as TValue;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function stringArrayEnum<const TValue extends string>(value: unknown, allowed: readonly TValue[], field: string, code = "WORKER_REPORT_SHAPE_INVALID"): TValue[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.includes(item as TValue))) {
    return value as TValue[];
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

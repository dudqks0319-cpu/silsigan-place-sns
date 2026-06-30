import { ApiError } from "./errors.ts";

export type WorkerModerationStatus = "open" | "accepted" | "rejected";
export type WorkerCoordinateStatus = "verified" | "TODO_COORDINATE_VERIFY" | "rejected";

export type WorkerModerationReportSummary = {
  id: string;
  targetType: "place" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  status: WorkerModerationStatus;
  createdAt: string;
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

  const targetType = stringEnum(value.targetType, ["place", "comment", "photo"] as const, "targetType");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

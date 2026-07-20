import { ApiError } from "./errors.ts";

export type WorkerModerationStatus = "open" | "accepted" | "rejected";
export type WorkerCoordinateStatus = "verified" | "TODO_COORDINATE_VERIFY" | "rejected";
export type WorkerFieldReportModerationStatus = "pending" | "approved" | "rejected" | "hidden";
export type WorkerPlaceAdditionRequestStatus = "needs_verification" | "ready_for_manual_import" | "duplicate" | "rejected";

export type WorkerPlaceAdditionRequestSummary = {
  id: string;
  clientRequestId: string;
  name: string;
  address: string;
  category: string;
  status: WorkerPlaceAdditionRequestStatus;
  reviewReason: string | null;
  matchedPlaceId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

export type WorkerFieldReportSummary = {
  id: string;
  placeId: string;
  placeName: string;
  category: "tourism" | "festival" | "restaurant_cafe" | "hospital" | "public_office" | "parking";
  crowdLevel: "quiet" | "normal" | "busy" | "packed" | null;
  lineStatus: "none" | "short" | "medium" | "long" | null;
  parkingStatus: "available" | "limited" | "full" | "unknown" | null;
  verifiedRadiusM: number | null;
  verificationMethod: "none" | "radius" | "polygon";
  accuracyBucket: "high" | "medium" | "low" | "unknown";
  moderationStatus: WorkerFieldReportModerationStatus;
  createdAt: string;
  expiresAt: string;
};

export type WorkerModerationReportSummary = {
  id: string;
  targetType: "place" | "post" | "comment" | "photo";
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

export type WorkerPhotoCostGuardSummary = {
  uploadsEnabled: boolean;
  readsEnabled: boolean;
  reason: string | null;
  activeBytes: number;
  storageMaxBytes: number;
  storageStopBytes: number;
  storagePercent: number;
  storageStopPercent: number;
  periodUtc: string;
  writesInPeriod: number;
  monthlyWriteLimit: number;
  monthlyWriteStopLimit: number;
  writePercent: number;
  writeStopPercent: number;
  transformPeriodUtc: string;
  transformsInPeriod: number;
  monthlyTransformLimit: number;
  monthlyTransformStopLimit: number;
  transformPercent: number;
  transformStopPercent: number;
  readPeriodUtc: string;
  readsInPeriod: number;
  monthlyReadLimit: number;
  monthlyReadStopLimit: number;
  readPercent: number;
  readStopPercent: number;
  dayUtc: string;
  readsInDay: number;
  dailyReadLimit: number;
  dailyReadStopLimit: number;
  dailyReadPercent: number;
  dailyReadStopPercent: number;
  updatedAt: string;
};

export type WorkerApiCostGuardSummary = {
  control: {
    mode: "running" | "degraded" | "stopped";
    reason: string;
    generation: number;
    automaticMetric: "workers_requests" | "d1_rows_read" | "d1_rows_written" | "manual" | null;
    updatedBy: string;
    updatedAt: string;
  };
  dayUtc: string;
  usage: {
    workersRequests: number;
    d1RowsRead: number;
    d1RowsWritten: number;
  };
  limits: {
    workersRequests: number;
    d1RowsRead: number;
    d1RowsWritten: number;
    warnPercent: number;
    degradePercent: number;
    stopPercent: number;
  };
  meters: {
    workersPercent: number;
    d1ReadPercent: number;
    d1WritePercent: number;
  };
  reconciliationFresh: boolean;
};

export type WorkerBetaKpiSummary = {
  windowDays: 7 | 30;
  generatedAt: string;
  privacy: "aggregate-only";
  audience: {
    activeUsers: number;
    appOpens: number;
  };
  reportFunnel: {
    started: number;
    submitted: number;
    conversionPercent: number | null;
    medianCompletionSeconds: number | null;
  };
  mapReliability: {
    succeeded: number;
    failed: number;
    successPercent: number | null;
  };
  moderation: {
    submitted: number;
    pending: number;
    approved: number;
    rejected: number;
    hidden: number;
    approvalPercent: number | null;
    reviewedWithin24HoursPercent: number | null;
  };
  retention: {
    d1: WorkerBetaRetentionSummary;
    d7: WorkerBetaRetentionSummary;
  };
  freshCoverage: {
    eligiblePlaces: number;
    coveredPlaces: number;
    percent: number | null;
    tierA: WorkerBetaFreshCoverageSummary;
    tierB: WorkerBetaFreshCoverageSummary;
  };
  runtimeReliability: {
    appOpenUsers: number;
    errorUsers: number;
    errorFreePercent: number | null;
  };
};

type WorkerBetaRetentionSummary = {
  cohortUsers: number;
  retainedUsers: number;
  percent: number | null;
};

type WorkerBetaFreshCoverageSummary = {
  eligiblePlaces: number;
  coveredPlaces: number;
  percent: number | null;
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
  input: { status?: WorkerFieldReportModerationStatus; limit?: number } = {},
  options: WorkerAdminRequestOptions = {},
) {
  const limit = clampAdminLimit(input.limit, 20);
  const params = new URLSearchParams({ limit: String(limit) });
  if (input.status) {
    params.set("status", input.status);
  }

  const url = workerAdminUrl(`/api/admin/field-reports?${params.toString()}`, options.env);
  const response = await requestWorkerAdmin<unknown[]>(url, { method: "GET" }, options);

  return response.map(toFieldReportSummary);
}

export async function moderateWorkerFieldReport(
  input: { reportId: string; status: Exclude<WorkerFieldReportModerationStatus, "pending">; reason?: string },
  options: WorkerAdminRequestOptions = {},
) {
  if (!/^field_report_[a-zA-Z0-9-]{8,100}$/.test(input.reportId)) {
    throw new ApiError(400, "WORKER_FIELD_REPORT_ID_INVALID", "현장 제보 ID가 올바르지 않습니다.");
  }

  const url = workerAdminUrl(`/api/admin/field-reports/${encodeURIComponent(input.reportId)}/action`, options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        status: input.status,
        reason: input.reason ?? "admin field report queue action",
      }),
    },
    options,
  );

  return toFieldReportSummary(response);
}

export async function listWorkerPlaceAdditionRequests(
  input: { status?: WorkerPlaceAdditionRequestStatus; limit?: number } = {},
  options: WorkerAdminRequestOptions = {},
) {
  const params = new URLSearchParams({ limit: String(clampAdminLimit(input.limit, 50)) });
  if (input.status) {
    params.set("status", input.status);
  }

  const url = workerAdminUrl(`/api/admin/place-requests?${params.toString()}`, options.env);
  const response = await requestWorkerAdmin<unknown[]>(url, { method: "GET" }, options);

  return response.map(toPlaceAdditionRequestSummary);
}

export async function reviewWorkerPlaceAdditionRequest(
  input: {
    requestId: string;
    status: WorkerPlaceAdditionRequestStatus;
    reason: string;
    matchedPlaceId?: string;
  },
  options: WorkerAdminRequestOptions = {},
) {
  if (!/^place_request_[a-zA-Z0-9-]{8,100}$/.test(input.requestId)) {
    throw new ApiError(400, "WORKER_PLACE_REQUEST_ID_INVALID", "장소 추가 요청 ID가 올바르지 않습니다.");
  }

  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, "WORKER_PLACE_REQUEST_REASON_INVALID", "운영 검토 사유를 5자 이상 300자 이하로 입력해 주세요.");
  }

  const matchedPlaceId = input.matchedPlaceId?.trim();
  if (input.status === "duplicate" && !matchedPlaceId) {
    throw new ApiError(400, "WORKER_MATCHED_PLACE_REQUIRED", "기존 장소 판정에는 일치 장소 ID가 필요합니다.");
  }
  if (input.status !== "duplicate" && matchedPlaceId) {
    throw new ApiError(400, "WORKER_MATCHED_PLACE_NOT_ALLOWED", "기존 장소 판정에서만 일치 장소 ID를 지정할 수 있습니다.");
  }

  const url = workerAdminUrl(`/api/admin/place-requests/${encodeURIComponent(input.requestId)}/action`, options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        status: input.status,
        reason,
        ...(input.status === "duplicate" ? { matchedPlaceId } : {}),
      }),
    },
    options,
  );

  return toPlaceAdditionRequestSummary(response);
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

export async function getWorkerPhotoCostGuard(options: WorkerAdminRequestOptions = {}) {
  const url = workerAdminUrl("/api/admin/photo-cost-guard", options.env);
  const response = await requestWorkerAdmin<unknown>(url, { method: "GET" }, options);

  return toPhotoCostGuardSummary(response);
}

export async function getWorkerApiCostGuard(options: WorkerAdminRequestOptions = {}) {
  const url = workerAdminUrl("/api/admin/api-cost-guard", options.env);
  const response = await requestWorkerAdmin<unknown>(url, { method: "GET" }, options);
  return toApiCostGuardSummary(response);
}

export async function updateWorkerApiCostGuard(
  input: { mode: "running" | "degraded" | "stopped"; reason: string; expectedGeneration: number },
  options: WorkerAdminRequestOptions = {},
) {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, "WORKER_API_COST_GUARD_REASON_INVALID", "중단 또는 재개 사유를 5자 이상 입력해 주세요.");
  }
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1) {
    throw new ApiError(400, "WORKER_API_COST_GUARD_GENERATION_INVALID", "비용 보호 상태 버전이 올바르지 않습니다.");
  }
  const url = workerAdminUrl("/api/admin/api-cost-guard", options.env);
  const response = await requestWorkerAdmin<unknown>(url, {
    method: "PATCH",
    body: JSON.stringify({ mode: input.mode, reason, expectedGeneration: input.expectedGeneration }),
  }, options);
  return toApiCostGuardSummary(response);
}

export async function reconcileWorkerApiCostGuard(
  input: {
    observedWorkersRequests: number;
    observedD1RowsRead: number;
    observedD1RowsWritten: number;
    note: string;
  },
  options: WorkerAdminRequestOptions = {},
) {
  for (const value of [input.observedWorkersRequests, input.observedD1RowsRead, input.observedD1RowsWritten]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, "WORKER_API_COST_GUARD_USAGE_INVALID", "Cloudflare 사용량은 0 이상의 정수여야 합니다.");
    }
  }
  const note = input.note.trim();
  if (note.length < 5 || note.length > 300) {
    throw new ApiError(400, "WORKER_API_COST_GUARD_NOTE_INVALID", "사용량 대조 메모를 5자 이상 입력해 주세요.");
  }
  const url = workerAdminUrl("/api/admin/api-cost-guard/reconciliations", options.env);
  const response = await requestWorkerAdmin<unknown>(url, {
    method: "POST",
    body: JSON.stringify({
      observedWorkersRequests: input.observedWorkersRequests,
      observedD1RowsRead: input.observedD1RowsRead,
      observedD1RowsWritten: input.observedD1RowsWritten,
      observedAt: new Date().toISOString(),
      source: "cloudflare-dashboard",
      note,
    }),
  }, options);
  return toApiCostGuardSummary(response);
}

export async function getWorkerBetaKpis(windowDays: 7 | 30 = 7, options: WorkerAdminRequestOptions = {}) {
  if (windowDays !== 7 && windowDays !== 30) {
    throw new ApiError(400, "WORKER_BETA_KPI_WINDOW_INVALID", "KPI 조회 기간은 7일 또는 30일이어야 합니다.");
  }

  const url = workerAdminUrl(`/api/admin/beta-kpis?days=${windowDays}`, options.env);
  const response = await requestWorkerAdmin<unknown>(url, { method: "GET" }, options);

  return toBetaKpiSummary(response);
}

export async function updateWorkerPhotoCostGuard(
  input: { uploadsEnabled: boolean; readsEnabled: boolean; reason: string; reconciliationAcknowledged?: boolean },
  options: WorkerAdminRequestOptions = {},
) {
  if (typeof input.uploadsEnabled !== "boolean") {
    throw new ApiError(400, "WORKER_PHOTO_COST_GUARD_STATE_INVALID", "업로드 제어 상태가 올바르지 않습니다.");
  }
  if (typeof input.readsEnabled !== "boolean") {
    throw new ApiError(400, "WORKER_PHOTO_READ_GUARD_STATE_INVALID", "조회 제어 상태가 올바르지 않습니다.");
  }
  const reconciliationAcknowledged = input.reconciliationAcknowledged === true;
  if ((input.uploadsEnabled || input.readsEnabled) && !reconciliationAcknowledged) {
    throw new ApiError(
      400,
      "WORKER_PHOTO_COST_GUARD_RECONCILIATION_REQUIRED",
      "재개 전 Cloudflare 사용량과 D1 원장 대조 확인이 필요합니다.",
    );
  }

  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, "WORKER_PHOTO_COST_GUARD_REASON_INVALID", "중단 또는 재개 사유를 5자 이상 입력해 주세요.");
  }

  const url = workerAdminUrl("/api/admin/photo-cost-guard", options.env);
  const response = await requestWorkerAdmin<unknown>(
    url,
    {
      method: "PATCH",
      body: JSON.stringify({
        uploadsEnabled: input.uploadsEnabled,
        readsEnabled: input.readsEnabled,
        reconciliationAcknowledged,
        reason,
      }),
    },
    options,
  );

  return toPhotoCostGuardSummary(response);
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
    verifiedRadiusM: nullableNumberField(value.verifiedRadiusM, "verifiedRadiusM", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    verificationMethod: stringEnum(value.verificationMethod, ["none", "radius", "polygon"] as const, "verificationMethod", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    accuracyBucket: stringEnum(value.accuracyBucket, ["high", "medium", "low", "unknown"] as const, "accuracyBucket", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    moderationStatus: stringEnum(value.moderationStatus, ["pending", "approved", "rejected", "hidden"] as const, "moderationStatus", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    createdAt: stringField(value.createdAt, "createdAt", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
    expiresAt: stringField(value.expiresAt, "expiresAt", "WORKER_FIELD_REPORT_SHAPE_INVALID"),
  };
}

function toPlaceAdditionRequestSummary(value: unknown): WorkerPlaceAdditionRequestSummary {
  const code = "WORKER_PLACE_REQUEST_SHAPE_INVALID";
  if (!isRecord(value)) {
    throw new ApiError(502, code, "Worker 장소 추가 요청 응답 형식이 올바르지 않습니다.");
  }

  return {
    id: stringField(value.id, "id", code),
    clientRequestId: stringField(value.clientRequestId, "clientRequestId", code),
    name: stringField(value.name, "name", code),
    address: stringField(value.address, "address", code),
    category: stringField(value.category, "category", code),
    status: stringEnum(
      value.status,
      ["needs_verification", "ready_for_manual_import", "duplicate", "rejected"] as const,
      "status",
      code,
    ),
    reviewReason: nullableStringField(value.reviewReason, "reviewReason", code),
    matchedPlaceId: nullableStringField(value.matchedPlaceId, "matchedPlaceId", code),
    createdAt: stringField(value.createdAt, "createdAt", code),
    updatedAt: stringField(value.updatedAt, "updatedAt", code),
    reviewedAt: nullableStringField(value.reviewedAt, "reviewedAt", code),
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

function toPhotoCostGuardSummary(value: unknown): WorkerPhotoCostGuardSummary {
  const code = "WORKER_PHOTO_COST_GUARD_SHAPE_INVALID";
  if (!isRecord(value)) {
    throw new ApiError(502, code, "Worker 사진 비용 보호 응답 형식이 올바르지 않습니다.");
  }

  return {
    uploadsEnabled: booleanField(value.uploadsEnabled, "uploadsEnabled", code),
    readsEnabled: booleanField(value.readsEnabled, "readsEnabled", code),
    reason: nullableStringField(value.reason, "reason", code),
    activeBytes: nonNegativeNumberField(value.activeBytes, "activeBytes", code),
    storageMaxBytes: nonNegativeNumberField(value.storageMaxBytes, "storageMaxBytes", code),
    storageStopBytes: nonNegativeNumberField(value.storageStopBytes, "storageStopBytes", code),
    storagePercent: percentageField(value.storagePercent, "storagePercent", code),
    storageStopPercent: percentageField(value.storageStopPercent, "storageStopPercent", code),
    periodUtc: stringField(value.periodUtc, "periodUtc", code),
    writesInPeriod: nonNegativeNumberField(value.writesInPeriod, "writesInPeriod", code),
    monthlyWriteLimit: nonNegativeNumberField(value.monthlyWriteLimit, "monthlyWriteLimit", code),
    monthlyWriteStopLimit: nonNegativeNumberField(value.monthlyWriteStopLimit, "monthlyWriteStopLimit", code),
    writePercent: percentageField(value.writePercent, "writePercent", code),
    writeStopPercent: percentageField(value.writeStopPercent, "writeStopPercent", code),
    transformPeriodUtc: stringField(value.transformPeriodUtc, "transformPeriodUtc", code),
    transformsInPeriod: nonNegativeNumberField(value.transformsInPeriod, "transformsInPeriod", code),
    monthlyTransformLimit: nonNegativeNumberField(value.monthlyTransformLimit, "monthlyTransformLimit", code),
    monthlyTransformStopLimit: nonNegativeNumberField(value.monthlyTransformStopLimit, "monthlyTransformStopLimit", code),
    transformPercent: percentageField(value.transformPercent, "transformPercent", code),
    transformStopPercent: percentageField(value.transformStopPercent, "transformStopPercent", code),
    readPeriodUtc: stringField(value.readPeriodUtc, "readPeriodUtc", code),
    readsInPeriod: nonNegativeNumberField(value.readsInPeriod, "readsInPeriod", code),
    monthlyReadLimit: nonNegativeNumberField(value.monthlyReadLimit, "monthlyReadLimit", code),
    monthlyReadStopLimit: nonNegativeNumberField(value.monthlyReadStopLimit, "monthlyReadStopLimit", code),
    readPercent: percentageField(value.readPercent, "readPercent", code),
    readStopPercent: percentageField(value.readStopPercent, "readStopPercent", code),
    dayUtc: stringField(value.dayUtc, "dayUtc", code),
    readsInDay: nonNegativeNumberField(value.readsInDay, "readsInDay", code),
    dailyReadLimit: nonNegativeNumberField(value.dailyReadLimit, "dailyReadLimit", code),
    dailyReadStopLimit: nonNegativeNumberField(value.dailyReadStopLimit, "dailyReadStopLimit", code),
    dailyReadPercent: percentageField(value.dailyReadPercent, "dailyReadPercent", code),
    dailyReadStopPercent: percentageField(value.dailyReadStopPercent, "dailyReadStopPercent", code),
    updatedAt: stringField(value.updatedAt, "updatedAt", code),
  };
}

function toApiCostGuardSummary(value: unknown): WorkerApiCostGuardSummary {
  const code = "WORKER_API_COST_GUARD_SHAPE_INVALID";
  if (!isRecord(value)) {
    throw new ApiError(502, code, "Worker 전역 비용 보호 응답 형식이 올바르지 않습니다.");
  }
  const control = recordField(value.control, "control", code);
  const usage = recordField(value.usage, "usage", code);
  const limits = recordField(value.limits, "limits", code);
  const meters = recordField(value.meters, "meters", code);
  return {
    control: {
      mode: stringEnum(control.mode, ["running", "degraded", "stopped"] as const, "control.mode", code),
      reason: stringField(control.reason, "control.reason", code),
      generation: nonNegativeIntegerField(control.generation, "control.generation", code),
      automaticMetric: nullableStringEnum(
        control.automaticMetric,
        ["workers_requests", "d1_rows_read", "d1_rows_written", "manual"] as const,
        "control.automaticMetric",
      ),
      updatedBy: stringField(control.updatedBy, "control.updatedBy", code),
      updatedAt: stringField(control.updatedAt, "control.updatedAt", code),
    },
    dayUtc: stringField(value.dayUtc, "dayUtc", code),
    usage: {
      workersRequests: nonNegativeIntegerField(usage.workersRequests, "usage.workersRequests", code),
      d1RowsRead: nonNegativeIntegerField(usage.d1RowsRead, "usage.d1RowsRead", code),
      d1RowsWritten: nonNegativeIntegerField(usage.d1RowsWritten, "usage.d1RowsWritten", code),
    },
    limits: {
      workersRequests: nonNegativeIntegerField(limits.workersRequests, "limits.workersRequests", code),
      d1RowsRead: nonNegativeIntegerField(limits.d1RowsRead, "limits.d1RowsRead", code),
      d1RowsWritten: nonNegativeIntegerField(limits.d1RowsWritten, "limits.d1RowsWritten", code),
      warnPercent: percentageField(limits.warnPercent, "limits.warnPercent", code),
      degradePercent: percentageField(limits.degradePercent, "limits.degradePercent", code),
      stopPercent: percentageField(limits.stopPercent, "limits.stopPercent", code),
    },
    meters: {
      workersPercent: percentageField(meters.workersPercent, "meters.workersPercent", code),
      d1ReadPercent: percentageField(meters.d1ReadPercent, "meters.d1ReadPercent", code),
      d1WritePercent: percentageField(meters.d1WritePercent, "meters.d1WritePercent", code),
    },
    reconciliationFresh: booleanField(value.reconciliationFresh, "reconciliationFresh", code),
  };
}

function toBetaKpiSummary(value: unknown): WorkerBetaKpiSummary {
  const code = "WORKER_BETA_KPI_SHAPE_INVALID";
  const root = recordField(value, "data", code);
  const audience = recordField(root.audience, "audience", code);
  const reportFunnel = recordField(root.reportFunnel, "reportFunnel", code);
  const mapReliability = recordField(root.mapReliability, "mapReliability", code);
  const moderation = recordField(root.moderation, "moderation", code);
  const retention = recordField(root.retention, "retention", code);
  const d1 = recordField(retention.d1, "retention.d1", code);
  const d7 = recordField(retention.d7, "retention.d7", code);
  const freshCoverage = recordField(root.freshCoverage, "freshCoverage", code);
  const tierA = recordField(freshCoverage.tierA, "freshCoverage.tierA", code);
  const tierB = recordField(freshCoverage.tierB, "freshCoverage.tierB", code);
  const runtimeReliability = recordField(root.runtimeReliability, "runtimeReliability", code);
  const windowDays = root.windowDays;

  if (windowDays !== 7 && windowDays !== 30) {
    throw new ApiError(502, code, "Worker KPI 조회 기간이 올바르지 않습니다.");
  }
  if (root.privacy !== "aggregate-only") {
    throw new ApiError(502, code, "Worker KPI 개인정보 보호 계약이 올바르지 않습니다.");
  }

  return {
    windowDays,
    generatedAt: stringField(root.generatedAt, "generatedAt", code),
    privacy: "aggregate-only",
    audience: {
      activeUsers: nonNegativeIntegerField(audience.activeUsers, "audience.activeUsers", code),
      appOpens: nonNegativeIntegerField(audience.appOpens, "audience.appOpens", code),
    },
    reportFunnel: {
      started: nonNegativeIntegerField(reportFunnel.started, "reportFunnel.started", code),
      submitted: nonNegativeIntegerField(reportFunnel.submitted, "reportFunnel.submitted", code),
      conversionPercent: nullablePercentageField(reportFunnel.conversionPercent, "reportFunnel.conversionPercent", code),
      medianCompletionSeconds: nullableNonNegativeNumberField(reportFunnel.medianCompletionSeconds, "reportFunnel.medianCompletionSeconds", code),
    },
    mapReliability: {
      succeeded: nonNegativeIntegerField(mapReliability.succeeded, "mapReliability.succeeded", code),
      failed: nonNegativeIntegerField(mapReliability.failed, "mapReliability.failed", code),
      successPercent: nullablePercentageField(mapReliability.successPercent, "mapReliability.successPercent", code),
    },
    moderation: {
      submitted: nonNegativeIntegerField(moderation.submitted, "moderation.submitted", code),
      pending: nonNegativeIntegerField(moderation.pending, "moderation.pending", code),
      approved: nonNegativeIntegerField(moderation.approved, "moderation.approved", code),
      rejected: nonNegativeIntegerField(moderation.rejected, "moderation.rejected", code),
      hidden: nonNegativeIntegerField(moderation.hidden, "moderation.hidden", code),
      approvalPercent: nullablePercentageField(moderation.approvalPercent, "moderation.approvalPercent", code),
      reviewedWithin24HoursPercent: nullablePercentageField(moderation.reviewedWithin24HoursPercent, "moderation.reviewedWithin24HoursPercent", code),
    },
    retention: {
      d1: toBetaRetentionSummary(d1, "retention.d1", code),
      d7: toBetaRetentionSummary(d7, "retention.d7", code),
    },
    freshCoverage: {
      eligiblePlaces: nonNegativeIntegerField(freshCoverage.eligiblePlaces, "freshCoverage.eligiblePlaces", code),
      coveredPlaces: nonNegativeIntegerField(freshCoverage.coveredPlaces, "freshCoverage.coveredPlaces", code),
      percent: nullablePercentageField(freshCoverage.percent, "freshCoverage.percent", code),
      tierA: toBetaFreshCoverageSummary(tierA, "freshCoverage.tierA", code),
      tierB: toBetaFreshCoverageSummary(tierB, "freshCoverage.tierB", code),
    },
    runtimeReliability: {
      appOpenUsers: nonNegativeIntegerField(runtimeReliability.appOpenUsers, "runtimeReliability.appOpenUsers", code),
      errorUsers: nonNegativeIntegerField(runtimeReliability.errorUsers, "runtimeReliability.errorUsers", code),
      errorFreePercent: nullablePercentageField(runtimeReliability.errorFreePercent, "runtimeReliability.errorFreePercent", code),
    },
  };
}

function toBetaRetentionSummary(value: Record<string, unknown>, field: string, code: string): WorkerBetaRetentionSummary {
  return {
    cohortUsers: nonNegativeIntegerField(value.cohortUsers, `${field}.cohortUsers`, code),
    retainedUsers: nonNegativeIntegerField(value.retainedUsers, `${field}.retainedUsers`, code),
    percent: nullablePercentageField(value.percent, `${field}.percent`, code),
  };
}

function toBetaFreshCoverageSummary(value: Record<string, unknown>, field: string, code: string): WorkerBetaFreshCoverageSummary {
  return {
    eligiblePlaces: nonNegativeIntegerField(value.eligiblePlaces, `${field}.eligiblePlaces`, code),
    coveredPlaces: nonNegativeIntegerField(value.coveredPlaces, `${field}.coveredPlaces`, code),
    percent: nullablePercentageField(value.percent, `${field}.percent`, code),
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

function nullableStringEnum<const TValue extends string>(value: unknown, allowed: readonly TValue[], field: string): TValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  return stringEnum(value, allowed, field, "WORKER_FIELD_REPORT_SHAPE_INVALID");
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

function nonNegativeNumberField(value: unknown, field: string, code: string) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function nonNegativeIntegerField(value: unknown, field: string, code: string) {
  const number = nonNegativeNumberField(value, field, code);
  if (Number.isInteger(number)) {
    return number;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function nullableNonNegativeNumberField(value: unknown, field: string, code: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return nonNegativeNumberField(value, field, code);
}

function nullablePercentageField(value: unknown, field: string, code: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return percentageField(value, field, code);
}

function recordField(value: unknown, field: string, code: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new ApiError(502, code, `Worker 응답 ${field} 필드가 올바르지 않습니다.`);
}

function percentageField(value: unknown, field: string, code: string) {
  const percentage = nonNegativeNumberField(value, field, code);
  if (percentage <= 100) {
    return percentage;
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

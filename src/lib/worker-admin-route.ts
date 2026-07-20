import { assertAdminMutationOrigin, assertAdminRequest } from "./admin-auth.ts";
import { ApiError } from "./errors.ts";
import { assertRateLimit, rateLimitKey } from "./rate-limit.ts";
import {
  getWorkerBetaKpis,
  getWorkerApiCostGuard,
  getWorkerPhotoCostGuard,
  listWorkerModerationReports,
  listWorkerFieldReports,
  listWorkerPlaceAdditionRequests,
  moderateWorkerFieldReport,
  moderateWorkerReport,
  reconcileWorkerApiCostGuard,
  reviewWorkerPlaceAdditionRequest,
  restrictWorkerAnonymousUser,
  unrestrictWorkerAnonymousUser,
  updateWorkerPhotoCostGuard,
  updateWorkerApiCostGuard,
  updateWorkerPlaceCoordinateStatus,
  type WorkerCoordinateStatus,
  type WorkerFieldReportModerationStatus,
  type WorkerModerationStatus,
  type WorkerPlaceAdditionRequestStatus,
} from "./worker-admin-api.ts";

const reportStatuses = new Set<WorkerModerationStatus>(["open", "accepted", "rejected"]);
const actionStatuses = new Set<Exclude<WorkerModerationStatus, "open">>(["accepted", "rejected"]);
const coordinateStatuses = new Set<WorkerCoordinateStatus>(["verified", "TODO_COORDINATE_VERIFY", "rejected"]);
const fieldReportStatuses = new Set<WorkerFieldReportModerationStatus>(["pending", "approved", "rejected", "hidden"]);
const fieldReportActionStatuses = new Set<Exclude<WorkerFieldReportModerationStatus, "pending">>(["approved", "rejected", "hidden"]);
const placeRequestStatuses = new Set<WorkerPlaceAdditionRequestStatus>([
  "needs_verification",
  "ready_for_manual_import",
  "duplicate",
  "rejected",
]);

export async function handleAdminWorkerReportsGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const status = statusParam(url.searchParams.get("status"));
  const limit = Number(url.searchParams.get("limit") ?? "20");

  return listWorkerModerationReports({ status, limit });
}

export async function handleAdminPhotoCostGuardGet(request: Request) {
  assertAdminRequest(request);
  return getWorkerPhotoCostGuard();
}

export async function handleAdminApiCostGuardGet(request: Request) {
  assertAdminRequest(request);
  return getWorkerApiCostGuard();
}

export async function handleAdminApiCostGuardPatch(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-api-cost-guard"), limit: 12, windowMs: 60_000 });
  const input = await adminJsonObject(request);
  const mode = input.mode;
  if (mode !== "running" && mode !== "degraded" && mode !== "stopped") {
    throw new ApiError(400, "API_COST_GUARD_MODE_INVALID", "비용 보호 상태가 올바르지 않습니다.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, "API_COST_GUARD_REASON_INVALID", "중단 또는 재개 사유를 5자 이상 입력해 주세요.");
  }
  if (!Number.isSafeInteger(input.expectedGeneration) || (input.expectedGeneration as number) < 1) {
    throw new ApiError(400, "API_COST_GUARD_GENERATION_INVALID", "비용 보호 상태 버전이 올바르지 않습니다.");
  }
  return updateWorkerApiCostGuard({
    mode,
    reason,
    expectedGeneration: input.expectedGeneration as number,
  });
}

export async function handleAdminApiCostGuardReconcile(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-api-cost-reconcile"), limit: 12, windowMs: 60_000 });
  const input = await adminJsonObject(request);
  const observedWorkersRequests = nonNegativeSafeInteger(input.observedWorkersRequests, "Workers 요청");
  const observedD1RowsRead = nonNegativeSafeInteger(input.observedD1RowsRead, "D1 rows read");
  const observedD1RowsWritten = nonNegativeSafeInteger(input.observedD1RowsWritten, "D1 rows written");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length < 5 || note.length > 300) {
    throw new ApiError(400, "API_COST_GUARD_NOTE_INVALID", "사용량 대조 메모를 5자 이상 입력해 주세요.");
  }
  return reconcileWorkerApiCostGuard({
    observedWorkersRequests,
    observedD1RowsRead,
    observedD1RowsWritten,
    note,
  });
}

export async function handleAdminBetaKpisGet(request: Request) {
  assertAdminRequest(request);
  const days = new URL(request.url).searchParams.get("days") ?? "7";
  if (days !== "7" && days !== "30") {
    throw new ApiError(400, "BETA_KPI_WINDOW_INVALID", "KPI 조회 기간은 7일 또는 30일이어야 합니다.");
  }

  return getWorkerBetaKpis(Number(days) as 7 | 30);
}

export async function handleAdminPhotoCostGuardPatch(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-photo-cost-guard"), limit: 12, windowMs: 60_000 });
  const input = await adminJsonObject(request);

  if (typeof input.uploadsEnabled !== "boolean") {
    throw new ApiError(400, "PHOTO_COST_GUARD_STATE_INVALID", "업로드 제어 상태가 올바르지 않습니다.");
  }
  if (typeof input.readsEnabled !== "boolean") {
    throw new ApiError(400, "PHOTO_READ_GUARD_STATE_INVALID", "조회 제어 상태가 올바르지 않습니다.");
  }
  if (input.reconciliationAcknowledged !== undefined && typeof input.reconciliationAcknowledged !== "boolean") {
    throw new ApiError(400, "PHOTO_COST_GUARD_RECONCILIATION_INVALID", "사용량 대조 확인 값이 올바르지 않습니다.");
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, "PHOTO_COST_GUARD_REASON_INVALID", "중단 또는 재개 사유를 5자 이상 입력해 주세요.");
  }

  const reconciliationAcknowledged = input.reconciliationAcknowledged === true;
  if ((input.uploadsEnabled || input.readsEnabled) && !reconciliationAcknowledged) {
    throw new ApiError(
      400,
      "PHOTO_COST_GUARD_RECONCILIATION_REQUIRED",
      "재개 전 Cloudflare 사용량과 D1 원장 대조 확인이 필요합니다.",
    );
  }

  return updateWorkerPhotoCostGuard({
    uploadsEnabled: input.uploadsEnabled,
    readsEnabled: input.readsEnabled,
    reconciliationAcknowledged,
    reason,
  });
}

export async function handleAdminWorkerReportsPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-moderate-worker-report"), limit: 30, windowMs: 60_000 });
  const input = (await request.json()) as { reportId?: string; status?: WorkerModerationStatus; reason?: string };

  if (!input.reportId) {
    throw new ApiError(400, "REPORT_ID_REQUIRED", "신고 ID가 필요합니다.");
  }

  if (!input.status || !actionStatuses.has(input.status as Exclude<WorkerModerationStatus, "open">)) {
    throw new ApiError(400, "REPORT_ACTION_INVALID", "신고 처리 상태가 올바르지 않습니다.");
  }

  return moderateWorkerReport({
    reportId: input.reportId,
    status: input.status as Exclude<WorkerModerationStatus, "open">,
    reason: adminReason(input.reason, "REPORT_MODERATION_REASON_REQUIRED"),
  });
}

export async function handleAdminFieldReportsGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const status = fieldReportStatusParam(url.searchParams.get("status"));
  const limit = Number(url.searchParams.get("limit") ?? "20");

  return listWorkerFieldReports({ status, limit });
}

export async function handleAdminFieldReportsPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-moderate-field-report"), limit: 30, windowMs: 60_000 });
  const input = (await request.json()) as {
    reportId?: string;
    status?: WorkerFieldReportModerationStatus;
    reason?: string;
  };

  if (!input.reportId) {
    throw new ApiError(400, "FIELD_REPORT_ID_REQUIRED", "현장 제보 ID가 필요합니다.");
  }

  if (!input.status || !fieldReportActionStatuses.has(input.status as Exclude<WorkerFieldReportModerationStatus, "pending">)) {
    throw new ApiError(400, "FIELD_REPORT_ACTION_INVALID", "현장 제보 처리 상태가 올바르지 않습니다.");
  }

  return moderateWorkerFieldReport({
    reportId: input.reportId,
    status: input.status as Exclude<WorkerFieldReportModerationStatus, "pending">,
    reason: adminReason(input.reason, "FIELD_REPORT_MODERATION_REASON_REQUIRED"),
  });
}

export async function handleAdminPlaceRequestsGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  if (rawStatus && !placeRequestStatuses.has(rawStatus as WorkerPlaceAdditionRequestStatus)) {
    throw new ApiError(400, "PLACE_REQUEST_STATUS_INVALID", "장소 추가 요청 상태가 올바르지 않습니다.");
  }

  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isFinite(limit)) {
    throw new ApiError(400, "PLACE_REQUEST_LIMIT_INVALID", "장소 추가 요청 조회 개수가 올바르지 않습니다.");
  }

  return listWorkerPlaceAdditionRequests({
    ...(rawStatus ? { status: rawStatus as WorkerPlaceAdditionRequestStatus } : {}),
    limit,
  });
}

export async function handleAdminPlaceRequestsPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-review-place-request"), limit: 30, windowMs: 60_000 });
  const input = await adminJsonObject(request);
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  const status = typeof input.status === "string" ? input.status : "";
  const matchedPlaceId = typeof input.matchedPlaceId === "string" ? input.matchedPlaceId.trim() : "";

  if (!/^place_request_[a-zA-Z0-9-]{8,100}$/.test(requestId)) {
    throw new ApiError(400, "PLACE_REQUEST_ID_INVALID", "장소 추가 요청 ID가 올바르지 않습니다.");
  }
  if (!placeRequestStatuses.has(status as WorkerPlaceAdditionRequestStatus)) {
    throw new ApiError(400, "PLACE_REQUEST_ACTION_INVALID", "장소 추가 요청 처리 상태가 올바르지 않습니다.");
  }
  if (input.matchedPlaceId !== undefined && typeof input.matchedPlaceId !== "string") {
    throw new ApiError(400, "MATCHED_PLACE_INVALID", "일치 장소 ID가 올바르지 않습니다.");
  }
  if (status === "duplicate" && !matchedPlaceId) {
    throw new ApiError(400, "MATCHED_PLACE_REQUIRED", "기존 장소 판정에는 일치 장소 ID가 필요합니다.");
  }
  if (status !== "duplicate" && matchedPlaceId) {
    throw new ApiError(400, "MATCHED_PLACE_NOT_ALLOWED", "기존 장소 판정에서만 일치 장소 ID를 지정할 수 있습니다.");
  }

  return reviewWorkerPlaceAdditionRequest({
    requestId,
    status: status as WorkerPlaceAdditionRequestStatus,
    reason: adminReason(input.reason, "PLACE_REQUEST_REVIEW_REASON_REQUIRED"),
    ...(status === "duplicate" ? { matchedPlaceId } : {}),
  });
}

export async function handleAdminWorkerCoordinateStatusPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-worker-coordinate-status"), limit: 20, windowMs: 60_000 });
  const input = (await request.json()) as {
    placeId?: string;
    coordinateStatus?: WorkerCoordinateStatus;
    latitude?: number;
    longitude?: number;
    source?: string;
    reason?: string;
  };

  if (!input.placeId) {
    throw new ApiError(400, "PLACE_ID_REQUIRED", "장소 ID가 필요합니다.");
  }

  if (!input.coordinateStatus || !coordinateStatuses.has(input.coordinateStatus)) {
    throw new ApiError(400, "COORDINATE_STATUS_INVALID", "좌표 상태가 올바르지 않습니다.");
  }

  if (!input.source || !input.reason) {
    throw new ApiError(400, "COORDINATE_REVIEW_CONTEXT_REQUIRED", "좌표 검증 출처와 사유가 필요합니다.");
  }

  if (input.coordinateStatus === "verified" && (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude))) {
    throw new ApiError(400, "COORDINATE_REQUIRED", "검증된 장소 좌표가 필요합니다.");
  }

  return updateWorkerPlaceCoordinateStatus({
    placeId: input.placeId,
    coordinateStatus: input.coordinateStatus,
    latitude: input.latitude,
    longitude: input.longitude,
    source: input.source,
    reason: input.reason,
  });
}

export async function handleAdminWorkerUserRestrictPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-worker-user-restrict"), limit: 20, windowMs: 60_000 });
  const input = (await request.json()) as { anonymousUserId?: string; reason?: string; blockedUntil?: string };

  if (!input.anonymousUserId) {
    throw new ApiError(400, "ANONYMOUS_USER_ID_REQUIRED", "익명 사용자 ID가 필요합니다.");
  }

  if (!input.reason) {
    throw new ApiError(400, "RESTRICTION_REASON_REQUIRED", "사용자 제한 사유가 필요합니다.");
  }

  return restrictWorkerAnonymousUser({
    anonymousUserId: input.anonymousUserId,
    reason: input.reason,
    blockedUntil: input.blockedUntil,
  });
}

export async function handleAdminWorkerUserUnrestrictPost(request: Request) {
  assertAdminRequest(request);
  assertAdminMutationOrigin(request);
  assertRateLimit({ key: rateLimitKey(request, "admin-worker-user-unrestrict"), limit: 20, windowMs: 60_000 });
  const input = (await request.json()) as { anonymousUserId?: string; reason?: string };

  if (!input.anonymousUserId) {
    throw new ApiError(400, "ANONYMOUS_USER_ID_REQUIRED", "익명 사용자 ID가 필요합니다.");
  }

  return unrestrictWorkerAnonymousUser({
    anonymousUserId: input.anonymousUserId,
    reason: input.reason,
  });
}

function statusParam(value: string | null): WorkerModerationStatus {
  if (value && reportStatuses.has(value as WorkerModerationStatus)) {
    return value as WorkerModerationStatus;
  }

  return "open";
}

function fieldReportStatusParam(value: string | null): WorkerFieldReportModerationStatus {
  if (value && fieldReportStatuses.has(value as WorkerFieldReportModerationStatus)) {
    return value as WorkerFieldReportModerationStatus;
  }

  return "pending";
}

function adminReason(value: unknown, code: string): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 5 || reason.length > 300) {
    throw new ApiError(400, code, "운영 조치 사유를 5자 이상 300자 이하로 입력해 주세요.");
  }
  return reason;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "API_COST_GUARD_USAGE_INVALID", `${label} 사용량은 0 이상의 정수여야 합니다.`);
  }
  return value;
}

async function adminJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ApiError(400, "ADMIN_JSON_INVALID", "요청 본문이 올바른 JSON이 아닙니다.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "ADMIN_JSON_OBJECT_REQUIRED", "요청 본문은 JSON 객체여야 합니다.");
  }

  return value as Record<string, unknown>;
}

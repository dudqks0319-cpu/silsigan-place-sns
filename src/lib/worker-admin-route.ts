import { assertAdminRequest } from "./admin-auth.ts";
import { ApiError } from "./errors.ts";
import { assertRateLimit, rateLimitKey } from "./rate-limit.ts";
import {
  listWorkerModerationReports,
  listWorkerFieldReports,
  listWorkerSourceHealth,
  moderateWorkerReport,
  moderateWorkerFieldReport,
  restrictWorkerAnonymousUser,
  unrestrictWorkerAnonymousUser,
  updateWorkerPlaceCoordinateStatus,
  type WorkerCoordinateStatus,
  type WorkerModerationStatus,
} from "./worker-admin-api.ts";

const reportStatuses = new Set<WorkerModerationStatus>(["open", "accepted", "rejected"]);
const actionStatuses = new Set<Exclude<WorkerModerationStatus, "open">>(["accepted", "rejected"]);
const coordinateStatuses = new Set<WorkerCoordinateStatus>(["verified", "TODO_COORDINATE_VERIFY", "rejected"]);
const fieldReportStatuses = new Set(["pending", "approved", "rejected", "all"] as const);

export async function handleAdminWorkerReportsGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const status = statusParam(url.searchParams.get("status"));
  const limit = Number(url.searchParams.get("limit") ?? "20");

  return listWorkerModerationReports({ status, limit });
}

export async function handleAdminWorkerReportsPost(request: Request) {
  assertAdminRequest(request);
  assertRateLimit({ key: await rateLimitKey(request, "admin-moderate-worker-report"), limit: 30, windowMs: 60_000 });
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
    reason: input.reason,
  });
}

export async function handleAdminWorkerFieldReportsGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const statusValue = url.searchParams.get("status") ?? "pending";
  const status = fieldReportStatuses.has(statusValue as "pending" | "approved" | "rejected" | "all")
    ? (statusValue as "pending" | "approved" | "rejected" | "all")
    : "pending";
  const limit = Number(url.searchParams.get("limit") ?? "50");

  return listWorkerFieldReports({ status, limit });
}

export async function handleAdminWorkerSourceHealthGet(request: Request) {
  assertAdminRequest(request);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");

  return listWorkerSourceHealth({ limit });
}

export async function handleAdminWorkerFieldReportsPost(request: Request) {
  assertAdminRequest(request);
  assertRateLimit({ key: await rateLimitKey(request, "admin-moderate-field-report"), limit: 30, windowMs: 60_000 });
  const input = (await request.json()) as { reportId?: string; decision?: "approved" | "rejected"; reason?: string };

  if (!input.reportId) {
    throw new ApiError(400, "FIELD_REPORT_ID_REQUIRED", "현장 제보 ID가 필요합니다.");
  }

  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ApiError(400, "FIELD_REPORT_DECISION_INVALID", "현장 제보 처리 상태가 올바르지 않습니다.");
  }

  return moderateWorkerFieldReport({
    reportId: input.reportId,
    decision: input.decision,
    reason: input.reason,
  });
}

export async function handleAdminWorkerCoordinateStatusPost(request: Request) {
  assertAdminRequest(request);
  assertRateLimit({ key: await rateLimitKey(request, "admin-worker-coordinate-status"), limit: 20, windowMs: 60_000 });
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
  assertRateLimit({ key: await rateLimitKey(request, "admin-worker-user-restrict"), limit: 20, windowMs: 60_000 });
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
  assertRateLimit({ key: await rateLimitKey(request, "admin-worker-user-unrestrict"), limit: 20, windowMs: 60_000 });
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

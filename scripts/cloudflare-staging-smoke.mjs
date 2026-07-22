#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

const DEFAULT_ANON_ID = "anon_staging_smoke";
const NATIONWIDE_BBOX = "124,33,132,39";
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

class SmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const { flags, options } = parseArgs(process.argv.slice(2));
const mutating = flags.has("mutating") || process.env.SILSIGAN_STAGING_MUTATION === "1";
const tailOnly = flags.has("tail-only");
const adminRequired = flags.has("require-admin") || process.env.SILSIGAN_STAGING_ADMIN_REQUIRED === "1";
const baseUrlInput = options.get("base-url") ?? process.env.SILSIGAN_STAGING_API_BASE_URL ?? process.env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL;
const tailFile = options.get("tail-file") ?? process.env.SILSIGAN_STAGING_TAIL_LOG_FILE;
const anonymousId = options.get("anon-id") ?? process.env.SILSIGAN_STAGING_ANON_ID ?? (mutating ? `anon_staging_smoke_${Date.now()}` : DEFAULT_ANON_ID);
const adminToken = options.get("admin-token") ?? process.env.SILSIGAN_STAGING_ADMIN_TOKEN;
const coordinateStatusSmokeEnabled = flags.has("coordinate-status") || process.env.SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE === "1";
const coordinateSmokePlaceId = options.get("coordinate-place-id") ?? process.env.SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID;
const coordinateSmokeLatitude = options.get("coordinate-latitude") ?? process.env.SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE;
const coordinateSmokeLongitude = options.get("coordinate-longitude") ?? process.env.SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE;
const coordinateSmokeSource = options.get("coordinate-source") ?? process.env.SILSIGAN_STAGING_COORDINATE_SMOKE_SOURCE ?? "staging smoke coordinate verification";
const coordinateSmokeReason = options.get("coordinate-reason") ?? process.env.SILSIGAN_STAGING_COORDINATE_SMOKE_REASON ?? "staging smoke verified coordinate";

const checks = [];
let anonymousSession = null;
let restrictionAnonymousSession = null;

try {
  if (tailFile) {
    await validateTailLogFile(tailFile);
  } else {
    record("tail.redaction", "skip", "SILSIGAN_STAGING_TAIL_LOG_FILE 또는 --tail-file 이 없어 로그 샘플 검증을 건너뜁니다.");
  }

  if (!tailOnly) {
    if (mutating && adminRequired && !adminToken) {
      throw new SmokeError("ADMIN_TOKEN_REQUIRED", "운영 보호장치 smoke에는 SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 필요합니다.");
    }

    if (!baseUrlInput) {
      throw new SmokeError("BASE_URL_REQUIRED", "SILSIGAN_STAGING_API_BASE_URL 또는 NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL 이 필요합니다.");
    }

    const baseUrl = normalizeBaseUrl(baseUrlInput);
    const selectedPlace = await runReadOnlySmoke(baseUrl);
    if (mutating) {
      try {
        anonymousSession = await issueAnonymousSession(baseUrl, "anonymousSession.primaryIssue");
        restrictionAnonymousSession = await issueAnonymousSession(baseUrl, "anonymousSession.restrictionIssue");
        await runAnonymousSessionLifecycleSmoke(baseUrl);
        await runPhotoMutationSmoke(baseUrl, selectedPlace.id);
        await runInteractionMutationSmoke(baseUrl, selectedPlace.id);
        await runModerationMutationSmoke(baseUrl, selectedPlace.id);
        await runUserRestrictionMutationSmoke(baseUrl, selectedPlace.id);
        await runCoordinateStatusMutationSmoke(baseUrl);
      } finally {
        await revokeMutationSessions(baseUrl);
      }
    } else {
      record("photos.images.mutation", "skip", "실제 사진/R2/Images smoke는 --mutating 또는 SILSIGAN_STAGING_MUTATION=1 일 때만 실행합니다.");
      record("interactions.mutation", "skip", "실제 댓글/좋아요 mutation smoke는 --mutating 또는 SILSIGAN_STAGING_MUTATION=1 일 때만 실행합니다.");
      record("moderation.mutation", "skip", "실제 신고/운영자 처리 smoke는 --mutating 또는 SILSIGAN_STAGING_MUTATION=1 일 때만 실행합니다.");
      record("users.restriction.mutation", "skip", "실제 사용자 제한 smoke는 --mutating 또는 SILSIGAN_STAGING_MUTATION=1 일 때만 실행합니다.");
      record("coordinateStatus.mutation", "skip", "실제 좌표 검증 smoke는 --mutating 과 --coordinate-status 또는 SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1 일 때만 실행합니다.");
    }
  }
} catch (error) {
  record("harness", "fail", publicErrorMessage(error));
}

const failed = checks.filter((check) => check.status === "fail");
const summary = {
  ok: failed.length === 0,
  baseUrl: tailOnly ? null : sanitizeBaseUrl(baseUrlInput),
  mutating,
  checks,
};

console.log(JSON.stringify(summary, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

async function runReadOnlySmoke(baseUrl) {
  const health = await requestJson(baseUrl, "/api/health");
  const healthData = expectSuccess("health", health, 200);
  assert(healthData.ok === true, "health", "health 응답의 data.ok가 true가 아닙니다.");
  record("health", "pass", "Worker health 응답이 정상입니다.", {
    service: safeString(healthData.service),
    storage: safeString(healthData.storage),
  });

  const placesResponse = await requestJson(baseUrl, "/api/places?limit=20");
  const places = expectSuccess("places.list", placesResponse, 200);
  assert(Array.isArray(places), "places.list", "places 응답이 배열이 아닙니다.");
  assert(places.length > 0, "places.list", "공개 장소가 없습니다.");
  assert(
    places.every((place) => isPublicCoordinatePlace(place)),
    "places.list",
    "좌표 미검증 또는 지도 표시 불가능 장소가 공개 목록에 포함되었습니다.",
  );

  const selectedPlace = places[0];
  assert(typeof selectedPlace.regionId === "string" && selectedPlace.regionId.length > 0, "places.list", "공개 장소에 regionId가 없습니다.");
  record("places.list", "pass", "공개 장소 목록과 지도 좌표를 확인했습니다.", {
    count: places.length,
    firstPlaceId: safeString(selectedPlace.id),
  });

  const placeResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(selectedPlace.id)}`);
  const placeDetail = expectSuccess("places.detail", placeResponse, 200);
  assert(placeDetail.id === selectedPlace.id, "places.detail", "장소 상세 id가 목록의 id와 일치하지 않습니다.");
  record("places.detail", "pass", "장소 상세 응답을 확인했습니다.", { placeId: safeString(selectedPlace.id) });

  const liveResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(selectedPlace.id)}/live`);
  expectSuccess("places.live", liveResponse, 200);
  record("places.live", "pass", "장소 실시간 요약 응답을 확인했습니다.", { placeId: safeString(selectedPlace.id) });

  const placeRealtimeResponse = await requestJson(baseUrl, `/api/realtime/place/${encodeURIComponent(selectedPlace.id)}`);
  const placeRealtime = expectSuccess("realtime.place", placeRealtimeResponse, 200);
  assertRealtimeRoom("realtime.place", placeRealtime, "place", selectedPlace.id);
  record("realtime.place", "pass", "장소 realtime room 응답을 확인했습니다.", { mode: safeString(placeRealtime.mode), roomId: safeString(placeRealtime.roomId) });

  const regionRealtimeResponse = await requestJson(baseUrl, `/api/realtime/region/${encodeURIComponent(selectedPlace.regionId)}`);
  const regionRealtime = expectSuccess("realtime.region", regionRealtimeResponse, 200);
  assertRealtimeRoom("realtime.region", regionRealtime, "region", selectedPlace.regionId);
  record("realtime.region", "pass", "지역 realtime room 응답을 확인했습니다.", { mode: safeString(regionRealtime.mode), roomId: safeString(regionRealtime.roomId) });

  const globalRealtimeResponse = await requestJson(baseUrl, "/api/realtime/global");
  const globalRealtime = expectSuccess("realtime.global", globalRealtimeResponse, 200);
  assertRealtimeRoom("realtime.global", globalRealtime, "global", "global");
  record("realtime.global", "pass", "전국 realtime room 응답을 확인했습니다.", { mode: safeString(globalRealtime.mode), roomId: safeString(globalRealtime.roomId) });

  const globalRankingsResponse = await requestJson(baseUrl, "/api/rankings/global?limit=10");
  const globalRankings = expectSuccess("rankings.global", globalRankingsResponse, 200);
  assert(Array.isArray(globalRankings), "rankings.global", "전국 랭킹 응답이 배열이 아닙니다.");
  record("rankings.global", "pass", "전국 랭킹 응답을 확인했습니다.", { count: globalRankings.length });

  const mapRankingsResponse = await requestJson(baseUrl, `/api/rankings?bbox=${encodeURIComponent(NATIONWIDE_BBOX)}&limit=10`);
  const mapRankings = expectSuccess("rankings.mapBounds", mapRankingsResponse, 200);
  assert(Array.isArray(mapRankings), "rankings.mapBounds", "지도 bounds 랭킹 응답이 배열이 아닙니다.");
  record("rankings.mapBounds", "pass", "전국 bbox 랭킹 응답을 확인했습니다.", { count: mapRankings.length });

  const commentsResponse = await requestJson(baseUrl, `/api/comments?placeId=${encodeURIComponent(selectedPlace.id)}`);
  const comments = expectSuccess("comments.list", commentsResponse, 200);
  assert(Array.isArray(comments), "comments.list", "댓글 목록 응답이 배열이 아닙니다.");
  record("comments.list", "pass", "댓글 목록 응답을 확인했습니다.", { count: comments.length });

  const photosResponse = await requestJson(baseUrl, `/api/photos?placeId=${encodeURIComponent(selectedPlace.id)}`);
  const photos = expectSuccess("photos.list", photosResponse, 200);
  assert(Array.isArray(photos), "photos.list", "사진 목록 응답이 배열이 아닙니다.");
  record("photos.list", "pass", "사진 목록 응답을 확인했습니다.", { count: photos.length });

  const deniedAdminResponse = await requestJson(baseUrl, "/api/admin/moderation/hide", {
    method: "POST",
    body: JSON.stringify({
      targetType: "place",
      targetId: selectedPlace.id,
      reason: "staging_smoke_auth_denied",
    }),
  });
  assert(
    [403, 503].includes(deniedAdminResponse.status),
    "admin.denyByDefault",
    `무권한 admin 요청이 ${deniedAdminResponse.status} 상태로 반환되었습니다.`,
  );
  record("admin.denyByDefault", "pass", "무권한 admin mutation이 deny-by-default로 차단되었습니다.", {
    status: deniedAdminResponse.status,
  });

  return selectedPlace;
}

async function issueAnonymousSession(baseUrl, checkName) {
  const response = await requestJsonAs(baseUrl, "/api/session/anonymous", null, { method: "POST" });
  const credential = expectAnonymousSessionCredential(checkName, response, 201);
  record(checkName, "pass", "서버 결합 익명 세션을 발급했습니다.");
  return credential;
}

async function runAnonymousSessionLifecycleSmoke(baseUrl) {
  const issued = await issueAnonymousSession(baseUrl, "anonymousSession.lifecycleIssue");
  const forged = await requestJsonAs(baseUrl, "/api/preferences", { ...issued, proof: "W".repeat(43) });
  expectAnonymousSessionFailure("anonymousSession.forgedProof", forged, "ANONYMOUS_SESSION_PROOF_INVALID");
  record("anonymousSession.forgedProof", "pass", "탈취한 세션 ID와 위조 증명값 조합을 차단했습니다.");

  const rotateResponse = await requestJsonAs(baseUrl, "/api/session/anonymous/rotate", issued, { method: "POST" });
  const rotated = expectAnonymousSessionCredential("anonymousSession.rotate", rotateResponse, 200);
  assert(rotated.anonymousId === issued.anonymousId, "anonymousSession.rotate", "회전 후 익명 세션 ID가 변경됐습니다.");
  assert(rotated.proof !== issued.proof, "anonymousSession.rotate", "회전 후 익명 세션 증명값이 변경되지 않았습니다.");

  const oldProof = await requestJsonAs(baseUrl, "/api/preferences", issued);
  expectAnonymousSessionFailure("anonymousSession.oldProofRejected", oldProof, "ANONYMOUS_SESSION_PROOF_INVALID");

  const activeProof = await requestJsonAs(baseUrl, "/api/preferences", rotated);
  expectSuccess("anonymousSession.rotatedProofAccepted", activeProof, 200);

  const revokeResponse = await requestJsonAs(baseUrl, "/api/session/anonymous", rotated, { method: "DELETE" });
  const revoked = expectSuccess("anonymousSession.revoke", revokeResponse, 200);
  assert(revoked.revoked === true, "anonymousSession.revoke", "익명 세션 폐기 응답 revoked가 true가 아닙니다.");

  const revokedProof = await requestJsonAs(baseUrl, "/api/preferences", rotated);
  expectAnonymousSessionFailure("anonymousSession.revokedProofRejected", revokedProof, "ANONYMOUS_SESSION_REVOKED");
  record("anonymousSession.lifecycle", "pass", "증명 회전, 이전 증명 거부, 폐기 후 재사용 거부를 확인했습니다.");
}

async function revokeMutationSessions(baseUrl) {
  const sessions = [anonymousSession, restrictionAnonymousSession].filter(Boolean);
  const failures = [];

  for (const session of sessions) {
    try {
      const response = await requestJsonAs(baseUrl, "/api/session/anonymous", session, { method: "DELETE" });
      if (response.status !== 200 || response.payload?.success !== true || response.payload?.data?.revoked !== true) {
        failures.push(response.status);
      }
    } catch {
      failures.push("network");
    }
  }

  anonymousSession = null;
  restrictionAnonymousSession = null;
  assert(failures.length === 0, "anonymousSession.cleanup", "mutation smoke 익명 세션 폐기에 실패했습니다.");
  if (sessions.length > 0) {
    record("anonymousSession.cleanup", "pass", "mutation smoke 익명 세션을 폐기했습니다.", { count: sessions.length });
  }
}

async function runPhotoMutationSmoke(baseUrl, placeId) {
  const bytes = Buffer.from(TINY_JPEG_BASE64, "base64");
  const uploadId = `staging-smoke-${Date.now()}`;
  const completeResponse = await requestJson(baseUrl, "/api/photos/complete", {
    method: "POST",
    body: JSON.stringify({
      uploadId,
      placeId,
      mimeType: "image/jpeg",
      byteSize: bytes.byteLength,
      width: 1,
      height: 1,
      clientReencoded: true,
      imageBase64: TINY_JPEG_BASE64,
    }),
  });
  const completed = expectSuccess("photos.complete", completeResponse, 201);
  assert(completed.photo?.id, "photos.complete", "사진 완료 응답에 photo.id가 없습니다.");
  assert(
    completeResponse.payload?.meta?.photoSanitization?.pixelsReencoded === true,
    "photos.images.binding",
    "Cloudflare Images binding 픽셀 재인코딩 증적이 없습니다.",
  );
  record("photos.complete", "pass", "staging R2/Images 사진 완료 smoke가 통과했습니다.", {
    photoId: safeString(completed.photo.id),
  });

  const photoId = completed.photo.id;
  const photosAfterCreateResponse = await requestJson(baseUrl, `/api/photos?placeId=${encodeURIComponent(placeId)}&limit=20`);
  const photosAfterCreate = expectSuccess("photos.previewList", photosAfterCreateResponse, 200);
  assert(Array.isArray(photosAfterCreate), "photos.previewList", "사진 완료 후 목록 응답이 배열이 아닙니다.");
  const listedPhoto = photosAfterCreate.find((photo) => photo?.id === photoId);
  assert(isRecord(listedPhoto), "photos.previewList", "생성한 smoke 사진이 공개 사진 목록에 없습니다.");
  assert(typeof listedPhoto.previewUrl === "string" && listedPhoto.previewUrl.length > 0, "photos.previewList", "생성한 smoke 사진에 previewUrl이 없습니다.");
  assertPublicPhotoShape("photos.previewList", listedPhoto);
  record("photos.previewList", "pass", "생성한 smoke 사진이 최소 공개 필드와 previewUrl로 노출됩니다.", { photoId: safeString(photoId) });

  const previewResponse = await requestBytes(baseUrl, listedPhoto.previewUrl);
  assert(previewResponse.status === 200, "photos.previewFile", `previewUrl 파일 상태가 200이 아니라 ${previewResponse.status}입니다.`);
  const previewContentType = previewResponse.headers.get("content-type") ?? "";
  assert(previewContentType.startsWith("image/"), "photos.previewFile", `previewUrl content-type이 이미지가 아닙니다: ${previewContentType}`);
  assert(previewResponse.bytes.byteLength > 0, "photos.previewFile", "previewUrl 파일 바이트가 비어 있습니다.");
  record("photos.previewFile", "pass", "previewUrl 파일이 staging Worker/R2 경로에서 이미지 바이트로 반환됩니다.", {
    photoId: safeString(photoId),
    byteLength: previewResponse.bytes.byteLength,
    contentType: safeString(previewContentType),
  });

  const deleteResponse = await requestJson(baseUrl, `/api/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
  expectSuccess("photos.deleteOwn", deleteResponse, 200);
  record("photos.deleteOwn", "pass", "smoke 사진을 같은 익명 세션으로 삭제했습니다.", { photoId: safeString(photoId) });

  const photosAfterDeleteResponse = await requestJson(baseUrl, `/api/photos?placeId=${encodeURIComponent(placeId)}`);
  const photosAfterDelete = expectSuccess("photos.deleteNotPublic", photosAfterDeleteResponse, 200);
  assert(Array.isArray(photosAfterDelete), "photos.deleteNotPublic", "삭제 후 사진 목록 응답이 배열이 아닙니다.");
  assert(
    !photosAfterDelete.some((photo) => photo?.id === photoId),
    "photos.deleteNotPublic",
    "삭제한 smoke 사진이 공개 사진 목록에 남아 있습니다.",
  );
  record("photos.deleteNotPublic", "pass", "삭제한 smoke 사진이 공개 사진 목록에서 제외됐습니다.", { photoId: safeString(photoId) });
}

async function runInteractionMutationSmoke(baseUrl, placeId) {
  const unlikeBeforeLikeResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(placeId)}/like`, { method: "DELETE" });
  expectSuccess("places.unlikePreclean", unlikeBeforeLikeResponse, 200);

  const likeResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(placeId)}/like`, { method: "POST" });
  const liked = expectSuccess("places.like", likeResponse, 200);
  assert(liked.placeId === placeId, "places.like", "좋아요 응답 placeId가 요청 placeId와 일치하지 않습니다.");
  assert(liked.created === true, "places.like", "좋아요 생성 응답 created가 true가 아닙니다.");
  assert(typeof liked.likeCount === "number" && liked.likeCount >= 1, "places.like", "좋아요 count가 올바르지 않습니다.");
  record("places.like", "pass", "같은 익명 세션의 장소 좋아요 생성을 확인했습니다.", {
    placeId: safeString(placeId),
    likeCount: liked.likeCount,
  });

  const unlikeResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(placeId)}/like`, { method: "DELETE" });
  const unliked = expectSuccess("places.unlike", unlikeResponse, 200);
  assert(unliked.placeId === placeId, "places.unlike", "좋아요 취소 응답 placeId가 요청 placeId와 일치하지 않습니다.");
  assert(unliked.deleted === true, "places.unlike", "좋아요 취소 응답 deleted가 true가 아닙니다.");
  assert(typeof unliked.likeCount === "number" && unliked.likeCount >= 0, "places.unlike", "좋아요 취소 count가 올바르지 않습니다.");
  record("places.unlike", "pass", "같은 익명 세션의 장소 좋아요 취소를 확인했습니다.", {
    placeId: safeString(placeId),
    likeCount: unliked.likeCount,
  });

  const commentBody = `staging smoke comment ${new Date().toISOString()}`;
  const commentCreateResponse = await requestJson(baseUrl, "/api/comments", {
    method: "POST",
    body: JSON.stringify({
      placeId,
      body: commentBody,
    }),
  });
  const createdComment = expectSuccess("comments.create", commentCreateResponse, 201);
  assert(createdComment.id, "comments.create", "댓글 생성 응답에 id가 없습니다.");
  assert(createdComment.placeId === placeId, "comments.create", "댓글 생성 응답 placeId가 요청 placeId와 일치하지 않습니다.");

  const commentId = createdComment.id;
  const commentsAfterCreateResponse = await requestJson(baseUrl, `/api/comments?placeId=${encodeURIComponent(placeId)}&limit=20`);
  const commentsAfterCreate = expectSuccess("comments.create", commentsAfterCreateResponse, 200);
  assert(Array.isArray(commentsAfterCreate), "comments.create", "댓글 생성 후 목록 응답이 배열이 아닙니다.");
  assert(
    commentsAfterCreate.some((comment) => comment?.id === commentId),
    "comments.create",
    "생성한 smoke 댓글이 공개 댓글 목록에 없습니다.",
  );
  record("comments.create", "pass", "smoke 댓글 생성과 공개 목록 노출을 확인했습니다.", { commentId: safeString(commentId) });

  const commentDeleteResponse = await requestJson(baseUrl, `/api/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
  const deletedComment = expectSuccess("comments.deleteOwn", commentDeleteResponse, 200);
  assert(deletedComment.deleted === true, "comments.deleteOwn", "댓글 삭제 응답 deleted가 true가 아닙니다.");
  record("comments.deleteOwn", "pass", "smoke 댓글을 같은 익명 세션으로 삭제했습니다.", { commentId: safeString(commentId) });

  const commentsAfterDeleteResponse = await requestJson(baseUrl, `/api/comments?placeId=${encodeURIComponent(placeId)}&limit=20`);
  const commentsAfterDelete = expectSuccess("comments.deleteNotPublic", commentsAfterDeleteResponse, 200);
  assert(Array.isArray(commentsAfterDelete), "comments.deleteNotPublic", "삭제 후 댓글 목록 응답이 배열이 아닙니다.");
  assert(
    !commentsAfterDelete.some((comment) => comment?.id === commentId),
    "comments.deleteNotPublic",
    "삭제한 smoke 댓글이 공개 댓글 목록에 남아 있습니다.",
  );
  record("comments.deleteNotPublic", "pass", "삭제한 smoke 댓글이 공개 댓글 목록에서 제외됐습니다.", { commentId: safeString(commentId) });
}

async function runModerationMutationSmoke(baseUrl, placeId) {
  if (!adminToken) {
    if (adminRequired) {
      throw new SmokeError("ADMIN_TOKEN_REQUIRED", "운영자 신고 처리 smoke에는 SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 필요합니다.");
    }
    record("moderation.adminAction", "skip", "SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 없어 신고 생성/운영자 처리 smoke를 건너뜁니다.");
    return;
  }

  const queueAuthResponse = await requestJson(baseUrl, "/api/moderation/reports?status=open&limit=20", {
    headers: adminHeaders(),
  });
  const queueBefore = expectSuccess("moderation.queueAuth", queueAuthResponse, 200);
  assert(Array.isArray(queueBefore), "moderation.queueAuth", "운영자 신고 큐 응답이 배열이 아닙니다.");
  record("moderation.queueAuth", "pass", "운영자 토큰으로 신고 큐 조회가 가능합니다.", { openCount: queueBefore.length });

  const reportResponse = await requestJson(baseUrl, "/api/moderation/reports", {
    method: "POST",
    body: JSON.stringify({
      targetType: "place",
      targetId: placeId,
      reason: "other",
    }),
  });
  const report = expectSuccess("moderation.reportCreate", reportResponse, 201);
  assert(report.id, "moderation.reportCreate", "신고 생성 응답에 id가 없습니다.");
  assert(report.targetType === "place", "moderation.reportCreate", "신고 생성 응답 targetType이 place가 아닙니다.");
  assert(report.targetId === placeId, "moderation.reportCreate", "신고 생성 응답 targetId가 요청 placeId와 일치하지 않습니다.");
  assert(report.status === "open", "moderation.reportCreate", "신고 생성 응답 status가 open이 아닙니다.");
  record("moderation.reportCreate", "pass", "smoke 장소 신고 생성을 확인했습니다.", { reportId: safeString(report.id) });

  const reportId = report.id;
  const queueAfterCreateResponse = await requestJson(baseUrl, "/api/moderation/reports?status=open&limit=50", {
    headers: adminHeaders(),
  });
  const queueAfterCreate = expectSuccess("moderation.queueVisible", queueAfterCreateResponse, 200);
  assert(Array.isArray(queueAfterCreate), "moderation.queueVisible", "신고 생성 후 운영자 큐 응답이 배열이 아닙니다.");
  assert(
    queueAfterCreate.some((item) => item?.id === reportId),
    "moderation.queueVisible",
    "생성한 smoke 신고가 운영자 open 큐에 없습니다.",
  );
  record("moderation.queueVisible", "pass", "생성한 smoke 신고가 운영자 open 큐에 노출됩니다.", { reportId: safeString(reportId) });

  const rejectResponse = await requestJson(baseUrl, `/api/moderation/reports/${encodeURIComponent(reportId)}/action`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      status: "rejected",
      reason: "staging smoke cleanup",
    }),
  });
  const rejected = expectSuccess("moderation.reportReject", rejectResponse, 200);
  assert(rejected.id === reportId, "moderation.reportReject", "운영자 처리 응답 id가 신고 id와 일치하지 않습니다.");
  assert(rejected.status === "rejected", "moderation.reportReject", "운영자 처리 응답 status가 rejected가 아닙니다.");
  record("moderation.reportReject", "pass", "smoke 신고를 운영자 action으로 rejected 처리했습니다.", { reportId: safeString(reportId) });

  const queueAfterRejectResponse = await requestJson(baseUrl, "/api/moderation/reports?status=open&limit=50", {
    headers: adminHeaders(),
  });
  const queueAfterReject = expectSuccess("moderation.queueClean", queueAfterRejectResponse, 200);
  assert(Array.isArray(queueAfterReject), "moderation.queueClean", "신고 처리 후 운영자 큐 응답이 배열이 아닙니다.");
  assert(
    !queueAfterReject.some((item) => item?.id === reportId),
    "moderation.queueClean",
    "rejected 처리한 smoke 신고가 open 큐에 남아 있습니다.",
  );
  record("moderation.queueClean", "pass", "rejected 처리한 smoke 신고가 open 큐에서 제외됐습니다.", { reportId: safeString(reportId) });
}

async function runUserRestrictionMutationSmoke(baseUrl, placeId) {
  if (!adminToken) {
    if (adminRequired) {
      throw new SmokeError("ADMIN_TOKEN_REQUIRED", "사용자 제한 smoke에는 SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 필요합니다.");
    }
    record("users.restriction.adminAction", "skip", "SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 없어 사용자 제한/해제 smoke를 건너뜁니다.");
    return;
  }

  const cleanupCommentIds = [];
  let anonymousUserId = null;
  let restricted = false;
  let unrestricted = false;

  try {
    const seedCommentResponse = await requestJsonAs(baseUrl, "/api/comments", restrictionAnonymousSession, {
      method: "POST",
      body: JSON.stringify({
        placeId,
        body: `staging smoke restriction seed ${new Date().toISOString()}`,
      }),
    });
    const seedComment = expectSuccess("users.restrictionSeedComment", seedCommentResponse, 201);
    assert(seedComment.id, "users.restrictionSeedComment", "사용자 제한 seed 댓글 응답에 id가 없습니다.");
    assert(isAnonymousUserId(seedComment.anonymousUserId), "users.restrictionSeedComment", "사용자 제한 seed 댓글에 D1 anonymousUserId가 없습니다.");
    cleanupCommentIds.push(seedComment.id);
    anonymousUserId = seedComment.anonymousUserId;

    const blockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const restrictResponse = await requestJson(baseUrl, "/api/admin/users/restrict", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        anonymousUserId,
        reason: "staging smoke temporary restriction",
        blockedUntil,
      }),
    });
    const restrictPayload = expectSuccess("users.restrict", restrictResponse, 200);
    assert(restrictPayload.restricted === true, "users.restrict", "사용자 제한 응답 restricted가 true가 아닙니다.");
    assert(restrictPayload.blockedUntil === blockedUntil, "users.restrict", "사용자 제한 blockedUntil이 요청값과 일치하지 않습니다.");
    restricted = true;
    record("users.restrict", "pass", "전용 smoke 익명 사용자를 임시 제한했습니다.", {
      blockedUntil,
    });

    const blockedCommentResponse = await requestJsonAs(baseUrl, "/api/comments", restrictionAnonymousSession, {
      method: "POST",
      body: JSON.stringify({
        placeId,
        body: "staging smoke blocked comment",
      }),
    });
    if (blockedCommentResponse.status === 201 && blockedCommentResponse.payload?.data?.id) {
      cleanupCommentIds.push(blockedCommentResponse.payload.data.id);
    }

    assert(blockedCommentResponse.status === 403, "users.restrictBlocksWrites", `제한 사용자 댓글 작성이 ${blockedCommentResponse.status} 상태로 반환되었습니다.`);
    assert(isRecord(blockedCommentResponse.payload), "users.restrictBlocksWrites", "제한 사용자 오류 응답 body가 객체가 아닙니다.");
    assert(blockedCommentResponse.payload.success === false, "users.restrictBlocksWrites", "제한 사용자 오류 응답 success가 false가 아닙니다.");
    assert(blockedCommentResponse.payload.error?.code === "USER_RESTRICTED", "users.restrictBlocksWrites", "제한 사용자 오류 code가 USER_RESTRICTED가 아닙니다.");
    const blockedSerialized = JSON.stringify(blockedCommentResponse.payload);
    assert(!blockedSerialized.includes(anonymousUserId), "users.restrictBlocksWrites", "제한 사용자 public 오류에 anonymousUserId가 포함됐습니다.");
    assert(!blockedSerialized.includes("staging smoke temporary restriction"), "users.restrictBlocksWrites", "제한 사용자 public 오류에 제한 사유가 포함됐습니다.");
    record("users.restrictBlocksWrites", "pass", "제한된 익명 사용자의 새 댓글 작성이 public 민감값 없이 차단됩니다.");

    const unrestrictResponse = await requestJson(baseUrl, "/api/admin/users/unrestrict", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        anonymousUserId,
        reason: "staging smoke cleanup",
      }),
    });
    const unrestrictPayload = expectSuccess("users.unrestrict", unrestrictResponse, 200);
    assert(unrestrictPayload.restricted === false, "users.unrestrict", "사용자 제한 해제 응답 restricted가 false가 아닙니다.");
    unrestricted = true;
    record("users.unrestrict", "pass", "전용 smoke 익명 사용자의 제한을 해제했습니다.");

    const restoredCommentResponse = await requestJsonAs(baseUrl, "/api/comments", restrictionAnonymousSession, {
      method: "POST",
      body: JSON.stringify({
        placeId,
        body: `staging smoke restriction restored ${new Date().toISOString()}`,
      }),
    });
    const restoredComment = expectSuccess("users.unrestrictRestoresWrites", restoredCommentResponse, 201);
    assert(restoredComment.id, "users.unrestrictRestoresWrites", "제한 해제 후 댓글 응답에 id가 없습니다.");
    cleanupCommentIds.push(restoredComment.id);
    record("users.unrestrictRestoresWrites", "pass", "제한 해제 후 같은 익명 세션의 댓글 작성이 다시 허용됩니다.");
  } finally {
    if (anonymousUserId && restricted && !unrestricted) {
      await requestJson(baseUrl, "/api/admin/users/unrestrict", {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          anonymousUserId,
          reason: "staging smoke cleanup after failure",
        }),
      });
    }

    let deleted = 0;
    for (const commentId of cleanupCommentIds) {
      const deleteResponse = await requestJsonAs(baseUrl, `/api/comments/${encodeURIComponent(commentId)}`, restrictionAnonymousSession, { method: "DELETE" });
      expectSuccess("users.restrictionCleanup", deleteResponse, 200);
      deleted += 1;
    }

    if (deleted > 0) {
      record("users.restrictionCleanup", "pass", "사용자 제한 smoke 댓글을 같은 익명 세션으로 정리했습니다.", { deleted });
    }
  }
}

async function runCoordinateStatusMutationSmoke(baseUrl) {
  if (!coordinateStatusSmokeEnabled) {
    record("coordinateStatus.mutation", "skip", "좌표 상태 smoke는 --coordinate-status 또는 SILSIGAN_STAGING_COORDINATE_STATUS_SMOKE=1 로 명시 opt-in 해야 실행합니다.");
    return;
  }

  if (!adminToken) {
    throw new SmokeError("coordinateStatus.adminToken", "좌표 상태 smoke에는 SILSIGAN_STAGING_ADMIN_TOKEN 또는 --admin-token 이 필요합니다.");
  }

  if (!coordinateSmokePlaceId) {
    throw new SmokeError("coordinateStatus.placeId", "좌표 상태 smoke에는 SILSIGAN_STAGING_COORDINATE_SMOKE_PLACE_ID 또는 --coordinate-place-id 가 필요합니다.");
  }

  const latitude = parseCoordinateOption(coordinateSmokeLatitude, "coordinateStatus.latitude", "SILSIGAN_STAGING_COORDINATE_SMOKE_LATITUDE 또는 --coordinate-latitude");
  const longitude = parseCoordinateOption(coordinateSmokeLongitude, "coordinateStatus.longitude", "SILSIGAN_STAGING_COORDINATE_SMOKE_LONGITUDE 또는 --coordinate-longitude");

  const coordinateResponse = await requestJson(baseUrl, "/api/admin/places/coordinate-status", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      placeId: coordinateSmokePlaceId,
      coordinateStatus: "verified",
      latitude,
      longitude,
      source: coordinateSmokeSource,
      reason: coordinateSmokeReason,
    }),
  });
  const coordinatePayload = expectSuccess("coordinateStatus.verify", coordinateResponse, 200);
  assert(coordinatePayload.placeId === coordinateSmokePlaceId, "coordinateStatus.verify", "좌표 상태 응답 placeId가 요청값과 일치하지 않습니다.");
  assert(coordinatePayload.coordinateStatus === "verified", "coordinateStatus.verify", "좌표 상태 응답이 verified가 아닙니다.");
  assert(coordinatePayload.latitude === latitude, "coordinateStatus.verify", "좌표 상태 응답 latitude가 요청값과 일치하지 않습니다.");
  assert(coordinatePayload.longitude === longitude, "coordinateStatus.verify", "좌표 상태 응답 longitude가 요청값과 일치하지 않습니다.");
  record("coordinateStatus.verify", "pass", "명시 opt-in 장소의 좌표 verified 운영 경로를 확인했습니다.", {
    placeId: safeString(coordinateSmokePlaceId),
  });

  const detailResponse = await requestJson(baseUrl, `/api/places/${encodeURIComponent(coordinateSmokePlaceId)}`);
  const detailPayload = expectSuccess("coordinateStatus.publicDetail", detailResponse, 200);
  assert(detailPayload.id === coordinateSmokePlaceId, "coordinateStatus.publicDetail", "좌표 검증 후 공개 상세 id가 요청값과 일치하지 않습니다.");
  assert(detailPayload.coordinateStatus === "verified", "coordinateStatus.publicDetail", "좌표 검증 후 공개 상세 coordinateStatus가 verified가 아닙니다.");
  assert(detailPayload.latitude === latitude, "coordinateStatus.publicDetail", "좌표 검증 후 공개 상세 latitude가 요청값과 일치하지 않습니다.");
  assert(detailPayload.longitude === longitude, "coordinateStatus.publicDetail", "좌표 검증 후 공개 상세 longitude가 요청값과 일치하지 않습니다.");
  record("coordinateStatus.publicDetail", "pass", "좌표 verified 후 공개 장소 상세 노출을 확인했습니다.", {
    placeId: safeString(coordinateSmokePlaceId),
  });
}

async function validateTailLogFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const findings = findSensitiveTailLogFindings(text);
  if (findings.length > 0) {
    record("tail.redaction", "fail", "captured tail log에 민감값 패턴이 남아 있습니다.", {
      findings,
    });
    return;
  }

  record("tail.redaction", "pass", "captured tail log에서 raw token/anonymous proof/coordinate/anon id/original filename 패턴이 발견되지 않았습니다.", {
    file: filePath,
  });
}

export function findSensitiveTailLogFindings(text) {
  const patterns = [
    { label: "cloudflare_or_openai_token", regex: /\b(?:sk|sk-proj|cf)_[A-Za-z0-9_-]{16,}\b|\bsk-[A-Za-z0-9_-]{16,}\b/gi },
    { label: "assigned_secret", regex: /\b(?:ADMIN_TOKEN|ADMIN_TOKENS|CLOUDFLARE_API_TOKEN)\b\s*[:=]\s*["']?(?!\[redacted\]|redacted)[^"'\s]{6,}/gi },
    { label: "admin_token_header", regex: /\bx-silsigan-admin-token\b["']?\s*[:=]\s*["']?(?!\[redacted\]|redacted)[A-Za-z0-9._~+/=-]{8,}/gi },
    { label: "bearer_token", regex: /\bBearer\s+(?!\[redacted\]|redacted)[A-Za-z0-9._~+/=-]{16,}/gi },
    { label: "anonymous_session_proof", regex: /(?:\bx-silsigan-anon-proof\b|\bproof\b)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?(?!\[redacted\]|redacted)[A-Za-z0-9_-]{43}\b/gi },
    { label: "anonymous_id", regex: /\banon_[A-Za-z0-9_-]{8,}\b/gi },
    { label: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { label: "raw_latitude", regex: /\b(?:latitude|lat)\b["']?\s*[:=]\s*"?-?\d{1,2}\.\d{4,}/gi },
    { label: "raw_longitude", regex: /\b(?:longitude|lng)\b["']?\s*[:=]\s*"?-?\d{2,3}\.\d{4,}/gi },
    { label: "coordinate_pair_lat_lng", regex: /\b(?:3[3-9]|4[0-3])\.\d{4,}\s*,\s*(?:12[4-9]|13[0-2])\.\d{4,}\b/g },
    { label: "coordinate_pair_lng_lat", regex: /\b(?:12[4-9]|13[0-2])\.\d{4,}\s*,\s*(?:3[3-9]|4[0-3])\.\d{4,}\b/g },
    { label: "original_filename", regex: /\b[A-Za-z0-9][A-Za-z0-9_. -]{2,}\.(?:jpe?g|png|webp|heic|gif)\b/gi },
  ];

  return patterns
    .filter(({ regex }) => regex.test(text))
    .map(({ label }) => label);
}

async function requestJson(baseUrl, path, init = {}) {
  return requestJsonAs(baseUrl, path, anonymousSession, init);
}

async function requestBytes(baseUrl, path, init = {}) {
  const url = new URL(path, baseUrl);
  const headers = new Headers(init.headers ?? {});
  applyAnonymousSessionHeaders(headers, anonymousSession);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SmokeError("REQUEST_TIMEOUT", `${path} 요청이 10초 안에 완료되지 않았습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function requestJsonAs(baseUrl, path, requestAnonymousSession, init = {}) {
  const url = new URL(path, baseUrl);
  const headers = new Headers(init.headers ?? {});
  applyAnonymousSessionHeaders(headers, requestAnonymousSession);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SmokeError("REQUEST_TIMEOUT", `${path} 요청이 10초 안에 완료되지 않았습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new SmokeError("JSON_PARSE_FAILED", `${path} 응답이 JSON이 아닙니다.`);
    }
  }

  return { status: response.status, payload };
}

function applyAnonymousSessionHeaders(headers, session) {
  if (typeof session === "string") {
    headers.set("x-silsigan-anon-id", session);
    return;
  }

  if (isRecord(session)) {
    headers.set("x-silsigan-anon-id", session.anonymousId);
    headers.set("x-silsigan-anon-proof", session.proof);
  }
}

function parseCoordinateOption(value, code, label) {
  if (value === undefined || value === null || value === "") {
    throw new SmokeError(code, `${label} 값이 필요합니다.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new SmokeError(code, `${label} 값이 유효한 숫자가 아닙니다.`);
  }

  return parsed;
}

function adminHeaders() {
  return {
    "x-silsigan-admin-token": adminToken,
    "x-silsigan-admin-subject": "staging-smoke",
  };
}

function expectSuccess(name, response, expectedStatus) {
  assert(response.status === expectedStatus, name, `${name} 상태가 ${expectedStatus}가 아니라 ${response.status}입니다.`);
  assert(isRecord(response.payload), name, `${name} 응답 body가 객체가 아닙니다.`);
  assert(response.payload.success === true, name, `${name} 응답 success가 true가 아닙니다.`);
  return response.payload.data;
}

function expectAnonymousSessionCredential(name, response, expectedStatus) {
  const credential = expectSuccess(name, response, expectedStatus);
  assert(isRecord(credential), name, `${name} 응답 data가 객체가 아닙니다.`);
  assert(typeof credential.anonymousId === "string" && /^[a-zA-Z0-9_-]{12,80}$/.test(credential.anonymousId), name, `${name} anonymousId 형식이 올바르지 않습니다.`);
  assert(typeof credential.proof === "string" && /^[a-zA-Z0-9_-]{43}$/.test(credential.proof), name, `${name} proof 형식이 올바르지 않습니다.`);
  assert(typeof credential.expiresAt === "string" && Date.parse(credential.expiresAt) > Date.now(), name, `${name} expiresAt이 유효하지 않습니다.`);
  return credential;
}

function expectAnonymousSessionFailure(name, response, code) {
  assert(response.status === 403, name, `${name} 상태가 403이 아니라 ${response.status}입니다.`);
  assert(response.payload?.success === false, name, `${name} 응답 success가 false가 아닙니다.`);
  assert(response.payload?.error?.code === code, name, `${name} 오류 code가 ${code}가 아닙니다.`);
}

function isPublicCoordinatePlace(place) {
  return (
    isRecord(place) &&
    typeof place.id === "string" &&
    typeof place.regionId === "string" &&
    typeof place.latitude === "number" &&
    Number.isFinite(place.latitude) &&
    typeof place.longitude === "number" &&
    Number.isFinite(place.longitude) &&
    place.coordinateStatus !== "TODO_COORDINATE_VERIFY"
  );
}

function isAnonymousUserId(value) {
  return typeof value === "string" && /^anon_[a-f0-9]{48}$/i.test(value);
}

function assertRealtimeRoom(name, room, scope, roomId) {
  assert(isRecord(room), name, `${name} 응답 data가 객체가 아닙니다.`);
  assert(room.mode === "polling" || room.mode === "durable-object-polling" || room.mode === "durable-object", name, `${name} mode가 올바르지 않습니다.`);
  assert(room.scope === scope, name, `${name} scope가 ${scope}가 아닙니다.`);
  assert(room.roomId === roomId, name, `${name} roomId가 ${roomId}가 아닙니다.`);
  assert(Array.isArray(room.events), name, `${name} events가 배열이 아닙니다.`);
  const serialized = JSON.stringify(room);
  assert(!serialized.includes(anonymousId), name, `${name} 응답에 raw anonymous id가 포함됐습니다.`);
  assert(!serialized.includes("anonymousUserId"), name, `${name} 응답에 anonymousUserId 필드가 포함됐습니다.`);
  assert(!serialized.includes("latitude") && !serialized.includes("longitude"), name, `${name} 응답에 raw coordinate 필드가 포함됐습니다.`);
}

function assertPublicPhotoShape(name, photo) {
  assert(isRecord(photo), name, `${name} 공개 사진 응답이 객체가 아닙니다.`);
  assert(typeof photo.id === "string" && photo.id.length > 0, name, `${name} 공개 사진 id가 없습니다.`);
  assert(typeof photo.placeId === "string" && photo.placeId.length > 0, name, `${name} 공개 사진 placeId가 없습니다.`);
  const serialized = JSON.stringify(photo);
  for (const field of ["anonymousUserId", "storageKey", "deletedAt", "imageHash", "originalFilename"]) {
    assert(!serialized.includes(field), name, `${name} 공개 사진 응답에 ${field} 필드가 포함됐습니다.`);
  }
}

function normalizeBaseUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new SmokeError("BASE_URL_INVALID", "staging API base URL 형식이 올바르지 않습니다.");
  }
}

function sanitizeBaseUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid]";
  }
}

function parseArgs(rawArgs) {
  const parsedFlags = new Set();
  const parsedOptions = new Map();

  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex === -1) {
      parsedFlags.add(arg);
      continue;
    }

    parsedOptions.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
  }

  return { flags: parsedFlags, options: parsedOptions };
}

function record(name, status, message, details = {}) {
  checks.push({
    name,
    status,
    message,
    ...details,
  });
}

function assert(condition, name, message) {
  if (!condition) {
    throw new SmokeError(name, message);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value) {
  return typeof value === "string" ? value : null;
}

function publicErrorMessage(error) {
  if (error instanceof SmokeError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "알 수 없는 오류가 발생했습니다.";
}

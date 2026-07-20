#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PLACE_ID = "busan-gwangalli";
const DEFAULT_PLACE_NAME = "광안리해수욕장";
const DEFAULT_REGION_ID = "busan";
const DEFAULT_ARTIFACT_DIR = "artifacts/cloudflare-pages-smoke-worker-report-local";
const FIELD_REPORT_SMOKE_PHOTO_ID = "photo-field-report-smoke";
const requiredSmokeCheckNames = [
  "map.controlsUncovered",
  "map.userCopy",
  "layout.bottomNavOpaque",
  "map.trafficButton",
  "map.filterButton",
  "map.requeryButton",
  "header.safetyButton",
  "header.notificationButton",
  "bottomNav.home",
  "onboarding.dismiss",
  "bottomNav.my",
  "my.activityComplete",
  "preferences.sync",
  "my.safetyMenu",
  "bottomNav.map",
  "rankings.visible",
  "rankings.detail",
  "place.detail",
  "worker.placesSearchRequest",
  "worker.realtimePlaceRoom",
  "worker.realtimeRegionRoom",
  "worker.realtimeGlobalRoom",
  "places.like",
  "comments.create",
  "comments.like",
  "photos.click",
  "photos.delete",
  "reports.placeCreate",
  "reports.commentCreate",
  "reports.photoCreate",
  "reports.create",
  "fieldReports.placeSelection",
  "fieldReports.photoRightsAttestation",
  "fieldReports.photoUpload",
  "fieldReports.create",
  "fieldReports.shareDeepLink",
  "hashtags.fieldReportPhoto",
  "hashtags.followReturn",
  "hashtags.pagination",
  "search.externalFallback",
  "placeRequests.create",
  "placeRequests.ownerStatus",
  "fieldReports.publicationContract",
  "share.postPage",
  "share.opengraphImage",
  "accountDeletion.confirmationGate",
  "accountDeletion.request",
  "accountDeletion.sessionRotated",
  "accountDeletion.oldSessionRejected",
  "accountDeletion.completed",
  "admin.login",
  "admin.kpis.aggregateOnly",
  "admin.apiCostGuard.threeMeters",
  "admin.apiCostGuard.stop",
  "admin.apiCostGuard.reconcileResume",
  "admin.costGuard.fiveMeters",
  "admin.costGuard.stop",
  "admin.costGuard.resume",
];
const tinyJpegBase64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

class LocalSmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalSmokeError";
    this.code = code;
  }
}

if (isCliEntryPoint()) {
  await main();
}

function parseArgs(rawArgs) {
  const flags = new Set();
  const options = new Map();

  for (const rawArg of rawArgs) {
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const arg = rawArg.slice(2);
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex === -1) {
      flags.add(arg);
      continue;
    }

    options.set(arg.slice(0, separatorIndex), arg.slice(separatorIndex + 1));
  }

  return { flags, options };
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const config = {
    artifactDir: options.get("artifact-dir") ?? process.env.SILSIGAN_STAGING_BROWSER_ARTIFACT_DIR ?? DEFAULT_ARTIFACT_DIR,
    timeoutMs: numberOption(options.get("timeout-ms") ?? process.env.SILSIGAN_STAGING_BROWSER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pagesPort: numberOption(options.get("pages-port"), 0),
    workerPort: numberOption(options.get("worker-port"), 0),
  };
  const adminTokens = {
    next: `local-next-admin-${randomUUID()}`,
    worker: `local-worker-admin-${randomUUID()}`,
  };
  const worker = await startMockWorker(config.workerPort, adminTokens.worker);
  const nextPort = config.pagesPort || (await findFreePort());
  const pagesUrl = `http://127.0.0.1:${nextPort}`;
  let nextDev = null;

  try {
    nextDev = await startNextDev(nextPort, worker.url, adminTokens);
    try {
      await waitForHttpOk(pagesUrl, "next.dev", config.timeoutMs);
    } catch (error) {
      const diagnostic = [nextDev.stderr().slice(-4_000), nextDev.stdout().slice(0, 4_000)]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      throw new LocalSmokeError(
        "NEXT_DEV_READY_FAILED",
        `${error instanceof Error ? error.message : "Next dev failed to start."}${diagnostic ? `\n${diagnostic}` : ""}`,
      );
    }
    const smoke = await runPagesSmoke({
      apiBaseUrl: worker.url,
      artifactDir: config.artifactDir,
      pagesUrl,
      timeoutMs: config.timeoutMs,
      adminToken: adminTokens.next,
    });
    const reportTargetTypes = [...new Set(worker.reportTargetTypes)];
    const requiredTargetTypes = ["place", "comment", "photo"];
    const missingTargetTypes = requiredTargetTypes.filter((targetType) => !reportTargetTypes.includes(targetType));
    if (missingTargetTypes.length > 0) {
      throw new LocalSmokeError("REPORT_TARGET_TYPES_MISSING", `Missing report target types: ${missingTargetTypes.join(", ")}`);
    }
    if (worker.fieldReportCount() < 1) {
      throw new LocalSmokeError("FIELD_REPORT_MISSING", "No field report was created through /api/reports.");
    }
    const publicationContract = worker.latestFieldReportPublicationContract();
    if (!publicationContract?.valid) {
      throw new LocalSmokeError("FIELD_REPORT_PUBLICATION_CONTRACT_MISSING", "The browser field report did not carry the v3 publication contract.");
    }
    smoke.checks.push({
      name: "fieldReports.publicationContract",
      status: "pass",
      message: "브라우저 현장 제보가 멱등 키와 사진/해시태그 배열을 하나의 v3 발행 계약으로 전송했습니다.",
    });
    if (worker.placeRequestCreationCount() !== 1) {
      throw new LocalSmokeError("PLACE_REQUEST_CREATION_COUNT_INVALID", "The browser must create exactly one private place addition request.");
    }
    const placeRequestContract = worker.latestPlaceAdditionRequestContract();
    if (!placeRequestContract?.valid) {
      throw new LocalSmokeError("PLACE_REQUEST_CONTRACT_INVALID", "The browser place request did not use the private manual-request contract.");
    }
    if (worker.sharedPostRequestCount() < 2) {
      throw new LocalSmokeError("SHARED_POST_WORKER_LOOKUP_MISSING", "Share page and OG image did not read posts from the mock Worker API.");
    }
    if (worker.hiddenPostRequestCount() > 0) {
      throw new LocalSmokeError("PUBLIC_HIDDEN_POST_LOOKUP_USED", "Share page or OG image attempted to read hidden posts from the public Worker API.");
    }
    const apiCostGuardMutations = worker.apiCostGuardMutations();
    if (
      apiCostGuardMutations.length !== 3
      || apiCostGuardMutations[0]?.type !== "mode"
      || apiCostGuardMutations[0]?.mode !== "stopped"
      || apiCostGuardMutations[1]?.type !== "reconciliation"
      || apiCostGuardMutations[2]?.type !== "mode"
      || apiCostGuardMutations[2]?.mode !== "running"
    ) {
      throw new LocalSmokeError("API_COST_GUARD_SEQUENCE_INVALID", "The admin browser smoke did not stop, reconcile, and resume the global API guard in order.");
    }
    const photoCostGuardMutations = worker.photoCostGuardMutations();
    if (
      photoCostGuardMutations.length !== 2 ||
      photoCostGuardMutations[0]?.uploadsEnabled !== false ||
      photoCostGuardMutations[0]?.readsEnabled !== false ||
      photoCostGuardMutations[1]?.uploadsEnabled !== true ||
      photoCostGuardMutations[1]?.readsEnabled !== true
    ) {
      throw new LocalSmokeError("PHOTO_COST_GUARD_SEQUENCE_INVALID", "The admin browser smoke did not stop and then resume both R2 uploads and reads.");
    }
    const networkArtifactRedaction = await validateNetworkArtifactRedaction(smoke.artifacts?.network, {
      requiredReportTargetTypes: requiredTargetTypes,
    });
    const smokeCheckIntegrity = validateSmokeCheckIntegrity(smoke.checks, {
      requiredCheckNames: requiredSmokeCheckNames,
    });
    const accountDeletionEvidence = validateAccountDeletionEvidence(worker.accountDeletionEvidence());

    const summary = {
      ok: true,
      pagesUrl,
      apiBaseUrl: worker.url,
      reportTargetTypes,
      fieldReportCount: worker.fieldReportCount(),
      fieldReportPublicationContract: publicationContract,
      placeRequestCreationCount: worker.placeRequestCreationCount(),
      placeRequestContract,
      sharedPostRequestCount: worker.sharedPostRequestCount(),
      hiddenPostRequestCount: worker.hiddenPostRequestCount(),
      apiCostGuardMutations,
      photoCostGuardMutations,
      accountDeletionEvidence,
      networkArtifactRedaction,
      smokeCheckIntegrity,
      artifacts: smoke.artifacts,
      smokeChecks: smoke.checks,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await stopNextDev(nextDev);
    await worker.close();
  }
}

async function runPagesSmoke({ apiBaseUrl, artifactDir, pagesUrl, timeoutMs, adminToken }) {
  const { stdout, stderr, code } = await execNodeScript("scripts/cloudflare-pages-smoke.mjs", [
    `--pages-url=${pagesUrl}`,
    `--api-base-url=${apiBaseUrl}`,
    `--artifact-dir=${artifactDir}`,
    `--timeout-ms=${timeoutMs}`,
    "--share-post-id=post-local-report-smoke",
    "--mutating",
    "--report",
    "--require-photo",
    "--field-report-photo",
    "--local-admin-cost-guard",
    "--account-deletion",
  ], {
    SILSIGAN_LOCAL_ADMIN_SMOKE_TOKEN: adminToken,
  });
  if (code !== 0) {
    throw new LocalSmokeError("PAGES_SMOKE_FAILED", stderr.trim() || stdout.trim() || "Pages smoke failed");
  }

  return JSON.parse(stdout);
}

export function validateSmokeCheckIntegrity(checks, options = {}) {
  if (!Array.isArray(checks)) {
    throw new LocalSmokeError("SMOKE_CHECKS_INVALID", "Pages smoke checks must be an array.");
  }

  const requiredCheckNames = Array.isArray(options.requiredCheckNames) ? options.requiredCheckNames : [];
  const passedCheckNames = new Set(checks.filter((check) => check?.status === "pass").map((check) => check.name).filter(Boolean));
  const failedCheckNames = checks.filter((check) => check?.status === "fail").map((check) => check.name).filter(Boolean);
  if (failedCheckNames.length > 0) {
    throw new LocalSmokeError("SMOKE_CHECKS_FAILED", `Pages smoke reported failed checks: ${failedCheckNames.join(", ")}`);
  }

  const missingCheckNames = requiredCheckNames.filter((checkName) => !passedCheckNames.has(checkName));
  if (missingCheckNames.length > 0) {
    throw new LocalSmokeError("SMOKE_CHECKS_MISSING", `Pages smoke is missing required passed checks: ${missingCheckNames.join(", ")}`);
  }

  return {
    passedRequiredChecks: requiredCheckNames,
    failedChecks: [],
  };
}

export function validateFieldReportPublicationContract(body, expectedPhotoId = FIELD_REPORT_SMOKE_PHOTO_ID) {
  const photoIdsArray = Array.isArray(body?.photoIds) && body.photoIds.every((photoId) => typeof photoId === "string");
  const hashtagNamesArray = Array.isArray(body?.hashtagNames) && body.hashtagNames.every((hashtagName) => typeof hashtagName === "string");
  const uploadedPhotoLinked = photoIdsArray && body.photoIds.includes(expectedPhotoId);
  const summary = {
    validClientRequestId: typeof body?.clientRequestId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,99}$/.test(body.clientRequestId),
    photoIdsArray,
    hashtagNamesArray,
    uploadedPhotoLinked,
    photoCount: photoIdsArray ? body.photoIds.length : -1,
    hashtagCount: hashtagNamesArray ? body.hashtagNames.length : -1,
  };

  return {
    ...summary,
    valid: summary.validClientRequestId && summary.photoIdsArray && summary.hashtagNamesArray && summary.uploadedPhotoLinked,
  };
}

export function validatePlaceAdditionRequestContract(body) {
  const allowedFields = ["address", "category", "clientRequestId", "name"];
  const exactFields = body && typeof body === "object"
    && Object.keys(body).sort().join("\u0000") === allowedFields.join("\u0000");
  const validClientRequestId = typeof body?.clientRequestId === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,99}$/.test(body.clientRequestId);
  const validName = typeof body?.name === "string" && body.name.trim().length >= 2 && body.name.length <= 120;
  const validAddress = typeof body?.address === "string" && body.address.trim().length >= 4 && body.address.length <= 240;
  const validCategory = typeof body?.category === "string" && body.category.trim().length >= 1 && body.category.length <= 80;

  return {
    exactFields,
    validClientRequestId,
    validName,
    validAddress,
    validCategory,
    valid: exactFields && validClientRequestId && validName && validAddress && validCategory,
  };
}

function publicPlaceAdditionRequest(placeRequest, { includeReviewReason = false } = {}) {
  const publicRequest = {
    id: placeRequest.id,
    clientRequestId: placeRequest.clientRequestId,
    name: placeRequest.name,
    address: placeRequest.address,
    category: placeRequest.category,
    status: placeRequest.status,
    matchedPlaceId: placeRequest.matchedPlaceId,
    createdAt: placeRequest.createdAt,
    updatedAt: placeRequest.updatedAt,
    reviewedAt: placeRequest.reviewedAt,
  };

  return includeReviewReason
    ? { ...publicRequest, reviewReason: placeRequest.reviewReason }
    : publicRequest;
}

export function validateAccountDeletionEvidence(evidence) {
  if (evidence?.accountDeletionCount !== 1) {
    throw new LocalSmokeError("ACCOUNT_DELETION_COUNT_INVALID", "Local account deletion must run exactly once.");
  }
  if (
    !(evidence.sessionIssueCount >= 2)
    || typeof evidence.initialSessionId !== "string"
    || typeof evidence.currentSessionId !== "string"
    || evidence.initialSessionId === evidence.currentSessionId
  ) {
    throw new LocalSmokeError("ACCOUNT_DELETION_SESSION_NOT_ROTATED", "Account deletion must rotate the anonymous session.");
  }
  if (evidence.remainingOwnedContentCount !== 0) {
    throw new LocalSmokeError("ACCOUNT_DELETION_OWNED_CONTENT_REMAINED", "Account deletion left owned content behind.");
  }

  return {
    accountDeletionCount: evidence.accountDeletionCount,
    sessionIssueCount: evidence.sessionIssueCount,
    sessionRotated: true,
    remainingOwnedContentCount: evidence.remainingOwnedContentCount,
  };
}

export async function validateNetworkArtifactRedaction(networkPath, options = {}) {
  if (!networkPath) {
    throw new LocalSmokeError("NETWORK_ARTIFACT_MISSING", "Pages smoke network artifact path is missing.");
  }

  const events = JSON.parse(await readFile(networkPath, "utf8"));
  if (!Array.isArray(events)) {
    throw new LocalSmokeError("NETWORK_ARTIFACT_INVALID", "Pages smoke network artifact must be an event array.");
  }

  const postDataEvents = events.filter((event) => event && typeof event === "object" && Object.hasOwn(event, "postData"));
  if (postDataEvents.length > 0) {
    throw new LocalSmokeError("NETWORK_ARTIFACT_POST_DATA", "Pages smoke network artifact must not persist request postData.");
  }

  const serialized = JSON.stringify(events);
  const forbiddenPatterns = [
    ["admin-token", /test-admin-token|x-silsigan-admin-token/i],
    ["anonymous-id", /anonymousUserId|anon_[a-zA-Z0-9_-]{8,}/],
    ["report-note", /지도 상세에서 접수된 장소 신고|댓글 신고:|사진 신고:/],
    ["smoke-comment", /browser smoke comment/i],
    ["original-filename", /originalFileName|original filename/i],
  ];
  const hits = forbiddenPatterns.map(([name, pattern]) => (pattern.test(serialized) ? name : null)).filter(Boolean);
  if (hits.length > 0) {
    throw new LocalSmokeError("NETWORK_ARTIFACT_SENSITIVE_VALUE", `Pages smoke network artifact contains sensitive values: ${hits.join(", ")}`);
  }
  const reportTargetTypes = [...new Set(events.map((event) => event?.reportTargetType).filter(Boolean))].sort();
  const requiredReportTargetTypes = Array.isArray(options.requiredReportTargetTypes) ? options.requiredReportTargetTypes : [];
  const missingReportTargetTypes = requiredReportTargetTypes.filter((targetType) => !reportTargetTypes.includes(targetType));
  if (missingReportTargetTypes.length > 0) {
    throw new LocalSmokeError("NETWORK_ARTIFACT_REPORT_TARGET_TYPES_MISSING", `Pages smoke network artifact is missing report target types: ${missingReportTargetTypes.join(", ")}`);
  }

  return {
    eventCount: events.length,
    reportTargetTypes,
    storesPostData: false,
    sensitiveHits: [],
  };
}

export async function createIsolatedNextWorkspace(projectRoot = process.cwd()) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "silsigan-pages-smoke-"));
  try {
    await mkdir(join(workspaceRoot, "apps", "webview"), { recursive: true });
    await Promise.all([
      ...["src", "public", "packages"].map((entry) =>
        cp(join(projectRoot, entry), join(workspaceRoot, entry), { recursive: true })
      ),
      cp(
        join(projectRoot, "apps", "webview", "src"),
        join(workspaceRoot, "apps", "webview", "src"),
        { recursive: true },
      ),
      symlink(join(projectRoot, "node_modules"), join(workspaceRoot, "node_modules"), "dir"),
      ...["package.json", "next.config.ts", "tsconfig.json", "next-env.d.ts"].map((entry) =>
        copyFile(join(projectRoot, entry), join(workspaceRoot, entry))
      ),
    ]);
    return workspaceRoot;
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function startNextDev(port, apiBaseUrl, adminTokens) {
  const projectRoot = process.cwd();
  const workspaceRoot = await createIsolatedNextWorkspace(projectRoot);
  const nextBinPath = join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBinPath, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: apiBaseUrl,
      SILSIGAN_WORKER_API_BASE_URL: apiBaseUrl,
      SILSIGAN_ADMIN_TOKEN: adminTokens.next,
      SILSIGAN_WORKER_ADMIN_TOKEN: adminTokens.worker,
      NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: "",
      npm_config_cache: process.env.npm_config_cache ?? "/tmp/codex-npm-cache",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  return { child, stderr: () => stderr, stdout: () => stdout, workspaceRoot };
}

export async function stopNextDev(nextDev) {
  if (!nextDev) {
    return;
  }

  try {
    if (nextDev.child.exitCode === null && nextDev.child.signalCode === null) {
      nextDev.child.kill("SIGTERM");
      await Promise.race([
        once(nextDev.child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }

    if (nextDev.child.exitCode === null && nextDev.child.signalCode === null) {
      nextDev.child.kill("SIGKILL");
      await Promise.race([
        once(nextDev.child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  } finally {
    await rm(nextDev.workspaceRoot, { recursive: true, force: true });
  }
}

async function execNodeScript(scriptPath, args, extraEnv = {}) {
  const child = spawn(process.execPath, [join(process.cwd(), scriptPath), ...args], {
    env: {
      ...process.env,
      ...extraEnv,
      npm_config_cache: process.env.npm_config_cache ?? "/tmp/codex-npm-cache",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const [code] = await once(child, "exit");

  return { code, stderr, stdout };
}

async function startMockWorker(port, expectedAdminToken) {
  const state = {
    accountDeletionCount: 0,
    comments: [],
    commentLikes: new Set(),
    currentSession: null,
    fieldReports: [],
    fieldReportCreationCount: 0,
    fieldReportPublicationContracts: [],
    placeAdditionRequestContracts: [],
    placeRequestCreationCount: 0,
    placeRequests: [],
    fieldReportPhotoUploaded: false,
    initialSessionId: null,
    likeCount: 0,
    photoClickCount: 3,
    photoDeleted: false,
    hiddenPostRequestCount: 0,
    sharedPostRequestCount: 0,
    questions: [workerQuestion()],
    reportTargetTypes: [],
    sessionIssueCount: 0,
    apiCostGuard: initialApiCostGuard(),
    apiCostGuardMutations: [],
    photoCostGuard: initialPhotoCostGuard(),
    photoCostGuardMutations: [],
    preferences: {
      savedPlaceIds: [],
      savedPostIds: [],
      followedTopicNames: [],
      notificationEnabled: false,
      notificationPlatform: "webview",
    },
  };
  const issueAnonymousSession = () => {
    state.sessionIssueCount += 1;
    const sequence = String(state.sessionIssueCount).padStart(6, "0");
    const session = {
      anonymousId: `anon_local_report_smoke_${state.sessionIssueCount}`,
      proof: `localReportSmokeAnonymousSessionProof${sequence}`,
      expiresAt: "2099-12-31T23:59:59.999Z",
    };
    state.currentSession = session;
    state.initialSessionId ??= session.anonymousId;
    return session;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const requestAnonId = validAnonId(request.headers["x-silsigan-anon-id"])
      ? String(request.headers["x-silsigan-anon-id"])
      : null;
    const anonId = requestAnonId ?? state.currentSession?.anonymousId ?? "public";
    const send = (status, payload, headers = {}) => {
      response.writeHead(status, {
        "access-control-allow-headers": "content-type,x-silsigan-anon-id,x-silsigan-anon-proof,x-silsigan-admin-token",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-origin": request.headers.origin ?? "*",
        "access-control-expose-headers": "x-silsigan-anon-id",
        "content-type": "application/json",
        ...(anonId !== "public" ? { "x-silsigan-anon-id": anonId } : {}),
        ...headers,
      });
      response.end(JSON.stringify(payload));
    };
    const success = (data, meta = {}) => ({ success: true, data, meta });

    if (request.method === "OPTIONS") {
      send(204, {});
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/anonymous") {
      send(201, success(issueAnonymousSession()));
      return;
    }

    const anonymousProofRequired =
      ((request.method !== "GET" && request.method !== "HEAD") && !url.pathname.startsWith("/api/admin/"))
      || (request.method === "GET" && ["/api/preferences", "/api/my-questions", "/api/blocks"].includes(url.pathname))
      || (request.method === "GET" && url.pathname === "/api/place-requests" && url.searchParams.get("mine") === "1");
    if (
      anonymousProofRequired
      && (
        !state.currentSession
        || requestAnonId !== state.currentSession.anonymousId
        || request.headers["x-silsigan-anon-proof"] !== state.currentSession.proof
      )
    ) {
      send(403, { success: false, error: { code: "ANONYMOUS_SESSION_PROOF_INVALID", message: "invalid anonymous session proof" } });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/account/deletion") {
      const body = await readJsonBody(request);
      if (body.confirmation !== "DELETE_MY_ACCOUNT") {
        send(400, { success: false, error: { code: "ACCOUNT_DELETION_CONFIRMATION_REQUIRED", message: "confirmation required" } });
        return;
      }
      state.accountDeletionCount += 1;
      state.comments = [];
      state.commentLikes.clear();
      state.fieldReports = [];
      state.fieldReportPhotoUploaded = false;
      state.likeCount = 0;
      state.photoDeleted = true;
      state.questions = [];
      state.placeRequests = [];
      state.preferences = {
        savedPlaceIds: [],
        savedPostIds: [],
        followedTopicNames: [],
        notificationEnabled: false,
        notificationPlatform: "webview",
      };
      state.currentSession = null;
      send(200, success({ deleted: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(200, success({ ok: true, service: "local-pages-report-smoke", storage: "memory" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      send(
        200,
        success({
          contractVersion: 2,
          dataMode: "live",
          featureFlags: {
            QNA_ENABLED: false,
            REWARDS_ENABLED: false,
            ADS_ENABLED: false,
            LIVE_STREAMS_ENABLED: false,
            DEMO_DATA_ENABLED: false,
            SEOUL_REALTIME_ENABLED: false,
            SOCIAL_FEED_ENABLED: false,
          },
          dimensionSettings: [],
          photoUploadProtection: {
            turnstileRequired: false,
            turnstileSiteKey: null,
          },
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/place-requests") {
      const body = await readJsonBody(request);
      const contract = validatePlaceAdditionRequestContract(body);
      state.placeAdditionRequestContracts.push(contract);
      if (!contract.valid) {
        send(400, { success: false, error: { code: "PLACE_REQUEST_CONTRACT_REQUIRED", message: "private manual place request contract required" } });
        return;
      }
      const existing = state.placeRequests.find(
        (candidate) => candidate.ownerAnonymousId === anonId && candidate.clientRequestId === body.clientRequestId,
      );
      if (existing) {
        const publicRequest = publicPlaceAdditionRequest(existing, { includeReviewReason: true });
        send(200, success(publicRequest, { idempotentReplay: true, ownerOnly: true }));
        return;
      }
      const now = new Date().toISOString();
      const placeRequest = {
        id: `place_request_local_smoke_${state.placeRequestCreationCount + 1}`,
        ownerAnonymousId: anonId,
        clientRequestId: body.clientRequestId,
        name: body.name.trim(),
        address: body.address.trim(),
        category: body.category.trim(),
        status: "needs_verification",
        matchedPlaceId: null,
        reviewReason: null,
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
      };
      state.placeRequestCreationCount += 1;
      state.placeRequests.unshift(placeRequest);
      const publicRequest = publicPlaceAdditionRequest(placeRequest, { includeReviewReason: true });
      send(201, success(publicRequest, { idempotentReplay: false, ownerOnly: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/place-requests") {
      if (url.searchParams.get("mine") !== "1") {
        send(400, { success: false, error: { code: "PLACE_REQUEST_MINE_REQUIRED", message: "mine=1 required" } });
        return;
      }
      const mine = state.placeRequests
        .filter((candidate) => candidate.ownerAnonymousId === anonId)
        .map((candidate) => publicPlaceAdditionRequest(candidate));
      send(200, success(mine, { ownerOnly: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/places") {
      const place = workerPlace();
      const query = url.searchParams.get("q")?.trim().toLocaleLowerCase("ko-KR") ?? "";
      const matchesQuery = !query || [place.name, place.address, place.category, place.regionId].join(" ").toLocaleLowerCase("ko-KR").includes(query);
      send(200, success(matchesQuery ? [place] : []));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/places/${DEFAULT_PLACE_ID}/status`) {
      const observedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      send(
        200,
        success({
          contractVersion: 2,
          placeId: DEFAULT_PLACE_ID,
          dataMode: "live",
          status: "check_before_visit",
          currentSignals: [
            {
              id: "signal-local-report-smoke-weather",
              placeId: DEFAULT_PLACE_ID,
              dimension: "weather",
              valueCode: "clear",
              valueText: "맑음",
              sourceId: "source-kma-local-report-smoke",
              sourceType: "official_periodic",
              sourceName: "기상청 단기예보",
              attributionText: "기상청 공공데이터",
              observedAt,
              fetchedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
              confidenceScore: 0.95,
              isEstimated: false,
              isExpired: false,
            },
          ],
          missingRequiredDimensions: ["crowd"],
          conflictingDimensions: [],
          independentSourceCount: 1,
          confidenceScore: 0.62,
          reasonCodes: ["MORE_CURRENT_EVIDENCE_REQUIRED"],
          observedAt,
          computedAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/blocks") {
      send(200, success([]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/preferences") {
      send(200, success(state.preferences));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/preferences") {
      const body = await readJsonBody(request);
      if (body.kind === "notifications" && typeof body.enabled === "boolean") {
        state.preferences.notificationEnabled = body.enabled;
        state.preferences.notificationPlatform = typeof body.platform === "string" ? body.platform : "webview";
      } else if (
        ["saved_place", "saved_post", "followed_topic"].includes(body.kind) &&
        typeof body.key === "string" &&
        typeof body.enabled === "boolean"
      ) {
        const field = body.kind === "saved_place" ? "savedPlaceIds" : body.kind === "saved_post" ? "savedPostIds" : "followedTopicNames";
        const values = new Set(state.preferences[field]);
        if (body.enabled) values.add(body.key);
        else values.delete(body.key);
        state.preferences[field] = [...values];
      } else {
        send(400, { success: false, error: { code: "PREFERENCE_MUTATION_INVALID", message: "invalid preference mutation" } });
        return;
      }
      send(200, success(state.preferences));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/moderation/reports") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      send(200, success([]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/field-reports") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      send(200, success([]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/beta-kpis") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      const windowDays = url.searchParams.get("days") === "30" ? 30 : 7;
      send(200, success({
        windowDays,
        generatedAt: new Date().toISOString(),
        privacy: "aggregate-only",
        audience: { activeUsers: 128, appOpens: 194 },
        reportFunnel: { started: 48, submitted: 38, conversionPercent: 79.17, medianCompletionSeconds: 12.4 },
        mapReliability: { succeeded: 199, failed: 1, successPercent: 99.5 },
        moderation: {
          submitted: 40,
          pending: 2,
          approved: 34,
          rejected: 3,
          hidden: 1,
          approvalPercent: 89.47,
          reviewedWithin24HoursPercent: 100,
        },
        retention: {
          d1: { cohortUsers: 80, retainedUsers: 34, percent: 42.5 },
          d7: { cohortUsers: 60, retainedUsers: 18, percent: 30 },
        },
        freshCoverage: {
          eligiblePlaces: 30,
          coveredPlaces: 18,
          percent: 60,
          tierA: { eligiblePlaces: 12, coveredPlaces: 9, percent: 75 },
          tierB: { eligiblePlaces: 18, coveredPlaces: 9, percent: 50 },
        },
        runtimeReliability: { appOpenUsers: 128, errorUsers: 0, errorFreePercent: 100 },
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/api-cost-guard") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      send(200, success(state.apiCostGuard));
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/admin/api-cost-guard") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      const body = await readJsonBody(request);
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if ((body.mode !== "running" && body.mode !== "degraded" && body.mode !== "stopped") || reason.length < 5) {
        send(400, { success: false, error: { code: "API_COST_GUARD_STATE_INVALID", message: "invalid guard state" } });
        return;
      }
      if (body.expectedGeneration !== state.apiCostGuard.control.generation) {
        send(409, { success: false, error: { code: "API_COST_GUARD_GENERATION_CONFLICT", message: "generation conflict" } });
        return;
      }
      if (body.mode === "running" && !state.apiCostGuard.reconciliationFresh) {
        send(409, { success: false, error: { code: "API_COST_GUARD_RECONCILIATION_REQUIRED", message: "fresh reconciliation required" } });
        return;
      }
      state.apiCostGuard = {
        ...state.apiCostGuard,
        control: {
          mode: body.mode,
          reason,
          generation: state.apiCostGuard.control.generation + 1,
          automaticMetric: "manual",
          updatedBy: "admin:local-smoke",
          updatedAt: new Date().toISOString(),
        },
      };
      state.apiCostGuardMutations.push({ type: "mode", mode: body.mode });
      send(200, success(state.apiCostGuard));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/admin/api-cost-guard/reconciliations") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      const body = await readJsonBody(request);
      const values = [body.observedWorkersRequests, body.observedD1RowsRead, body.observedD1RowsWritten];
      if (!values.every((value) => Number.isSafeInteger(value) && value >= 0) || typeof body.note !== "string" || body.note.trim().length < 5) {
        send(400, { success: false, error: { code: "API_COST_GUARD_RECONCILIATION_INVALID", message: "invalid reconciliation" } });
        return;
      }
      const [workersRequests, d1RowsRead, d1RowsWritten] = values;
      state.apiCostGuard = {
        ...state.apiCostGuard,
        usage: { workersRequests, d1RowsRead, d1RowsWritten },
        meters: {
          workersPercent: (workersRequests / state.apiCostGuard.limits.workersRequests) * 100,
          d1ReadPercent: (d1RowsRead / state.apiCostGuard.limits.d1RowsRead) * 100,
          d1WritePercent: (d1RowsWritten / state.apiCostGuard.limits.d1RowsWritten) * 100,
        },
        reconciliationFresh: true,
      };
      state.apiCostGuardMutations.push({ type: "reconciliation" });
      send(200, success(state.apiCostGuard));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/photo-cost-guard") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      send(200, success(state.photoCostGuard));
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/admin/photo-cost-guard") {
      if (request.headers["x-silsigan-admin-token"] !== expectedAdminToken) {
        send(403, { success: false, error: { code: "ADMIN_FORBIDDEN", message: "admin token required" } });
        return;
      }
      const body = await readJsonBody(request);
      if (typeof body.uploadsEnabled !== "boolean" || typeof body.readsEnabled !== "boolean") {
        send(400, { success: false, error: { code: "PHOTO_COST_GUARD_STATE_INVALID", message: "invalid guard state" } });
        return;
      }
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 5) {
        send(400, { success: false, error: { code: "PHOTO_COST_GUARD_REASON_INVALID", message: "reason required" } });
        return;
      }
      state.photoCostGuard = {
        ...state.photoCostGuard,
        uploadsEnabled: body.uploadsEnabled,
        readsEnabled: body.readsEnabled,
        reason,
        updatedAt: new Date().toISOString(),
      };
      state.photoCostGuardMutations.push({
        uploadsEnabled: body.uploadsEnabled,
        readsEnabled: body.readsEnabled,
      });
      send(200, success(state.photoCostGuard));
      return;
    }

    const sharedPostMatch = url.pathname.match(/^\/api\/share\/posts\/([^/]+)$/);
    if (request.method === "GET" && sharedPostMatch) {
      const post = workerPost();
      if (decodeURIComponent(sharedPostMatch[1]) !== post.id) {
        send(404, { success: false, error: { code: "NOT_FOUND", message: "shared post not found" } });
        return;
      }
      state.sharedPostRequestCount += 1;
      send(200, success({
        ...post,
        shareCard: { ...post.shareCard, variant: "neutral" },
        status: {
          dataMode: "demo",
          status: "insufficient",
          currentSignals: [],
          independentSourceCount: 0,
          confidenceScore: 0,
          reasonCodes: ["DEMO_DATA_EXCLUDED"],
          observedAt: null,
          computedAt: new Date().toISOString(),
        },
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/posts") {
      const hashtagName = url.searchParams.get("hashtagName")?.trim();
      const post = workerPost();
      if (url.searchParams.get("includeHidden") === "true") {
        state.hiddenPostRequestCount += 1;
      }
      if (url.searchParams.get("limit") === "200" && !hashtagName) {
        state.sharedPostRequestCount += 1;
      }
      send(200, success(!hashtagName || post.hashtagNames.includes(hashtagName) ? [post] : []));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/hashtags") {
      const hashtagName = url.searchParams.get("name")?.trim();
      if (!hashtagName) {
        send(200, success(workerHashtags()));
        return;
      }

      const sourceReport = state.fieldReports.find(
        (report) => report.hashtagNames.includes(hashtagName) && report.photoIds.length > 0,
      );
      if (!sourceReport) {
        send(200, success([]));
        return;
      }

      const cursor = url.searchParams.get("cursor");
      const secondPageCreatedAt = new Date(Date.parse(sourceReport.createdAt) - 60_000).toISOString();
      const media = cursor
        ? [{
            ...sourceReport,
            id: `${sourceReport.id}-page-2`,
            createdAt: secondPageCreatedAt,
          }]
        : [sourceReport];
      const baseRecord = workerHashtags().find((hashtag) => hashtag.name === hashtagName);
      send(200, success([{
        ...(baseRecord ?? {
          id: `hashtag_${hashtagName}`,
          name: hashtagName,
          tagType: "time",
          createdAt: sourceReport.createdAt,
        }),
        postCount: 2,
        latestObservedAt: sourceReport.createdAt,
        activePlaceCount: 1,
        recentPhotoCount: 2,
        recentMedia: media,
        nextCursor: cursor ? null : `${sourceReport.createdAt}|${sourceReport.id}`,
      }]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/questions") {
      send(200, success(state.questions));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/questions") {
      const body = await readJsonBody(request);
      const question = {
        id: `question-local-report-smoke-${state.questions.length + 1}`,
        placeId: String(body.placeId ?? DEFAULT_PLACE_ID),
        questionType: String(body.questionType ?? "crowd"),
        body: String(body.body ?? "지금 사람 많은가요?"),
        creditCost: body.questionType === "photo_request" ? 2 : 1,
        answeredReportId: null,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      state.questions.unshift(question);
      send(201, success({ question, creditEvent: { type: "ask_question", amount: -question.creditCost }, balance: Math.max(0, 3 - question.creditCost) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/my-questions") {
      send(200, success(state.questions));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/reports") {
      send(200, success(state.fieldReports));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports") {
      const body = await readJsonBody(request);
      const contractSummary = validateFieldReportPublicationContract(body);
      state.fieldReportPublicationContracts.push(contractSummary);
      if (!contractSummary.valid) {
        send(400, { success: false, error: { code: "PUBLICATION_CONTRACT_REQUIRED", message: "v3 publication contract required" } });
        return;
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
      const report = {
        id: `field-report-local-${state.fieldReports.length + 1}`,
        placeId: String(body.placeId ?? DEFAULT_PLACE_ID),
        category: fieldReportCategory(body.category),
        crowdLevel: fieldReportValue(body.crowdLevel, ["quiet", "normal", "busy", "packed"], "busy"),
        lineStatus: fieldReportValue(body.lineStatus, ["none", "short", "medium", "long"], "short"),
        parkingStatus: fieldReportValue(body.parkingStatus, ["available", "limited", "full", "unknown"], "limited"),
        comment: typeof body.comment === "string" ? body.comment : null,
        photoIds: body.photoIds,
        hashtagNames: body.hashtagNames,
        localConditions: [],
        observations: [{ dimension: "crowd", valueCode: fieldReportValue(body.crowdLevel, ["quiet", "normal", "busy", "packed"], "busy"), expiresAt }],
        verifiedRadiusM: null,
        verificationMethod: "none",
        accuracyBucket: "unknown",
        moderationStatus: "approved",
        createdAt: now.toISOString(),
        expiresAt,
      };
      state.fieldReports.unshift(report);
      state.fieldReportCreationCount += 1;
      send(
        201,
        success({
          report,
          credits: [{ reason: "status_report", amount: 1 }],
          publication: {
            clientRequestId: body.clientRequestId,
            photoIds: body.photoIds,
            hashtagNames: body.hashtagNames,
          },
          safetyWarning: null,
          privacyNotice: "정확 좌표와 원본 파일명은 저장하지 않습니다.",
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/realtime/place/${DEFAULT_PLACE_ID}`) {
      send(
        200,
        success({
          mode: "durable-object-polling",
          scope: "place",
          roomId: `place:${DEFAULT_PLACE_ID}`,
          events: realtimeEvents(state, "place", `place:${DEFAULT_PLACE_ID}`),
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/realtime/region/${DEFAULT_REGION_ID}`) {
      send(
        200,
        success({
          mode: "durable-object-polling",
          scope: "region",
          roomId: DEFAULT_REGION_ID,
          events: realtimeEvents(state, "region", DEFAULT_REGION_ID),
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/realtime/global") {
      send(
        200,
        success({
          mode: "durable-object-polling",
          scope: "global",
          roomId: "global",
          events: realtimeEvents(state, "global", "global"),
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/places/${DEFAULT_PLACE_ID}/click`) {
      send(200, success({ placeId: DEFAULT_PLACE_ID, created: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/places/${DEFAULT_PLACE_ID}/like`) {
      state.likeCount = 1;
      send(200, success({ placeId: DEFAULT_PLACE_ID, likeCount: state.likeCount, created: true }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === `/api/places/${DEFAULT_PLACE_ID}/like`) {
      state.likeCount = 0;
      send(200, success({ placeId: DEFAULT_PLACE_ID, likeCount: state.likeCount, deleted: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/photos") {
      const photos = [];
      const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : "";
      const previewOrigin = /^http:\/\/127\.0\.0\.1:\d+$/.test(requestOrigin) ? requestOrigin : url.origin;
      if (!state.photoDeleted) photos.push(workerPhoto(previewOrigin, state.photoClickCount));
      if (state.fieldReportPhotoUploaded) photos.push(fieldReportWorkerPhoto(url.origin));
      send(200, success(photos));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/photos/upload-ticket") {
      const body = await readJsonBody(request);
      if (
        body.placeId !== DEFAULT_PLACE_ID
        || body.mimeType !== "image/jpeg"
        || body.rightsAttested !== true
        || body.rightsPolicyVersion !== "photo-rights-2026-07-20-v1"
      ) {
        send(400, { success: false, error: { code: "PHOTO_UPLOAD_INPUT_INVALID", message: "사진 업로드 입력이 올바르지 않습니다." } });
        return;
      }
      send(201, success({
        uploadId: "upload-field-report-smoke",
        rightsPolicyVersion: body.rightsPolicyVersion,
        storageKey: "pending/field-report-smoke.jpg",
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/photos/upload") {
      await drainRequestBody(request);
      state.fieldReportPhotoUploaded = true;
      send(201, success({ photo: fieldReportWorkerPhoto(url.origin), storageKey: "approved/field-report-smoke.jpg" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/photos/photo-local-report-smoke/file") {
      response.writeHead(200, {
        "access-control-allow-origin": request.headers.origin ?? "*",
        "content-type": "image/jpeg",
      });
      response.end(Buffer.from(tinyJpegBase64, "base64"));
      return;
    }

    if (request.method === "GET" && url.pathname === `/api/photos/${FIELD_REPORT_SMOKE_PHOTO_ID}/file`) {
      response.writeHead(200, {
        "access-control-allow-origin": request.headers.origin ?? "*",
        "content-type": "image/jpeg",
      });
      response.end(Buffer.from(tinyJpegBase64, "base64"));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/photos/photo-local-report-smoke/click") {
      state.photoClickCount += 1;
      send(200, success({ photoId: "photo-local-report-smoke", clickCount: state.photoClickCount, created: true }));
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/photos/photo-local-report-smoke") {
      state.photoDeleted = true;
      send(200, success({ photoId: "photo-local-report-smoke", deleted: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/comments") {
      send(200, success(state.comments));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/comments") {
      const body = await readJsonBody(request);
      const comment = {
        id: `comment-local-report-smoke-${state.comments.length + 1}`,
        placeId: DEFAULT_PLACE_ID,
        body: String(body.body ?? "local report smoke comment"),
        likeCount: 0,
        createdAt: new Date().toISOString(),
      };
      state.comments.unshift(comment);
      send(201, success(comment));
      return;
    }

    const commentLikeMatch = url.pathname.match(/^\/api\/comments\/([^/]+)\/like$/);
    if (request.method === "POST" && commentLikeMatch) {
      const commentId = decodeURIComponent(commentLikeMatch[1]);
      const comment = state.comments.find((candidate) => candidate.id === commentId);
      if (!comment) {
        send(404, { success: false, error: { code: "COMMENT_NOT_FOUND", message: "댓글을 찾을 수 없습니다." } });
        return;
      }
      const likeKey = `${anonId}:${commentId}`;
      const created = !state.commentLikes.has(likeKey);
      if (created) {
        state.commentLikes.add(likeKey);
        comment.likeCount += 1;
      }
      send(200, success({ commentId, likeCount: comment.likeCount, created }));
      return;
    }

    const commentDeleteMatch = url.pathname.match(/^\/api\/comments\/([^/]+)$/);
    if (request.method === "DELETE" && commentDeleteMatch) {
      const commentId = decodeURIComponent(commentDeleteMatch[1]);
      state.comments = state.comments.filter((comment) => comment.id !== commentId);
      send(200, success({ commentId, deleted: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/moderation/reports") {
      const body = await readJsonBody(request);
      const targetType = String(body.targetType ?? "place");
      if (targetType === "place" || targetType === "comment" || targetType === "photo") {
        state.reportTargetTypes.push(targetType);
      }
      send(
        201,
        success({
          id: `report-local-${state.reportTargetTypes.length}`,
          targetType,
          targetId: String(body.targetId ?? DEFAULT_PLACE_ID),
          status: "open",
          createdAt: new Date().toISOString(),
        }),
      );
      return;
    }

    send(404, { success: false, error: { code: "NOT_FOUND", message: url.pathname } });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    accountDeletionEvidence: () => ({
      accountDeletionCount: state.accountDeletionCount,
      sessionIssueCount: state.sessionIssueCount,
      initialSessionId: state.initialSessionId,
      currentSessionId: state.currentSession?.anonymousId ?? null,
      remainingOwnedContentCount:
        state.comments.length
        + state.commentLikes.size
        + state.fieldReports.length
        + state.questions.length
        + state.placeRequests.length
        + (state.fieldReportPhotoUploaded ? 1 : 0)
        + (state.photoDeleted ? 0 : 1)
        + state.likeCount
        + state.preferences.savedPlaceIds.length
        + state.preferences.savedPostIds.length
        + state.preferences.followedTopicNames.length
        + (state.preferences.notificationEnabled ? 1 : 0),
    }),
    fieldReportCount: () => state.fieldReportCreationCount,
    latestFieldReportPublicationContract: () => state.fieldReportPublicationContracts.at(-1) ?? null,
    latestPlaceAdditionRequestContract: () => state.placeAdditionRequestContracts.at(-1) ?? null,
    placeRequestCreationCount: () => state.placeRequestCreationCount,
    reportTargetTypes: state.reportTargetTypes,
    sharedPostRequestCount: () => state.sharedPostRequestCount,
    hiddenPostRequestCount: () => state.hiddenPostRequestCount,
    apiCostGuardMutations: () => [...state.apiCostGuardMutations],
    photoCostGuardMutations: () => [...state.photoCostGuardMutations],
    url: `http://127.0.0.1:${address.port}`,
  };
}

function initialApiCostGuard() {
  return {
    control: {
      mode: "running",
      reason: "initial-enabled",
      generation: 1,
      automaticMetric: null,
      updatedBy: "migration",
      updatedAt: new Date().toISOString(),
    },
    dayUtc: "2026-07-20",
    usage: {
      workersRequests: 12_000,
      d1RowsRead: 900_000,
      d1RowsWritten: 8_000,
    },
    limits: {
      workersRequests: 100_000,
      d1RowsRead: 5_000_000,
      d1RowsWritten: 100_000,
      warnPercent: 60,
      degradePercent: 70,
      stopPercent: 80,
    },
    meters: {
      workersPercent: 12,
      d1ReadPercent: 18,
      d1WritePercent: 8,
    },
    reconciliationFresh: false,
  };
}

function initialPhotoCostGuard() {
  return {
    uploadsEnabled: true,
    readsEnabled: true,
    reason: null,
    activeBytes: 536_870_912,
    storageMaxBytes: 4_294_967_296,
    storageStopBytes: 3_435_973_836,
    storagePercent: 12.5,
    storageStopPercent: 80,
    periodUtc: "2026-07",
    writesInPeriod: 3_200,
    monthlyWriteLimit: 16_000,
    monthlyWriteStopLimit: 12_800,
    writePercent: 20,
    writeStopPercent: 80,
    transformPeriodUtc: "2026-07",
    transformsInPeriod: 1_250,
    monthlyTransformLimit: 5_000,
    monthlyTransformStopLimit: 4_000,
    transformPercent: 25,
    transformStopPercent: 80,
    readPeriodUtc: "2026-07",
    readsInPeriod: 250_000,
    monthlyReadLimit: 1_000_000,
    monthlyReadStopLimit: 800_000,
    readPercent: 25,
    readStopPercent: 80,
    dayUtc: "2026-07-19",
    readsInDay: 4_000,
    dailyReadLimit: 20_000,
    dailyReadStopLimit: 16_000,
    dailyReadPercent: 20,
    dailyReadStopPercent: 80,
    updatedAt: new Date().toISOString(),
  };
}

function fieldReportCategory(value) {
  const categories = ["tourism", "festival", "restaurant_cafe", "hospital", "public_office", "parking"];
  return fieldReportValue(value, categories, "tourism");
}

function fieldReportValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function workerPlace() {
  return {
    id: DEFAULT_PLACE_ID,
    name: DEFAULT_PLACE_NAME,
    categoryId: "tourism",
    areaId: "busan-suyeong",
    regionId: "busan",
    latitude: 35.1532,
    longitude: 129.1186,
    score: 94,
    status: "active",
    coordinateStatus: "verified",
  };
}

function workerPost() {
  return {
    id: "post-local-report-smoke",
    userId: "anon_local_report_smoke",
    creatorName: "브라우저 스모크",
    creatorBadge: "광안리 현장 제보",
    placeId: DEFAULT_PLACE_ID,
    caption: "스모크용 광안리 현장 feed입니다.",
    crowdLevel: "busy",
    parkingStatus: "limited",
    lineStatus: "short",
    weatherFeel: "good",
    locationVerified: true,
    verifiedRadiusM: 150,
    photoCount: 1,
    photoLabel: "광안리 현장 사진",
    helpfulCount: 3,
    commentCount: 1,
    hashtagNames: ["광안리주차", "부산", "지금"],
    hashtags: workerHashtags(),
    shareCard: {
      headline: `${DEFAULT_PLACE_NAME} 주의`,
      body: "사람 많음 · 주차 거의 없음 · 줄 짧음\n방금 전 현장 인증 제보\n스모크용 광안리 현장 feed입니다.",
      url: `https://silsigan.pages.dev/place/${DEFAULT_PLACE_ID}`,
      hashtags: ["광안리주차", "부산", "지금"],
      variant: "photo_spot",
    },
    judgement: "주의",
    safetyWarning: null,
    hiddenAt: null,
    createdAt: new Date().toISOString(),
  };
}

function workerHashtags() {
  return [
    { id: "hashtag_광안리주차", name: "광안리주차", tagType: "status", postCount: 1, createdAt: new Date().toISOString() },
    { id: "hashtag_부산", name: "부산", tagType: "region", postCount: 1, createdAt: new Date().toISOString() },
    { id: "hashtag_지금", name: "지금", tagType: "time", postCount: 1, createdAt: new Date().toISOString() },
  ];
}

function workerQuestion() {
  return {
    id: "question-local-report-smoke",
    placeId: DEFAULT_PLACE_ID,
    questionType: "parking",
    body: "광안리 주차 지금 가능한가요?",
    creditCost: 1,
    answeredReportId: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function workerPhoto(origin, clickCount) {
  return {
    id: "photo-local-report-smoke",
    placeId: DEFAULT_PLACE_ID,
    previewUrl: `${origin}/silsigan/fallback/gwangalli.png`,
    mimeType: "image/jpeg",
    byteSize: Buffer.from(tinyJpegBase64, "base64").byteLength,
    width: 1,
    height: 1,
    clickCount,
    ownedByCurrentSession: true,
    status: "ready",
    createdAt: "2026-06-22T00:00:00.000Z",
  };
}

function fieldReportWorkerPhoto(origin) {
  return {
    id: FIELD_REPORT_SMOKE_PHOTO_ID,
    placeId: DEFAULT_PLACE_ID,
    previewUrl: `${origin}/api/photos/${FIELD_REPORT_SMOKE_PHOTO_ID}/file`,
    mimeType: "image/jpeg",
    byteSize: Buffer.from(tinyJpegBase64, "base64").byteLength,
    width: 1,
    height: 1,
    clickCount: 0,
    ownedByCurrentSession: true,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function realtimeEvents(state, scope, roomId) {
  const events = [];
  if (state.likeCount > 0) {
    events.push({
      type: "place.liked",
      scope,
      roomId,
      createdAt: new Date().toISOString(),
      payload: { placeId: DEFAULT_PLACE_ID, regionId: DEFAULT_REGION_ID, likeCount: state.likeCount },
    });
  }
  for (const targetType of state.reportTargetTypes.slice(-3).toReversed()) {
    events.push({
      type: "report.created",
      scope,
      roomId,
      createdAt: new Date().toISOString(),
      payload: { placeId: DEFAULT_PLACE_ID, regionId: DEFAULT_REGION_ID, targetType },
    });
  }

  return events;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function drainRequestBody(request) {
  for await (const chunk of request) {
    void chunk;
  }
}

export async function waitForHttpOk(url, name, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new LocalSmokeError("HTTP_READY_TIMEOUT", `${name} did not return HTTP 2xx within ${timeoutMs}ms`);
}

export async function findFreePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));

  return address.port;
}

function validAnonId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-pages-local-report-smoke.mjs [--artifact-dir=artifacts/cloudflare-pages-smoke-worker-report-local]

Starts a local mock Worker API and local Next dev server, then runs:
  scripts/cloudflare-pages-smoke.mjs --mutating --report --require-photo --share-post-id=post-local-report-smoke

Options:
  --artifact-dir=<path>
  --pages-port=<port>
  --worker-port=<port>
  --timeout-ms=<ms>
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

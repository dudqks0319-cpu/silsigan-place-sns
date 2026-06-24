#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PLACE_ID = "busan-gwangalli";
const DEFAULT_PLACE_NAME = "광안리해수욕장";
const DEFAULT_REGION_ID = "busan";
const DEFAULT_ARTIFACT_DIR = "artifacts/cloudflare-pages-smoke-worker-report-local";
const requiredSmokeCheckNames = [
  "map.controlsUncovered",
  "map.trafficButton",
  "map.filterButton",
  "map.requeryButton",
  "bottomNav.home",
  "onboarding.dismiss",
  "bottomNav.map",
  "rankings.visible",
  "rankings.detail",
  "place.detail",
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
  "fieldReports.create",
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
  const worker = await startMockWorker(config.workerPort);
  const nextPort = config.pagesPort || (await findFreePort());
  const pagesUrl = `http://127.0.0.1:${nextPort}`;
  let nextDev = null;

  try {
    nextDev = startNextDev(nextPort, worker.url);
    await waitForHttpOk(pagesUrl, "next.dev", config.timeoutMs);
    const smoke = await runPagesSmoke({
      apiBaseUrl: worker.url,
      artifactDir: config.artifactDir,
      pagesUrl,
      timeoutMs: config.timeoutMs,
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
    const networkArtifactRedaction = await validateNetworkArtifactRedaction(smoke.artifacts?.network, {
      requiredReportTargetTypes: requiredTargetTypes,
    });
    const smokeCheckIntegrity = validateSmokeCheckIntegrity(smoke.checks, {
      requiredCheckNames: requiredSmokeCheckNames,
    });

    const summary = {
      ok: true,
      pagesUrl,
      apiBaseUrl: worker.url,
      reportTargetTypes,
      fieldReportCount: worker.fieldReportCount(),
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

async function runPagesSmoke({ apiBaseUrl, artifactDir, pagesUrl, timeoutMs }) {
  const { stdout, stderr, code } = await execNodeScript("scripts/cloudflare-pages-smoke.mjs", [
    `--pages-url=${pagesUrl}`,
    `--api-base-url=${apiBaseUrl}`,
    `--artifact-dir=${artifactDir}`,
    `--timeout-ms=${timeoutMs}`,
    "--mutating",
    "--report",
    "--require-photo",
  ]);
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

function startNextDev(port, apiBaseUrl) {
  const child = spawn("pnpm", ["dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL: apiBaseUrl,
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

  return { child, stderr: () => stderr, stdout: () => stdout };
}

async function stopNextDev(nextDev) {
  if (!nextDev || nextDev.child.exitCode !== null || nextDev.child.signalCode !== null) {
    return;
  }

  nextDev.child.kill("SIGTERM");
  await Promise.race([
    once(nextDev.child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (nextDev.child.exitCode === null && nextDev.child.signalCode === null) {
    nextDev.child.kill("SIGKILL");
  }
}

async function execNodeScript(scriptPath, args) {
  const child = spawn(process.execPath, [join(process.cwd(), scriptPath), ...args], {
    env: {
      ...process.env,
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

async function startMockWorker(port) {
  const state = {
    comments: [],
    commentLikes: new Set(),
    fieldReports: [],
    likeCount: 0,
    photoClickCount: 3,
    photoDeleted: false,
    reportTargetTypes: [],
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const anonId = validAnonId(request.headers["x-silsigan-anon-id"]) ? String(request.headers["x-silsigan-anon-id"]) : "anon_local_report_smoke";
    const send = (status, payload, headers = {}) => {
      response.writeHead(status, {
        "access-control-allow-headers": "content-type,x-silsigan-anon-id,x-silsigan-admin-token",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-origin": request.headers.origin ?? "*",
        "access-control-expose-headers": "x-silsigan-anon-id",
        "content-type": "application/json",
        "x-silsigan-anon-id": anonId,
        ...headers,
      });
      response.end(JSON.stringify(payload));
    };
    const success = (data, meta = {}) => ({ success: true, data, meta });

    if (request.method === "OPTIONS") {
      send(204, {});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(200, success({ ok: true, service: "local-pages-report-smoke", storage: "memory" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/places") {
      send(200, success([workerPlace()]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/reports") {
      send(200, success(state.fieldReports));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reports") {
      const body = await readJsonBody(request);
      const now = new Date();
      const report = {
        id: `field-report-local-${state.fieldReports.length + 1}`,
        placeId: String(body.placeId ?? DEFAULT_PLACE_ID),
        category: fieldReportCategory(body.category),
        crowdLevel: fieldReportValue(body.crowdLevel, ["quiet", "normal", "busy", "packed"], "busy"),
        lineStatus: fieldReportValue(body.lineStatus, ["none", "short", "medium", "long"], "short"),
        parkingStatus: fieldReportValue(body.parkingStatus, ["available", "limited", "full", "unknown"], "limited"),
        verifiedRadiusM: null,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      };
      state.fieldReports.unshift(report);
      send(
        201,
        success({
          report,
          credits: [{ reason: "status_report", amount: 1 }],
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
      send(200, success(state.photoDeleted ? [] : [workerPhoto(url.origin, state.photoClickCount)]));
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
    fieldReportCount: () => state.fieldReports.length,
    reportTargetTypes: state.reportTargetTypes,
    url: `http://127.0.0.1:${address.port}`,
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

function workerPhoto(origin, clickCount) {
  return {
    id: "photo-local-report-smoke",
    placeId: DEFAULT_PLACE_ID,
    previewUrl: `${origin}/api/photos/photo-local-report-smoke/file`,
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

async function waitForHttpOk(url, name, timeoutMs) {
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

async function findFreePort() {
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
  scripts/cloudflare-pages-smoke.mjs --mutating --report --require-photo

Options:
  --artifact-dir=<path>
  --pages-port=<port>
  --worker-port=<port>
  --timeout-ms=<ms>
`);
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"));
}

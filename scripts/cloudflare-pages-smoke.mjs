#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PLACE_ID = "busan-gwangalli";
const DEFAULT_PLACE_NAME = "광안리해수욕장";
const DEFAULT_REGION_ID = "busan";
const DEFAULT_TIMEOUT_MS = 20_000;
const anonymousSessionKey = "silsigan.anonymousSession.v2";
const fieldReportScreenshotCopy = "주차장 입구는 지금 차량이 많지만 회전은 빠른 편이에요.";
const fieldReportPhotoBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z";

class SmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmokeError";
    this.code = code;
  }
}

export class CdpClient {
  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.socket.addEventListener("message", (message) => this.handleMessage(message));
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  close() {
    this.socket.close();
  }

  handleMessage(message) {
    const payload = JSON.parse(message.data);
    if (payload.id) {
      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }

      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message ?? "CDP command failed"));
      } else {
        pending.resolve(payload.result ?? {});
      }
      return;
    }

    for (const handler of this.handlers.get(payload.method) ?? []) {
      handler(payload.params ?? {});
    }
  }
}

if (isCliEntryPoint()) {
  await main();
}

export function parseArgs(rawArgs) {
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

export function sanitizeUrl(value) {
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

export function validateLocalAdminCostGuardTarget(pagesUrl, adminToken) {
  if (!adminToken) {
    throw new SmokeError("LOCAL_ADMIN_TOKEN_REQUIRED", "로컬 관리자 비용 방어 smoke에는 임시 관리자 토큰이 필요합니다.");
  }

  if (!pagesUrl || !["127.0.0.1", "localhost", "::1"].includes(pagesUrl.hostname)) {
    throw new SmokeError("LOCAL_ADMIN_LOOPBACK_REQUIRED", "관리자 비용 방어 smoke는 실서비스 상태를 바꾸지 않도록 loopback Pages URL에서만 실행할 수 있습니다.");
  }

  return true;
}

export function validateLocalAccountDeletionTarget(pagesUrl, mutating, apiBaseUrl = pagesUrl) {
  if (!mutating) {
    throw new SmokeError("LOCAL_ACCOUNT_DELETION_MUTATION_REQUIRED", "계정 삭제 smoke는 --mutating과 함께 실행해야 합니다.");
  }

  if (!pagesUrl || !["127.0.0.1", "localhost", "::1"].includes(pagesUrl.hostname)) {
    throw new SmokeError("LOCAL_ACCOUNT_DELETION_LOOPBACK_REQUIRED", "계정 삭제 smoke는 실제 사용자 데이터를 지우지 않도록 loopback Pages URL에서만 실행할 수 있습니다.");
  }
  if (!apiBaseUrl || !["127.0.0.1", "localhost", "::1"].includes(apiBaseUrl.hostname)) {
    throw new SmokeError("LOCAL_ACCOUNT_DELETION_API_LOOPBACK_REQUIRED", "계정 삭제 smoke의 API도 실데이터에 접근하지 않는 loopback URL이어야 합니다.");
  }

  return true;
}

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const checks = [];
  const artifacts = {};
  const diagnostics = {
    client: null,
    networkEvents: [],
    consoleMessages: [],
  };
  const config = resolveConfig(flags, options, process.env);
  let cleanup = async () => {};

  try {
    const pagesUrl = requiredUrl(config.pagesUrlInput, "PAGES_URL_REQUIRED", "SILSIGAN_STAGING_PAGES_URL 또는 --pages-url 이 필요합니다.");
    const apiBaseUrl = config.apiBaseUrlInput ? requiredUrl(config.apiBaseUrlInput, "API_BASE_URL_INVALID", "Worker API base URL 형식이 올바르지 않습니다.") : null;

    if (config.mutating && !apiBaseUrl) {
      throw new SmokeError("API_BASE_URL_REQUIRED", "--mutating 실행에는 SILSIGAN_STAGING_API_BASE_URL 또는 --api-base-url 이 필요합니다.");
    }
    if (config.report && !config.mutating) {
      throw new SmokeError("BROWSER_REPORT_REQUIRES_MUTATION", "--report 실행에는 --mutating 또는 SILSIGAN_STAGING_BROWSER_MUTATION=1 이 필요합니다.");
    }
    if (config.localAdminCostGuard) {
      validateLocalAdminCostGuardTarget(pagesUrl, config.localAdminToken);
    }
    if (config.accountDeletion) {
      validateLocalAccountDeletionTarget(pagesUrl, config.mutating, apiBaseUrl);
    }

    await mkdir(config.artifactDir, { recursive: true });
    const browser = await launchChrome(config.chromePath);
    cleanup = browser.cleanup;
    diagnostics.client = browser.client;
    record(checks, "browser.launch", "pass", "headless Chrome DevTools 세션을 열었습니다.");

    const result = await runBrowserSmoke(browser.client, {
      pagesUrl,
      apiBaseUrl,
      placeId: config.placeId,
      placeName: config.placeName,
      regionId: config.regionId,
      sharePostId: config.sharePostId,
      mutating: config.mutating,
      report: config.report,
      requirePhoto: config.requirePhoto,
      fieldReportPhoto: config.fieldReportPhoto,
      localAdminCostGuard: config.localAdminCostGuard,
      accountDeletion: config.accountDeletion,
      localAdminToken: config.localAdminToken,
      timeoutMs: config.timeoutMs,
      checks,
      diagnostics,
    });

    const artifactTimestamp = Date.now();
    const homeScreenshotPath = join(config.artifactDir, `pages-smoke-home-${artifactTimestamp}.png`);
    await writeFile(homeScreenshotPath, Buffer.from(result.homeScreenshotBase64, "base64"));
    artifacts.homeScreenshot = homeScreenshotPath;

    const mapScreenshotPath = join(config.artifactDir, `pages-smoke-map-${artifactTimestamp}.png`);
    await writeFile(mapScreenshotPath, Buffer.from(result.mapScreenshotBase64, "base64"));
    artifacts.mapScreenshot = mapScreenshotPath;

    if (result.placeScreenshotBase64) {
      const placeScreenshotPath = join(config.artifactDir, `pages-smoke-place-${artifactTimestamp}.png`);
      await writeFile(placeScreenshotPath, Buffer.from(result.placeScreenshotBase64, "base64"));
      artifacts.placeScreenshot = placeScreenshotPath;
    }

    const myScreenshotPath = join(config.artifactDir, `pages-smoke-my-${artifactTimestamp}.png`);
    await writeFile(myScreenshotPath, Buffer.from(result.myScreenshotBase64, "base64"));
    artifacts.myScreenshot = myScreenshotPath;

    const screenshotPath = join(config.artifactDir, `pages-smoke-${artifactTimestamp}.png`);
    await writeFile(screenshotPath, Buffer.from(result.screenshotBase64, "base64"));
    artifacts.screenshot = screenshotPath;

    if (result.hashtagScreenshotBase64) {
      const hashtagScreenshotPath = join(config.artifactDir, `pages-smoke-hashtag-${artifactTimestamp}.png`);
      await writeFile(hashtagScreenshotPath, Buffer.from(result.hashtagScreenshotBase64, "base64"));
      artifacts.hashtagScreenshot = hashtagScreenshotPath;
    }

    if (result.accountDeletionScreenshotBase64) {
      const accountDeletionScreenshotPath = join(config.artifactDir, `pages-smoke-account-deletion-${artifactTimestamp}.png`);
      await writeFile(accountDeletionScreenshotPath, Buffer.from(result.accountDeletionScreenshotBase64, "base64"));
      artifacts.accountDeletionScreenshot = accountDeletionScreenshotPath;
    }

    if (result.adminApiCostGuardStoppedScreenshotBase64) {
      const adminApiCostGuardStoppedPath = join(config.artifactDir, `pages-smoke-admin-api-cost-guard-stopped-${artifactTimestamp}.png`);
      await writeFile(adminApiCostGuardStoppedPath, Buffer.from(result.adminApiCostGuardStoppedScreenshotBase64, "base64"));
      artifacts.adminApiCostGuardStoppedScreenshot = adminApiCostGuardStoppedPath;
    }

    if (result.adminApiCostGuardRunningScreenshotBase64) {
      const adminApiCostGuardRunningPath = join(config.artifactDir, `pages-smoke-admin-api-cost-guard-running-${artifactTimestamp}.png`);
      await writeFile(adminApiCostGuardRunningPath, Buffer.from(result.adminApiCostGuardRunningScreenshotBase64, "base64"));
      artifacts.adminApiCostGuardRunningScreenshot = adminApiCostGuardRunningPath;
    }

    if (result.adminCostGuardStoppedScreenshotBase64) {
      const adminCostGuardStoppedPath = join(config.artifactDir, `pages-smoke-admin-cost-guard-stopped-${artifactTimestamp}.png`);
      await writeFile(adminCostGuardStoppedPath, Buffer.from(result.adminCostGuardStoppedScreenshotBase64, "base64"));
      artifacts.adminCostGuardStoppedScreenshot = adminCostGuardStoppedPath;
    }

    if (result.adminCostGuardRunningScreenshotBase64) {
      const adminCostGuardRunningPath = join(config.artifactDir, `pages-smoke-admin-cost-guard-running-${artifactTimestamp}.png`);
      await writeFile(adminCostGuardRunningPath, Buffer.from(result.adminCostGuardRunningScreenshotBase64, "base64"));
      artifacts.adminCostGuardRunningScreenshot = adminCostGuardRunningPath;
    }

    const networkPath = join(config.artifactDir, `pages-smoke-network-${artifactTimestamp}.json`);
    await writeFile(networkPath, JSON.stringify(result.networkEvents, null, 2), "utf8");
    artifacts.network = networkPath;

    const consolePath = join(config.artifactDir, `pages-smoke-console-${artifactTimestamp}.log`);
    await writeFile(consolePath, result.consoleMessages.join("\n"), "utf8");
    artifacts.console = consolePath;
  } catch (error) {
    record(checks, "harness", "fail", publicErrorMessage(error));
    try {
      await writeFailureArtifacts(config.artifactDir, diagnostics, artifacts);
    } catch (artifactError) {
      record(checks, "harness.failureArtifacts", "fail", publicErrorMessage(artifactError));
    }
  } finally {
    try {
      await cleanup();
    } catch (error) {
      record(checks, "browser.cleanup", "fail", publicErrorMessage(error));
    }
  }

  const failed = checks.filter((check) => check.status === "fail");
  const summary = {
    ok: failed.length === 0,
    pagesUrl: sanitizeUrl(config.pagesUrlInput),
    apiBaseUrl: sanitizeUrl(config.apiBaseUrlInput),
    mutating: config.mutating,
    checks,
    artifacts,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function resolveConfig(flags, options, env) {
  return {
    pagesUrlInput: options.get("pages-url") ?? env.SILSIGAN_STAGING_PAGES_URL,
    apiBaseUrlInput: options.get("api-base-url") ?? env.SILSIGAN_STAGING_API_BASE_URL ?? env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL,
    artifactDir: options.get("artifact-dir") ?? env.SILSIGAN_STAGING_BROWSER_ARTIFACT_DIR ?? "artifacts/cloudflare-pages-smoke",
    chromePath: options.get("chrome-path") ?? env.SILSIGAN_CHROME_PATH,
    placeId: options.get("place-id") ?? env.SILSIGAN_STAGING_BROWSER_PLACE_ID ?? DEFAULT_PLACE_ID,
    placeName: options.get("place-name") ?? env.SILSIGAN_STAGING_BROWSER_PLACE_NAME ?? DEFAULT_PLACE_NAME,
    regionId: options.get("region-id") ?? env.SILSIGAN_STAGING_BROWSER_REGION_ID ?? DEFAULT_REGION_ID,
    sharePostId: options.get("share-post-id") ?? env.SILSIGAN_STAGING_BROWSER_SHARE_POST_ID ?? "",
    timeoutMs: numberOption(options.get("timeout-ms") ?? env.SILSIGAN_STAGING_BROWSER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    mutating: flags.has("mutating") || env.SILSIGAN_STAGING_BROWSER_MUTATION === "1",
    report: flags.has("report") || env.SILSIGAN_STAGING_BROWSER_REPORT === "1",
    requirePhoto: flags.has("require-photo") || env.SILSIGAN_STAGING_BROWSER_REQUIRE_PHOTO === "1",
    fieldReportPhoto: flags.has("field-report-photo"),
    localAdminCostGuard: flags.has("local-admin-cost-guard"),
    accountDeletion: flags.has("account-deletion"),
    localAdminToken: env.SILSIGAN_LOCAL_ADMIN_SMOKE_TOKEN ?? "",
  };
}

async function runBrowserSmoke(client, config) {
  const networkEvents = config.diagnostics?.networkEvents ?? [];
  const consoleMessages = config.diagnostics?.consoleMessages ?? [];
  let hashtagScreenshotBase64 = null;
  let placeScreenshotBase64 = null;
  let adminApiCostGuardStoppedScreenshotBase64 = null;
  let adminApiCostGuardRunningScreenshotBase64 = null;
  let adminCostGuardStoppedScreenshotBase64 = null;
  let adminCostGuardRunningScreenshotBase64 = null;
  let accountDeletionScreenshotBase64 = null;

  client.on("Network.requestWillBeSent", (event) => {
    const requestEvent = {
      type: "request",
      method: event.request?.method,
      url: event.request?.url,
    };
    const reportTargetType = moderationReportTargetType(event.request?.url, event.request?.method, event.request?.postData);
    if (reportTargetType) {
      requestEvent.reportTargetType = reportTargetType;
    }
    if (isFieldReportRequest(event.request?.url, event.request?.method)) {
      requestEvent.fieldReport = true;
    }
    networkEvents.push(requestEvent);
  });
  client.on("Network.responseReceived", (event) => {
    networkEvents.push({
      type: "response",
      status: event.response?.status,
      url: event.response?.url,
    });
  });
  client.on("Runtime.consoleAPICalled", (event) => {
    consoleMessages.push(`console.${event.type}: ${event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? ""}`);
  });
  client.on("Log.entryAdded", (event) => {
    consoleMessages.push(`log.${event.entry?.level}: ${event.entry?.text ?? ""}`);
  });

  await client.send("Network.enable", { maxPostDataSize: 8_192 });
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await client.send("Page.navigate", { url: config.pagesUrl.toString() });
  await waitFor(() => hasResponse(networkEvents, config.pagesUrl.origin), "pages.load", config.timeoutMs);
  record(config.checks, "pages.load", "pass", "Pages 프론트 첫 응답을 브라우저에서 확인했습니다.", { origin: config.pagesUrl.origin });

  await waitForEvaluate(client, "Boolean(document.querySelector('[aria-label=\"#실시간 앱 프론트엔드 디자인\"]'))", "app.canvas", config.timeoutMs);
  if (config.apiBaseUrl) {
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/places"), "app.hydrated", config.timeoutMs);
  } else {
    await waitForEvaluate(client, "document.readyState === 'complete'", "app.hydrated", config.timeoutMs);
    await delay(250);
  }
  await clickTextButton(client, "바로 둘러보기").catch(() => {});
  await waitForEvaluate(client, `!document.querySelector('[aria-label="#실시간 첫 방문 안내"]')`, "onboarding.initialDismiss", config.timeoutMs);
  record(config.checks, "onboarding.dismiss", "pass", "첫 방문 안내를 닫고 V2 홈에서 지도로 이동할 준비를 마쳤습니다.");
  await resetWindowScroll(client);
  const homeScreenshot = await captureViewportScreenshot(client);
  await clickBottomNavButton(client, "지도");
  await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '지도'`, "bottomNav.mapInitial", config.timeoutMs);
  await waitForEvaluate(
    client,
    "Boolean(document.querySelector('[aria-label=\"클릭 가능한 전국 실시간 장소 지도\"], [aria-label=\"네이버 지도 기반 전국 실시간 장소 지도\"]'))",
    "map.surface",
    config.timeoutMs,
  );
  record(config.checks, "map.surface", "pass", "지도 surface가 렌더링됐습니다.");
  const mapSurfaceState = await assertMapSurfaceVisible(client, config.timeoutMs, !config.apiBaseUrl);
  record(config.checks, "map.visible", "pass", "지도 surface 크기와 내부 콘텐츠를 확인했습니다.", { state: mapSurfaceState });
  const mapScreenshot = await captureViewportScreenshot(client);
  const myScreenshot = await runMapControlChecks(client, config);

  if (config.apiBaseUrl) {
    await waitFor(
      () => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/preferences", "POST"),
      "preferences.sync",
      config.timeoutMs,
    );
    record(config.checks, "preferences.sync", "pass", "알림 설정이 사용자 화면에 내부 API 경로를 노출하지 않고 Worker 환경설정으로 동기화됐습니다.");
  }

  if (config.apiBaseUrl) {
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/places"), "worker.placesRequest", config.timeoutMs);
    record(config.checks, "worker.placesRequest", "pass", "프론트 장소 목록이 Worker API base로 요청됐습니다.", { path: "/api/places" });
    const placeSearchQuery = config.placeName.slice(0, 3);
    await fillSearchInput(client, "지도 장소 검색", placeSearchQuery);
    await waitFor(
      () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/places", "GET", "q", placeSearchQuery),
      "worker.placesSearchRequest",
      config.timeoutMs,
    );
    record(config.checks, "worker.placesSearchRequest", "pass", "지도 검색어가 Worker 장소 목록 q 파라미터로 전달됐습니다.", { q: placeSearchQuery });
    await waitFor(
      () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/photos", "GET", "placeId", config.placeId),
      "worker.photosPlaceScope",
      config.timeoutMs,
    );
    record(config.checks, "worker.photosPlaceScope", "pass", "프론트 사진 목록이 Worker API base로 장소별 요청됐습니다.", { placeId: config.placeId });
  }

  if (mapSurfaceState === "empty") {
    record(config.checks, "map.noDataRecovery", "pass", "API가 없는 staging에서 가짜 장소 대신 명시적 무데이터 상태와 지도 재시도 행동을 확인했습니다.");
    record(config.checks, "rankings.visible", "skip", "Worker API가 없어 가짜 TOP 10을 렌더링하지 않습니다.");
    record(config.checks, "rankings.detail", "skip", "Worker API가 없어 가짜 랭킹 상세를 열지 않습니다.");
    record(config.checks, "place.detail", "skip", "Worker API가 없어 가짜 지도 마커 상세를 열지 않습니다.");
  } else if (!config.apiBaseUrl) {
    await assertRankingPanelsVisible(client, config, true);
    record(config.checks, "rankings.visible", "pass", "정적 디렉터리에서 최신 근거 없는 장소를 가짜 TOP 10으로 만들지 않았습니다.");
    record(config.checks, "rankings.detail", "skip", "최신 근거가 없어 정적 디렉터리 랭킹 상세를 열지 않습니다.");
    record(config.checks, "place.detail", "skip", "Worker API가 없어 정적 장소 상세의 실시간 근거를 만들지 않습니다.");
  } else {
    await assertRankingPanelsVisible(client, config);
    record(config.checks, "rankings.visible", "pass", "전국 또는 현재 지도 범위의 최신 근거 TOP 10 랭킹 패널이 렌더링됐습니다.");
    await clickRankingPlace(client, config.placeName);
    await waitForEvaluate(client, `Boolean(document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)}))`, "rankings.detail", config.timeoutMs);
    record(config.checks, "rankings.detail", "pass", "랭킹 항목 클릭으로 장소 상세 시트를 브라우저에서 열었습니다.", { placeName: config.placeName });
    await clickAriaButton(client, "상세 닫기");
    await waitForEvaluate(client, `!document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)})`, "rankings.detailClose", config.timeoutMs);

    await clickMapMarker(client, config.placeName, config.timeoutMs);
    await waitForEvaluate(client, `Boolean(document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)}))`, "place.detail", config.timeoutMs);
    record(config.checks, "place.detail", "pass", "지도 마커 클릭으로 장소 상세 시트를 브라우저에서 열었습니다.", { placeName: config.placeName });
    await waitForEvaluate(client, `!document.querySelector('[role="status"]')`, "place.toastSettled", config.timeoutMs);
    await evaluate(
      client,
      `(() => {
        const detail = document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)});
        if (!(detail instanceof HTMLElement)) return false;
        detail.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
        return true;
      })()`,
    );
    await resetWindowScroll(client);
    await delay(250);
    const placeScreenshot = await captureViewportScreenshot(client);
    placeScreenshotBase64 = placeScreenshot.data;

    if (config.apiBaseUrl) {
      await waitFor(
        () => hasApiRequest(networkEvents, config.apiBaseUrl, `/api/places/${encodeURIComponent(config.placeId)}/click`, "POST"),
        "worker.placeClick",
        config.timeoutMs,
      );
      record(config.checks, "worker.placeClick", "pass", "지도 마커 클릭이 Worker 장소 클릭 집계로 POST 됐습니다.", { placeId: config.placeId });
      await waitFor(
        () => hasApiRequest(networkEvents, config.apiBaseUrl, `/api/realtime/place/${encodeURIComponent(config.placeId)}`),
        "worker.realtimePlaceRoom",
        config.timeoutMs,
      );
      record(config.checks, "worker.realtimePlaceRoom", "pass", "장소 상세/미리보기 진입 후 Worker realtime place room을 조회했습니다.", { placeId: config.placeId });
      await fetchRealtimeRoomFromBrowser(client, config, "region", config.regionId);
      await waitFor(
        () => hasApiRequest(networkEvents, config.apiBaseUrl, `/api/realtime/region/${encodeURIComponent(config.regionId)}`),
        "worker.realtimeRegionRoom",
        config.timeoutMs,
      );
      record(config.checks, "worker.realtimeRegionRoom", "pass", "브라우저에서 Worker realtime region room을 조회했습니다.", { regionId: config.regionId });
      await fetchRealtimeRoomFromBrowser(client, config, "global", "global");
      await waitFor(
        () => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/realtime/global"),
        "worker.realtimeGlobalRoom",
        config.timeoutMs,
      );
      record(config.checks, "worker.realtimeGlobalRoom", "pass", "브라우저에서 Worker realtime global room을 조회했습니다.");
    }
  }

  if (config.mutating && config.apiBaseUrl) {
    hashtagScreenshotBase64 = await runMutatingBrowserChecks(client, config, networkEvents);
  } else {
    record(config.checks, "browser.mutation", "skip", "--mutating 또는 SILSIGAN_STAGING_BROWSER_MUTATION=1 이 없어 쓰기 UI smoke를 건너뜁니다.");
  }

  if (config.sharePostId) {
    await runSharePostChecks(client, config, networkEvents);
  } else {
    record(config.checks, "share.postPage", "skip", "--share-post-id 또는 SILSIGAN_STAGING_BROWSER_SHARE_POST_ID가 없어 공유 페이지 smoke를 건너뜁니다.");
    record(config.checks, "share.opengraphImage", "skip", "--share-post-id 또는 SILSIGAN_STAGING_BROWSER_SHARE_POST_ID가 없어 OG 이미지 smoke를 건너뜁니다.");
  }

  if (config.accountDeletion) {
    accountDeletionScreenshotBase64 = await runAccountDeletionChecks(client, config, networkEvents);
  }

  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });

  if (config.localAdminCostGuard) {
    const adminResult = await runLocalAdminCostGuardChecks(client, config, networkEvents);
    adminApiCostGuardStoppedScreenshotBase64 = adminResult.apiStoppedScreenshotBase64;
    adminApiCostGuardRunningScreenshotBase64 = adminResult.apiRunningScreenshotBase64;
    adminCostGuardStoppedScreenshotBase64 = adminResult.stoppedScreenshotBase64;
    adminCostGuardRunningScreenshotBase64 = adminResult.runningScreenshotBase64;
  }

  return {
    homeScreenshotBase64: homeScreenshot.data,
    mapScreenshotBase64: mapScreenshot.data,
    placeScreenshotBase64,
    myScreenshotBase64: myScreenshot.data,
    hashtagScreenshotBase64,
    accountDeletionScreenshotBase64,
    screenshotBase64: screenshot.data,
    adminApiCostGuardStoppedScreenshotBase64,
    adminApiCostGuardRunningScreenshotBase64,
    adminCostGuardStoppedScreenshotBase64,
    adminCostGuardRunningScreenshotBase64,
    networkEvents,
    consoleMessages,
  };
}

async function runLocalAdminCostGuardChecks(client, config, networkEvents) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loginUrl = new URL("/admin/login", config.pagesUrl);
  await client.send("Page.navigate", { url: loginUrl.toString() });
  await waitForEvaluate(client, `location.pathname === ${JSON.stringify(loginUrl.pathname)}`, "admin.loginPage", config.timeoutMs);
  await waitForEvaluate(client, "Boolean(document.querySelector('input[name=\"token\"]'))", "admin.loginInput", config.timeoutMs);
  const loginResult = await evaluate(
    client,
    `(async () => {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token: ${JSON.stringify(config.localAdminToken)} }),
      });
      return { ok: response.ok, status: response.status };
    })()`,
  );
  if (!loginResult?.ok) {
    throw new SmokeError("ADMIN_LOGIN_FAILED", `로컬 관리자 인증 API가 ${loginResult?.status ?? "unknown"} 응답을 반환했습니다.`);
  }
  await client.send("Page.navigate", { url: new URL("/admin/moderation/posts", config.pagesUrl).toString() });
  await waitForEvaluate(client, "location.pathname === '/admin/moderation/posts'", "admin.loginSession", config.timeoutMs);
  await waitForEvaluate(client, "document.querySelector('h1')?.textContent?.includes('Worker 신고 큐와 게시물 검토')", "admin.queuePage", config.timeoutMs);
  record(config.checks, "admin.login", "pass", "임시 런타임 토큰으로 로컬 관리자 로그인과 HttpOnly 세션 전환을 확인했습니다.");

  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#beta-kpi-heading')?.closest('section');
      if (!(panel instanceof HTMLElement)) return false;
      const text = panel.innerText;
      return text.includes('출시 판단 KPI')
        && text.includes('제보 완료 중앙값')
        && text.includes('12.4초')
        && text.includes('지도 성공률')
        && text.includes('99.5%')
        && text.includes('집중 장소 최신 정보')
        && text.includes('Tier A 최신 정보')
        && text.includes('Tier B 최신 정보')
        && text.includes('75%')
        && text.includes('50%')
        && text.includes('사용자 식별값과 이벤트 원문은 내려받지 않으며');
    })()`,
    "admin.kpis.aggregateOnly",
    config.timeoutMs,
  );
  record(config.checks, "admin.kpis.aggregateOnly", "pass", "관리자 화면이 사용자 원문 없이 7일 베타 KPI와 출시 기준을 표시했습니다.", {
    windowDays: 7,
    aggregateFreshCoveragePercent: 60,
    tierAFreshCoveragePercent: 75,
    tierBFreshCoveragePercent: 50,
    mapSuccessPercent: 99.5,
  });

  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#api-cost-guard-heading')?.closest('section');
      if (!(panel instanceof HTMLElement)) return false;
      const labels = [...panel.querySelectorAll('[aria-label*="무료 상한 대비"]')];
      const text = panel.innerText;
      return labels.length === 3
        && text.includes('Workers · D1 전역 비용 보호')
        && text.includes('60% 경고 · 70% 축소 · 80% 중단')
        && text.includes('Cloudflare WAF')
        && text.includes('보호 작동 중');
    })()`,
    "admin.apiCostGuard.threeMeters",
    config.timeoutMs,
  );
  record(config.checks, "admin.apiCostGuard.threeMeters", "pass", "Workers/D1 세 미터와 60% 경고·70% 축소·80% 중단 정책을 관리자 화면에서 확인했습니다.", {
    meterCount: 3,
    warningPercent: 60,
    degradePercent: 70,
    stopPercent: 80,
  });

  const apiStopPatchCount = countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "PATCH");
  await fillLabeledInput(client, "api-cost-guard-heading", "운영 사유 또는 대조 메모", "local global attack stop", "전역 비용 보호 중단 사유");
  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#api-cost-guard-heading')?.closest('section');
      const button = [...(panel?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === '비필수 API 즉시 중단');
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`,
    "admin.apiCostGuard.stopEnabled",
    config.timeoutMs,
  );
  await clickHitTestedTextButton(client, "비필수 API 즉시 중단", { exact: true });
  await waitFor(
    () => countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "PATCH") > apiStopPatchCount,
    "admin.apiCostGuard.stopRequest",
    config.timeoutMs,
  );
  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#api-cost-guard-heading')?.closest('section');
      return panel instanceof HTMLElement
        && panel.innerText.includes('API 중단')
        && panel.innerText.includes('비필수 API를 중단했고 감사 기록을 남겼습니다.');
    })()`,
    "admin.apiCostGuard.stoppedState",
    config.timeoutMs,
  );
  record(config.checks, "admin.apiCostGuard.stop", "pass", "브라우저의 즉시 중단이 same-origin 관리자 경계를 거쳐 전역 API guard의 감사된 stopped 상태를 만들었습니다.");
  await evaluate(client, "document.querySelector('#api-cost-guard-heading')?.scrollIntoView({ block: 'start' })");
  const apiStoppedScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });

  const apiResumePatchCount = countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "PATCH");
  const apiReconcilePostCount = countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "POST");
  await fillLabeledInput(client, "api-cost-guard-heading", "운영 사유 또는 대조 메모", "local global safe resume", "전역 비용 보호 재개 사유");
  await fillLabeledInput(client, "api-cost-guard-heading", "Workers 요청", "1000", "Workers 대조값");
  await fillLabeledInput(client, "api-cost-guard-heading", "D1 rows read", "10000", "D1 read 대조값");
  await fillLabeledInput(client, "api-cost-guard-heading", "D1 rows written", "1000", "D1 write 대조값");
  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#api-cost-guard-heading')?.closest('section');
      const button = [...(panel?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent?.trim() === '사용량 대조 후 재개');
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`,
    "admin.apiCostGuard.resumeEnabled",
    config.timeoutMs,
  );
  await clickHitTestedTextButton(client, "사용량 대조 후 재개", { exact: true });
  await waitFor(
    () => countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "POST") > apiReconcilePostCount,
    "admin.apiCostGuard.reconcileRequest",
    config.timeoutMs,
  );
  await waitFor(
    () => countApiRequests(networkEvents, config.pagesUrl, "/api/admin/api-cost-guard", "PATCH") > apiResumePatchCount,
    "admin.apiCostGuard.resumeRequest",
    config.timeoutMs,
  );
  await waitForEvaluate(
    client,
    `(() => {
      const panel = document.querySelector('#api-cost-guard-heading')?.closest('section');
      return panel instanceof HTMLElement
        && panel.innerText.includes('보호 작동 중')
        && panel.innerText.includes('15분 이내 Cloudflare 사용량 대조와 감사 기록을 확인하고 재개했습니다.');
    })()`,
    "admin.apiCostGuard.runningState",
    config.timeoutMs,
  );
  record(config.checks, "admin.apiCostGuard.reconcileResume", "pass", "Cloudflare 세 사용량을 대조한 뒤에만 전역 API guard가 running 상태로 재개됐습니다.");
  await evaluate(client, "document.querySelector('#api-cost-guard-heading')?.scrollIntoView({ block: 'start' })");
  const apiRunningScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });

  await waitForEvaluate(
    client,
    `(() => {
      const labels = [...document.querySelectorAll('[aria-label*="앱 상한 대비"]')]
        .map((element) => element.getAttribute('aria-label') ?? '');
      return labels.length === 5
        && labels.some((label) => label.includes('Images 변환'))
        && document.body.innerText.includes('4,000회에서 자동 중단')
        && document.body.innerText.includes('중단이 알림보다 먼저 실행됩니다.');
    })()`,
    "admin.costGuard.fiveMeters",
    config.timeoutMs,
  );
  record(config.checks, "admin.costGuard.fiveMeters", "pass", "관리자 화면에 저장·쓰기·Images 변환·월간 조회·일간 조회의 다섯 비용 미터와 80% 선차단 정책이 표시됐습니다.", {
    meterCount: 5,
    transformStopLimit: 4_000,
  });

  const stopPatchCount = countApiRequests(networkEvents, config.pagesUrl, "/api/admin/photo-cost-guard", "PATCH");
  await fillTextInput(client, 'input[placeholder*="비정상 트래픽"]', "local browser security stop", "운영 중단 사유");
  await waitForEvaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '사진 R2 사용 즉시 중단');
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`,
    "admin.costGuard.stopEnabled",
    config.timeoutMs,
  );
  await clickHitTestedTextButton(client, "사진 R2 사용 즉시 중단", { exact: true });
  await waitFor(
    () => countApiRequests(networkEvents, config.pagesUrl, "/api/admin/photo-cost-guard", "PATCH") > stopPatchCount,
    "admin.costGuard.stopRequest",
    config.timeoutMs,
  );
  await waitForEvaluate(
    client,
    "document.body.innerText.includes('R2 중단') && document.body.innerText.includes('R2 사진 업로드와 조회를 즉시 중단했습니다.')",
    "admin.costGuard.stoppedState",
    config.timeoutMs,
  );
  record(config.checks, "admin.costGuard.stop", "pass", "브라우저의 즉시 중단 버튼이 Next 관리자 경계를 거쳐 업로드와 조회를 함께 중단했습니다.");
  await evaluate(client, "document.querySelector('#photo-cost-guard-heading')?.scrollIntoView({ block: 'start' })");
  const stoppedScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });

  const resumePatchCount = countApiRequests(networkEvents, config.pagesUrl, "/api/admin/photo-cost-guard", "PATCH");
  await fillTextInput(client, 'input[placeholder*="비정상 트래픽"]', "local browser security resume", "운영 재개 사유");
  const reviewed = await evaluate(
    client,
    `(() => {
      const checkbox = document.querySelector('input[type="checkbox"]');
      if (!(checkbox instanceof HTMLInputElement)) return false;
      checkbox.click();
      return checkbox.checked;
    })()`,
  );
  if (reviewed !== true) {
    throw new SmokeError("ADMIN_COST_GUARD_REVIEW_CHECKBOX_MISSING", "비용 원장 대조 확인란을 선택하지 못했습니다.");
  }
  await waitForEvaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '검토 후 R2 사용 재개');
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`,
    "admin.costGuard.resumeEnabled",
    config.timeoutMs,
  );
  await clickHitTestedTextButton(client, "검토 후 R2 사용 재개", { exact: true });
  await waitFor(
    () => countApiRequests(networkEvents, config.pagesUrl, "/api/admin/photo-cost-guard", "PATCH") > resumePatchCount,
    "admin.costGuard.resumeRequest",
    config.timeoutMs,
  );
  await waitForEvaluate(
    client,
    "document.body.innerText.includes('보호 작동 중') && document.body.innerText.includes('검토 기록과 함께 R2 사진 업로드와 조회를 재개했습니다.')",
    "admin.costGuard.runningState",
    config.timeoutMs,
  );
  record(config.checks, "admin.costGuard.resume", "pass", "원장 대조 확인과 사유 입력 없이는 재개할 수 없고, 확인 후 업로드와 조회가 함께 재개됐습니다.");
  await evaluate(client, "document.querySelector('#photo-cost-guard-heading')?.scrollIntoView({ block: 'start' })");
  const runningScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });

  return {
    apiStoppedScreenshotBase64: apiStoppedScreenshot.data,
    apiRunningScreenshotBase64: apiRunningScreenshot.data,
    stoppedScreenshotBase64: stoppedScreenshot.data,
    runningScreenshotBase64: runningScreenshot.data,
  };
}

export async function writeFailureArtifacts(artifactDir, diagnostics, artifacts, timestamp = Date.now()) {
  if (!diagnostics.client) {
    return;
  }

  await mkdir(artifactDir, { recursive: true });
  const screenshot = await diagnostics.client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const screenshotPath = join(artifactDir, `pages-smoke-failure-${timestamp}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  artifacts.failureScreenshot = screenshotPath;

  const networkPath = join(artifactDir, `pages-smoke-failure-network-${timestamp}.json`);
  await writeFile(networkPath, JSON.stringify(diagnostics.networkEvents, null, 2), "utf8");
  artifacts.failureNetwork = networkPath;

  const consolePath = join(artifactDir, `pages-smoke-failure-console-${timestamp}.log`);
  await writeFile(consolePath, diagnostics.consoleMessages.join("\n"), "utf8");
  artifacts.failureConsole = consolePath;
}

async function runSharePostChecks(client, config, networkEvents) {
  const shareUrl = new URL(`/share/post/${encodeURIComponent(config.sharePostId)}`, config.pagesUrl);
  await client.send("Page.navigate", { url: shareUrl.toString() });
  await waitFor(() => hasPageResponse(networkEvents, shareUrl), "share.postPage.response", config.timeoutMs);
  await waitForEvaluate(
    client,
    `
      (() => {
        const card = document.querySelector('[aria-label="#실시간 공유 카드"]');
        return card instanceof HTMLElement &&
          card.innerText.includes(${JSON.stringify(config.placeName)}) &&
          card.innerText.includes('#실시간');
      })()
    `,
    "share.postPage",
    config.timeoutMs,
  );
  record(config.checks, "share.postPage", "pass", "공유 페이지가 Worker-backed 게시물 카드로 렌더링됐습니다.", { postId: config.sharePostId });

  const imageResult = await evaluate(
    client,
    `
      (async () => {
        const response = await fetch(${JSON.stringify(`${shareUrl.pathname}/opengraph-image`)}, { cache: 'no-store' });
        const blob = await response.blob();
        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
          byteSize: blob.size,
        };
      })()
    `,
  );
  if (imageResult?.ok !== true || imageResult.contentType !== "image/png" || !(imageResult.byteSize > 0)) {
    throw new SmokeError("SHARE_OG_IMAGE_FAILED", `공유 OG 이미지 응답이 올바르지 않습니다. detail=${JSON.stringify(imageResult)}`);
  }
  record(config.checks, "share.opengraphImage", "pass", "공유 OG 이미지가 image/png로 렌더링됐습니다.", {
    postId: config.sharePostId,
    byteSize: imageResult.byteSize,
  });
}

async function runAccountDeletionChecks(client, config, networkEvents) {
  const previousSession = await readBrowserAnonymousSession(client);
  const accountUrl = new URL("/", config.pagesUrl);
  const placesRequestCountBefore = countApiRequests(networkEvents, config.apiBaseUrl, "/api/places", "GET");
  await client.send("Page.navigate", { url: accountUrl.toString() });
  await waitForEvaluate(client, "Boolean(document.querySelector('[aria-label=\"#실시간 앱 프론트엔드 디자인\"]'))", "accountDeletion.appCanvas", config.timeoutMs);
  await waitForEvaluate(client, "document.querySelector('h1')?.textContent?.trim() === '실시간'", "accountDeletion.home", config.timeoutMs);
  await waitFor(
    () => countApiRequests(networkEvents, config.apiBaseUrl, "/api/places", "GET") > placesRequestCountBefore,
    "accountDeletion.appHydrated",
    config.timeoutMs,
  );
  await dismissOnboardingIfPresent(client, config.timeoutMs);

  await clickHitTestedTextButton(client, "마이", { exact: true });
  await waitForEvaluate(client, "document.querySelector('h1')?.textContent?.trim() === '마이'", "accountDeletion.my", config.timeoutMs);
  await waitForEvaluate(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '계정 삭제' && !button.disabled)`,
    "accountDeletion.available",
    config.timeoutMs,
  );
  await clickHitTestedTextButton(client, "계정 삭제", { exact: true });
  await waitForEvaluate(
    client,
    `Boolean(document.querySelector('[role="dialog"][aria-labelledby="account-delete-title"]'))`,
    "accountDeletion.dialog",
    config.timeoutMs,
  );

  const deleteInitiallyDisabled = await evaluate(
    client,
    `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="account-delete-title"]');
      const button = dialog && [...dialog.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '영구 삭제');
      return button instanceof HTMLButtonElement && button.disabled;
    })()`,
  );
  if (deleteInitiallyDisabled !== true) {
    throw new SmokeError("ACCOUNT_DELETION_CONFIRMATION_GATE_MISSING", "확인 문구를 입력하기 전에 영구 삭제 버튼이 비활성화되지 않았습니다.");
  }
  record(config.checks, "accountDeletion.confirmationGate", "pass", "정확한 확인 문구를 입력하기 전에는 영구 삭제를 실행할 수 없습니다.");

  const confirmationSelector = '[role="dialog"][aria-labelledby="account-delete-title"] input[placeholder="계정 삭제"]';
  await fillTextInput(client, confirmationSelector, "계정 삭제", "계정 삭제 확인 문구");
  await waitForEvaluate(
    client,
    `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="account-delete-title"]');
      const button = dialog && [...dialog.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '영구 삭제');
      return button instanceof HTMLButtonElement && !button.disabled;
    })()`,
    "accountDeletion.confirmed",
    config.timeoutMs,
  );

  const requestCountBefore = countApiRequests(networkEvents, config.apiBaseUrl, "/api/account/deletion", "POST");
  await clickHitTestedTextButton(client, "영구 삭제", {
    exact: true,
    withinSelector: '[role="dialog"][aria-labelledby="account-delete-title"]',
  });
  await waitFor(
    () => countApiRequests(networkEvents, config.apiBaseUrl, "/api/account/deletion", "POST") > requestCountBefore,
    "accountDeletion.request",
    config.timeoutMs,
  );
  record(config.checks, "accountDeletion.request", "pass", "확인된 계정 삭제 요청이 Worker API로 한 번 전송됐습니다.");

  await waitForEvaluate(
    client,
    `!document.querySelector('[role="dialog"][aria-labelledby="account-delete-title"]')`,
    "accountDeletion.dialogClosed",
    config.timeoutMs,
  );
  await waitForEvaluate(client, "document.querySelector('h1')?.textContent?.trim() === '실시간'", "accountDeletion.returnHome", config.timeoutMs);
  await waitForEvaluate(
    client,
    `document.body.innerText.includes('이 기기의 익명 활동과 사진 삭제를 완료했습니다.')`,
    "accountDeletion.successToast",
    config.timeoutMs,
  );

  let currentSession = null;
  await waitFor(async () => {
    const raw = await evaluate(client, `window.localStorage.getItem(${JSON.stringify(anonymousSessionKey)})`);
    const candidate = parseAnonymousSessionCredential(raw);
    if (!candidate || (candidate.anonymousId === previousSession.anonymousId && candidate.proof === previousSession.proof)) {
      return false;
    }
    currentSession = candidate;
    return true;
  }, "accountDeletion.sessionRotated", config.timeoutMs);
  record(config.checks, "accountDeletion.sessionRotated", "pass", "삭제된 익명 세션 자격 증명을 지우고 새 서버 결합 세션으로 교체했습니다.");

  const oldSessionResult = await evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(new URL("/api/preferences", config.apiBaseUrl).toString())}, {
        headers: {
          accept: 'application/json',
          'x-silsigan-anon-id': ${JSON.stringify(previousSession.anonymousId)},
          'x-silsigan-anon-proof': ${JSON.stringify(previousSession.proof)},
        },
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      return { status: response.status, code: payload?.error?.code ?? null };
    })()`,
  );
  if (oldSessionResult?.status !== 403) {
    throw new SmokeError("ACCOUNT_DELETION_OLD_SESSION_ACCEPTED", `삭제 전 익명 세션이 거부되지 않았습니다. status=${oldSessionResult?.status ?? "unknown"}`);
  }
  record(config.checks, "accountDeletion.oldSessionRejected", "pass", "삭제 전 익명 세션 증명으로 보호 API를 다시 호출하면 403으로 거부됩니다.", {
    errorCode: oldSessionResult.code,
  });

  if (!currentSession) {
    throw new SmokeError("ACCOUNT_DELETION_SESSION_ROTATION_MISSING", "계정 삭제 후 새 익명 세션을 확인하지 못했습니다.");
  }
  record(config.checks, "accountDeletion.completed", "pass", "확인 문구, 영구 삭제, 로컬 초기화, 새 세션 발급까지 사용자 흐름을 완료했습니다.");
  const screenshot = await captureViewportScreenshot(client);
  return screenshot.data;
}

async function runMutatingBrowserChecks(client, config, networkEvents) {
  const anonymousSession = await readBrowserAnonymousSession(client);
  let hashtagScreenshotBase64 = null;

  await clickAriaButton(client, "좋아요");
  await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, `/api/places/${encodeURIComponent(config.placeId)}/like`, "POST"), "places.like", config.timeoutMs);
  record(config.checks, "places.like", "pass", "장소 좋아요 UI가 Worker API로 POST 됐습니다.");

  const commentBody = `browser smoke comment ${new Date().toISOString()}`;
  await fillTextarea(client, `${config.placeName} 댓글 작성`, commentBody);
  await clickSubmitNearTextarea(client, `${config.placeName} 댓글 작성`);
  await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/comments", "POST"), "comments.create", config.timeoutMs);
  record(config.checks, "comments.create", "pass", "장소 댓글 작성 UI가 Worker API로 POST 됐습니다.");
  await waitFor(() => clickFirstCommentLike(client), "comments.likeButton", config.timeoutMs);
  await waitFor(() => hasApiCommentLikeRequest(networkEvents, config.apiBaseUrl), "comments.like", config.timeoutMs);
  record(config.checks, "comments.like", "pass", "댓글 도움 UI가 Worker API로 POST 됐습니다.");

  const clickedPhoto = await clickFirstPhoto(client);
  if (clickedPhoto) {
    await waitFor(() => hasApiRequestPrefix(networkEvents, config.apiBaseUrl, "/api/photos/", "POST"), "photos.click", config.timeoutMs);
    record(config.checks, "photos.click", "pass", "사진 확인 UI가 Worker API로 POST 됐습니다.");
  } else if (config.requirePhoto) {
    throw new SmokeError("PHOTO_TILE_REQUIRED", "클릭 가능한 Worker 사진 타일이 없습니다.");
  } else {
    record(config.checks, "photos.click", "skip", "공개 Worker 사진 타일이 없어 사진 클릭 smoke를 건너뜁니다.");
  }

  if (config.report) {
    await clickAriaButton(client, "장소 신고");
    await waitFor(() => hasApiReportRequest(networkEvents, config.apiBaseUrl, "place"), "reports.placeCreate", config.timeoutMs);
    record(config.checks, "reports.placeCreate", "pass", "장소 신고 UI가 Worker API로 POST 됐습니다.");

    if (!(await openFirstCommentReportDialog(client, config.timeoutMs))) {
      throw new SmokeError("COMMENT_REPORT_BUTTON_REQUIRED", "신규 Worker 댓글 신고 버튼을 찾지 못했습니다.");
    }
    await clickModalReason(client, "기타");
    await waitFor(() => hasApiReportRequest(networkEvents, config.apiBaseUrl, "comment"), "reports.commentCreate", config.timeoutMs);
    await waitForReportDialogClosed(client, config.timeoutMs);
    record(config.checks, "reports.commentCreate", "pass", "댓글 신고 UI가 Worker API로 POST 됐습니다.");

    if (await openFirstPhotoReportDialog(client, config.timeoutMs)) {
      await clickModalReason(client, "기타");
      await waitFor(() => hasApiReportRequest(networkEvents, config.apiBaseUrl, "photo"), "reports.photoCreate", config.timeoutMs);
      await waitForReportDialogClosed(client, config.timeoutMs);
      record(config.checks, "reports.photoCreate", "pass", "사진 신고 UI가 Worker API로 POST 됐습니다.");
    } else if (config.requirePhoto) {
      throw new SmokeError("PHOTO_REPORT_BUTTON_REQUIRED", "신고 가능한 Worker 사진 타일을 찾지 못했습니다.");
    } else {
      record(config.checks, "reports.photoCreate", "skip", "공개 Worker 사진 타일이 없어 사진 신고 smoke를 건너뜁니다.");
    }

    if (await clickFirstPhotoDelete(client)) {
      await waitFor(() => hasApiPhotoDeleteRequest(networkEvents, config.apiBaseUrl), "photos.delete", config.timeoutMs);
      record(config.checks, "photos.delete", "pass", "내 사진 삭제 UI가 Worker API로 DELETE 됐습니다.");
    } else if (config.requirePhoto) {
      throw new SmokeError("PHOTO_DELETE_BUTTON_REQUIRED", "소유한 Worker 사진 삭제 버튼을 찾지 못했습니다.");
    } else {
      record(config.checks, "photos.delete", "skip", "소유한 Worker 사진 타일이 없어 사진 삭제 smoke를 건너뜁니다.");
    }

    record(config.checks, "reports.create", "pass", "장소/댓글/사진 신고 UI의 Worker API POST 경로를 확인했습니다.");
    hashtagScreenshotBase64 = await createFieldReportFromBrowser(client, config, networkEvents);
  } else {
    record(config.checks, "reports.create", "skip", "--report 없이 실제 신고 생성은 실행하지 않습니다.");
  }

  await cleanupLike(config.apiBaseUrl, config.placeId, anonymousSession);
  await cleanupComment(config.apiBaseUrl, config.placeId, commentBody, anonymousSession);
  record(config.checks, "browser.cleanup", "pass", "브라우저 smoke 좋아요/댓글을 같은 익명 세션으로 정리했습니다.");
  return hashtagScreenshotBase64;
}

export function classifyMapSurfaceObservation(observation, allowEmpty = false) {
  if (!observation || observation.width < 240 || observation.height < 140) {
    return null;
  }
  if (observation.hasInteractiveMarker === true) {
    return "places";
  }
  if (allowEmpty && observation.hasEmptyState === true && observation.hasRetryAction === true) {
    return "empty";
  }
  return null;
}

async function assertMapSurfaceVisible(client, timeoutMs, allowEmpty) {
  let state = null;
  await waitFor(async () => {
    const observations = await evaluate(
      client,
      `
        [...document.querySelectorAll('[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]')]
          .filter((map) => map instanceof HTMLElement)
          .map((map) => {
            const rect = map.getBoundingClientRect();
            const buttons = [...map.querySelectorAll('button')];
            return {
              width: rect.width,
              height: rect.height,
              hasInteractiveMarker: buttons.some((button) => {
                const markerRect = button.getBoundingClientRect();
                const label = button.getAttribute('aria-label') ?? '';
                return markerRect.width > 0 && markerRect.height > 0 && (button.hasAttribute('data-silsigan-place-id') || label.includes('상세'));
              }),
              hasEmptyState: map.innerText.includes('표시할 장소 없음'),
              hasRetryAction: buttons.some((button) => button.textContent?.includes('지도 다시 시도')),
            };
          })
      `,
    );
    state = Array.isArray(observations)
      ? observations.map((observation) => classifyMapSurfaceObservation(observation, allowEmpty)).find(Boolean) ?? null
      : null;
    return Boolean(state);
  }, "map.visible", timeoutMs);
  return state;
}

async function assertRankingPanelsVisible(client, config, allowDirectorySuspension = false) {
  const condition = allowDirectorySuspension
    ? `
    (() => {
      const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
      if (!(grid instanceof HTMLElement)) return false;
      const text = grid.innerText;
      const buttons = [...grid.querySelectorAll('button')];
      return text.includes('실시간 순위 일시 중단')
        && text.includes('기본 장소 위치는 표시하지만 최신 근거가 없으므로 순위를 만들지 않습니다.')
        && buttons.length === 0;
    })()
  `
    : `
    (() => {
      const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
      if (!(grid instanceof HTMLElement)) return false;
      const text = grid.innerText;
      const buttons = [...grid.querySelectorAll('button')];
      const hasTruthfulScopeTitle = text.includes('전국 최신 근거 TOP 10') || text.includes('지도 화면 안 TOP 10');
      return hasTruthfulScopeTitle &&
        !text.includes('전국 TOP 10') &&
        buttons.length >= 1 &&
        buttons.some((button) => button.textContent?.includes(${JSON.stringify(config.placeName)}));
    })()
  `;

  try {
    await waitForEvaluate(client, condition, "rankings.visible", config.timeoutMs);
  } catch {
    const state = await evaluate(
      client,
      `
        (() => {
          const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
          if (!(grid instanceof HTMLElement)) return { found: false };
          return {
            found: true,
            text: grid.innerText.slice(0, 500),
            buttons: [...grid.querySelectorAll('button')].map((button) => button.textContent?.trim().slice(0, 160) ?? ''),
          };
        })()
      `,
    );
    throw new SmokeError("RANKINGS_NOT_VISIBLE", `랭킹 패널 상태가 기대와 다릅니다. detail=${JSON.stringify(state)}`);
  }
}

async function runMapControlChecks(client, config) {
  await waitForEvaluate(
    client,
    `(() => {
      const fallback = document.querySelector('[data-map-failure-code]');
      const diagnosticCode = fallback instanceof HTMLElement ? fallback.dataset.mapFailureCode ?? '' : '';
      return document.body.innerText.includes('도심/한강')
        && !document.body.innerText.includes('수도권 준비')
        && !/MAP_(KEY_MISSING|AUTH_FAILED|TIMEOUT|RESOURCE_FAILED|SDK_FAILED)/.test(document.body.innerText)
        && (!fallback || /^MAP_(KEY_MISSING|AUTH_FAILED|TIMEOUT|RESOURCE_FAILED|SDK_FAILED)$/.test(diagnosticCode));
    })()`,
    "map.userCopy",
    config.timeoutMs,
  );
  record(config.checks, "map.userCopy", "pass", "지도 진단 코드는 화면에서 숨기고 전국 지역 탭은 완성된 사용자 문구만 표시했습니다.");

  const directoryMode = Boolean(await evaluate(
    client,
    `document.body.innerText.includes('교통 연결 중단')`,
  ));
  const trafficButtonText = directoryMode ? "교통 연결 중단" : "교통 켜기";

  await assertTextButtonAboveBottomNav(client, trafficButtonText);
  await assertTextButtonAboveBottomNav(client, "이 지역 다시 검색");
  await assertTextButtonAboveBottomNav(client, "현재 위치");
  record(config.checks, "map.controlsUncovered", "pass", "초기 지도 도구와 현재 위치 버튼이 하단 내비게이션에 가려지지 않습니다.");
  await assertBottomNavOpaque(client, config.timeoutMs);
  record(config.checks, "layout.bottomNavOpaque", "pass", "하단 내비게이션이 뒤쪽 버튼을 비쳐 보이게 하지 않습니다.");

  if (directoryMode) {
    await waitForEvaluate(
      client,
      `
        [...document.querySelectorAll('button')].some((button) =>
          button.disabled
            && button.getAttribute('aria-pressed') === 'false'
            && button.textContent?.includes('교통 연결 중단')
        )
      `,
      "map.trafficButton",
      config.timeoutMs,
    );
    record(config.checks, "map.trafficButton", "pass", "정적 디렉터리 모드에서는 외부 교통 연결이 비활성 상태로 유지됩니다.");
  } else {
    await clickHitTestedTextButton(client, "교통 켜기");
    await waitForEvaluate(
      client,
      `
        [...document.querySelectorAll('button')].some((button) =>
          button.getAttribute('aria-pressed') === 'true' && button.textContent?.includes('교통 끄기')
        )
      `,
      "map.trafficButton",
      config.timeoutMs,
    );
    record(config.checks, "map.trafficButton", "pass", "교통 버튼 클릭 후 pressed 상태와 문구가 바뀌었습니다.");
    await clickHitTestedTextButton(client, "교통 끄기");
  }

  await clickHitTestedTextButton(client, "필터");
  await waitForEvaluate(
    client,
    `
      [...document.querySelectorAll('[aria-label="지도 장소 필터"] button')].some((button) =>
        button.getAttribute('aria-pressed') === 'true' && button.textContent?.includes('사람 많음')
      )
    `,
    "map.filterButton",
    config.timeoutMs,
  );
  record(config.checks, "map.filterButton", "pass", "필터 버튼 클릭 후 active 필터가 갱신됐습니다.");
  await clickHitTestedTextButton(client, "전체", { exact: true }).catch(() => {});

  await clickHitTestedTextButton(client, "이 지역 다시 검색");
  await waitForEvaluate(
    client,
    directoryMode
      ? `document.body.innerText.includes('실시간 연결을 다시 확인했지만 보호 모드를 유지합니다. 기본 장소 위치만 표시합니다.')`
      : `document.body.innerText.includes('현재 지도 화면 기준으로 다시 불러왔습니다.') || document.body.innerText.includes('현재 검색어 기준으로 장소를 다시 불러왔습니다.')`,
    "map.requeryButton",
    config.timeoutMs,
  );
  record(
    config.checks,
    "map.requeryButton",
    "pass",
    directoryMode
      ? "정적 디렉터리 재검색 후에도 실시간 보호 모드와 기본 장소 범위를 유지했습니다."
      : "이 지역 다시 검색 버튼 클릭 후 토스트가 갱신됐습니다.",
  );

  await clickHitTestedButton(client, { ariaIncludes: "안전 정책" });
  await waitForEvaluate(
    client,
    `document.body.innerText.includes('정확한 좌표, 원본 파일명, 민감정보는 공개하지 않는 정책입니다.')`,
    "header.safetyButton",
    config.timeoutMs,
  );
  record(config.checks, "header.safetyButton", "pass", "헤더 안전 정책 버튼이 실제 클릭 후 정책 토스트를 표시했습니다.");

  await clickHitTestedButton(client, { ariaIncludes: "새 현장 알림 켜기" });
  await waitForEvaluate(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === '새 현장 알림 끄기' && button.getAttribute('aria-pressed') === 'true')`,
    "header.notificationButton",
    config.timeoutMs,
  );
  record(config.checks, "header.notificationButton", "pass", "헤더 알림 버튼 클릭 후 pressed 상태와 라벨이 바뀌었습니다.");

  await clickHitTestedTextButton(client, "홈", { exact: true });
  await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '실시간'`, "bottomNav.home", config.timeoutMs);
  record(config.checks, "bottomNav.home", "pass", "하단 홈 버튼이 실제 hit-test 가능한 영역에서 화면을 전환했습니다.");
  if (await dismissOnboardingIfPresent(client, config.timeoutMs)) {
    record(config.checks, "onboarding.dismiss", "pass", "첫 방문 안내가 뜬 상태에서 안내 버튼을 실제 클릭해 닫았습니다.");
  }

  await clickHitTestedTextButton(client, "마이", { exact: true });
  await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '마이'`, "bottomNav.my", config.timeoutMs);
  record(config.checks, "bottomNav.my", "pass", "하단 마이 버튼이 실제 hit-test 가능한 영역에서 화면을 전환했습니다.");

  await waitForEvaluate(
    client,
    `document.body.innerText.includes('내 제보 상태')
      && document.body.innerText.includes('이 기기 제보')
      && !/준비 중|연결 대기|공개 미리보기|집계 대기/.test(document.body.innerText)
      && !document.body.innerText.includes('/api/')`,
    "my.activityComplete",
    config.timeoutMs,
  );
  record(config.checks, "my.activityComplete", "pass", "마이 화면이 가짜 신뢰점수나 미완성 문구 대신 실제 기기 제보 검수 상태를 표시했습니다.");
  await waitForEvaluate(client, `!document.querySelector('[role="status"]')`, "my.toastSettled", config.timeoutMs);
  await resetWindowScroll(client);
  await delay(250);
  const myScreenshot = await captureViewportScreenshot(client);

  await clickHitTestedTextButton(client, "안전 정책 및 이용 안내", { exact: true });
  await waitForEvaluate(
    client,
    `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '안전 정책 및 이용 안내' && button.getAttribute('aria-pressed') === 'true') && document.body.innerText.includes('안전 정책으로 이동했습니다.')`,
    "my.safetyMenu",
    config.timeoutMs,
  );
  record(config.checks, "my.safetyMenu", "pass", "마이 안전 정책 메뉴가 실제 클릭 후 활성 상태와 토스트를 표시했습니다.");

  await clickHitTestedTextButton(client, "지도", { exact: true });
  await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '지도'`, "bottomNav.map", config.timeoutMs);
  record(config.checks, "bottomNav.map", "pass", "하단 지도 버튼이 실제 hit-test 가능한 영역에서 화면을 전환했습니다.");
  return myScreenshot;
}

async function assertBottomNavOpaque(client, timeoutMs) {
  await waitForEvaluate(
    client,
    `
      (() => {
        const nav = document.querySelector('[class*="bottomNav"]');
        if (!(nav instanceof HTMLElement)) return false;
        const color = getComputedStyle(nav).backgroundColor.replaceAll(' ', '');
        return color === 'rgb(255,255,255)' || color === 'rgba(255,255,255,1)';
      })()
    `,
    "layout.bottomNavOpaque",
    timeoutMs,
  );
}

async function dismissOnboardingIfPresent(client, timeoutMs) {
  const dismissed = await evaluate(
    client,
    `
      (() => {
        const overlay = document.querySelector('[aria-label="#실시간 첫 방문 안내"]');
        if (!(overlay instanceof HTMLElement)) return false;
        const button = [...overlay.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '바로 둘러보기');
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );

  if (dismissed) {
    await waitForEvaluate(client, `!document.querySelector('[aria-label="#실시간 첫 방문 안내"]')`, "onboarding.dismiss", timeoutMs);
  }

  return Boolean(dismissed);
}

async function assertTextButtonAboveBottomNav(client, text) {
  const result = await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
        const bottomNav = document.querySelector('[class*="bottomNav"]');
        if (!(button instanceof HTMLButtonElement) || !(bottomNav instanceof HTMLElement)) {
          return { ok: false, reason: 'missing_element' };
        }

        const buttonRect = button.getBoundingClientRect();
        const navRect = bottomNav.getBoundingClientRect();
        if (buttonRect.width <= 0 || buttonRect.height <= 0) {
          return { ok: false, reason: 'button_not_visible', buttonBottom: buttonRect.bottom, navTop: navRect.top };
        }

        return {
          ok: buttonRect.bottom <= navRect.top,
          reason: buttonRect.bottom <= navRect.top ? 'clear' : 'covered_by_bottom_nav',
          buttonBottom: buttonRect.bottom,
          navTop: navRect.top,
        };
      })()
    `,
  );

  if (!result?.ok) {
    throw new SmokeError(
      "MAP_CONTROL_COVERED_BY_BOTTOM_NAV",
      `${text} 버튼이 하단 내비게이션에 가려졌습니다. detail=${JSON.stringify(result)}`,
    );
  }
}

export async function launchChrome(chromePathInput) {
  const chromePath = chromePathInput ?? (await findChromePath());
  const userDataDir = await mkdtemp(join(tmpdir(), "silsigan-pages-smoke-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const portFilePath = join(userDataDir, "DevToolsActivePort");
  const [port] = (await waitForFileText(portFilePath, 8_000)).trim().split("\n");
  const targets = await fetchJsonFromUrl(`http://127.0.0.1:${port}/json/list`);
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pageTarget) {
    throw new SmokeError("CHROME_TARGET_NOT_FOUND", "Chrome page target을 찾지 못했습니다.");
  }

  const client = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);

  return {
    client,
    cleanup: async () => {
      client.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      const exitedAfterTerm = await waitForChildExit(child, 2_000);
      if (!exitedAfterTerm) {
        child.kill("SIGKILL");
        await waitForChildExit(child, 2_000);
      }
      await removeDirectoryWithRetry(userDataDir);
      if (stderr.includes("DevToolsActivePort file doesn't exist")) {
        throw new SmokeError("CHROME_LAUNCH_FAILED", "Chrome DevTools 포트를 열지 못했습니다.");
      }
    },
  };
}

async function clickMapMarker(client, placeName, timeoutMs) {
  await scrollMapSurfaceIntoView(client);
  await waitFor(
    () =>
      clickHitTestedButton(client, {
        ariaIncludes: placeName,
        withinSelector: '[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]',
      }),
    "map.markerClickable",
    timeoutMs,
  ).catch(() => {
    return describeMapMarkerHitTest(client, placeName).then((detail) => {
      throw new SmokeError("MAP_MARKER_NOT_CLICKABLE", `${placeName} 지도 마커를 실제 클릭 가능한 위치에서 누를 수 없습니다. detail=${JSON.stringify(detail)}`);
    });
  });
}

async function scrollMapSurfaceIntoView(client) {
  await evaluate(
    client,
    `
      (() => {
        const map = document.querySelector('[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]');
        if (!(map instanceof HTMLElement)) return false;
        const scrollParent = map.closest('[class*="phoneBody"]');
        if (scrollParent instanceof HTMLElement) {
          const parentRect = scrollParent.getBoundingClientRect();
          const mapRect = map.getBoundingClientRect();
          const nextTop = Math.max(0, scrollParent.scrollTop + mapRect.top - parentRect.top - 8);
          scrollParent.scrollTo({ top: nextTop, behavior: 'auto' });
          return true;
        }
        map.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        return true;
      })()
    `,
  );
}

async function describeMapMarkerHitTest(client, placeName) {
  return evaluate(
    client,
    `
      (() => {
        const root = document.querySelector('[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]');
        const scrollParent = root instanceof HTMLElement ? root.closest('[class*="phoneBody"]') : null;
        const rootRect = root instanceof HTMLElement ? root.getBoundingClientRect() : null;
        const markerButtons = root instanceof HTMLElement
          ? [...root.querySelectorAll('button')].filter((button) => (button.getAttribute('aria-label') ?? '').includes(${JSON.stringify(placeName)}))
          : [];
        return {
          hasRoot: root instanceof HTMLElement,
          rootLabel: root instanceof HTMLElement ? root.getAttribute('aria-label') : null,
          rootRect: rootRect ? { top: Math.round(rootRect.top), bottom: Math.round(rootRect.bottom), width: Math.round(rootRect.width), height: Math.round(rootRect.height) } : null,
          scrollTop: scrollParent instanceof HTMLElement ? Math.round(scrollParent.scrollTop) : null,
          markerCount: markerButtons.length,
          markers: markerButtons.slice(0, 4).map((button) => {
            const rect = button.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const target = document.elementFromPoint(x, y);
            return {
              label: button.getAttribute('aria-label'),
              rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
              centerInViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
              hitTag: target instanceof HTMLElement ? target.tagName : null,
              hitClass: target instanceof HTMLElement ? String(target.className).slice(0, 120) : null,
              hitLabel: target instanceof HTMLElement ? target.getAttribute('aria-label') : null,
              buttonContainsHit: target instanceof Node ? button.contains(target) : false,
            };
          }),
        };
      })()
    `,
  );
}

async function clickRankingPlace(client, placeName) {
  const result = await clickHitTestedButton(client, {
    text: placeName,
    withinSelector: '[aria-label="실시간 장소 랭킹"]',
  });
  if (result !== true) {
    throw new SmokeError("RANKING_PLACE_NOT_CLICKABLE", `${placeName} 랭킹 항목을 실제 클릭 가능한 위치에서 누를 수 없습니다.`);
  }
}

async function resetWindowScroll(client) {
  await evaluate(
    client,
    `(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      return window.scrollX === 0 && window.scrollY === 0;
    })()`,
  );
}

async function captureViewportScreenshot(client) {
  return client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      scale: 1,
    },
  });
}

async function clickTextButton(client, text) {
  const result = await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("BUTTON_NOT_FOUND", `${text} 버튼을 찾지 못했습니다.`);
  }
}

async function clickBottomNavButton(client, text) {
  const result = await evaluate(
    client,
    `
      (() => {
        const nav = document.querySelector('[class*="bottomNav"]');
        const button = nav && [...nav.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("BOTTOM_NAV_BUTTON_NOT_FOUND", `${text} 하단 내비게이션 버튼을 찾지 못했습니다.`);
  }
}

async function clickHitTestedTextButton(client, text, options = {}) {
  const result = await clickHitTestedButton(client, {
    text,
    exact: Boolean(options.exact),
    withinSelector: options.withinSelector ?? null,
  });
  if (result !== true) {
    throw new SmokeError("BUTTON_NOT_CLICKABLE", `${text} 버튼을 실제 클릭 가능한 위치에서 누를 수 없습니다.`);
  }
}

async function clickHitTestedButton(client, { text = "", exact = false, ariaIncludes = "", withinSelector = null }) {
  const point = await evaluate(
    client,
    `
      (() => {
        const root = ${withinSelector ? `document.querySelector(${JSON.stringify(withinSelector)})` : "document"};
        if (!root) return null;
        const buttons = [...root.querySelectorAll('button')].filter((button) => {
          const buttonText = button.textContent?.trim() ?? '';
          const label = button.getAttribute('aria-label') ?? '';
          if (${JSON.stringify(ariaIncludes)}) return label.includes(${JSON.stringify(ariaIncludes)});
          if (${JSON.stringify(exact)}) return buttonText === ${JSON.stringify(text)};
          return buttonText.includes(${JSON.stringify(text)});
        });

        for (const button of buttons) {
          if (!(button instanceof HTMLButtonElement) || button.disabled) continue;
          button.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = button.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const candidates = [
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
            [rect.left + Math.min(24, rect.width / 2), rect.top + rect.height / 2],
            [rect.right - Math.min(24, rect.width / 2), rect.top + rect.height / 2],
          ];
          for (const [x, y] of candidates) {
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
            const target = document.elementFromPoint(x, y);
            if (!target || !button.contains(target)) continue;
            return { x, y };
          }
        }

        return null;
      })()
    `,
  );
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    return false;
  }

  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  return true;
}

async function clickAriaButton(client, label) {
  const result = await evaluate(
    client,
    `
      (() => {
        const button = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("BUTTON_NOT_FOUND", `${label} 버튼을 찾지 못했습니다.`);
  }
}

async function fillTextarea(client, label, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const textarea = document.querySelector(${JSON.stringify(`textarea[aria-label="${label}"]`)});
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, ${JSON.stringify(value)});
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("TEXTAREA_NOT_FOUND", `${label} 입력창을 찾지 못했습니다.`);
  }
}

async function fillSearchInput(client, label, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)});
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("INPUT_NOT_FOUND", `${label} 입력창을 찾지 못했습니다.`);
  }
}

async function fillTextInput(client, selector, value, label) {
  const focused = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLInputElement)) return false;
        input.focus();
        return document.activeElement === input;
      })()
    `,
  );
  if (focused !== true) {
    throw new SmokeError("INPUT_NOT_FOUND", `${label} 입력창을 찾지 못했습니다.`);
  }
  await client.send("Input.insertText", { text: value });
  await waitForEvaluate(
    client,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
    `${label}.value`,
    DEFAULT_TIMEOUT_MS,
  );
}

async function fillLabeledInput(client, headingId, labelText, value, label) {
  const result = await evaluate(
    client,
    `
      (() => {
        const section = document.querySelector('#' + ${JSON.stringify(headingId)})?.closest('section');
        if (!(section instanceof HTMLElement)) return false;
        const field = [...section.querySelectorAll('label')].find((candidate) => candidate.innerText.includes(${JSON.stringify(labelText)}));
        const input = field?.querySelector('input');
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return input.value === ${JSON.stringify(value)};
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("INPUT_NOT_FOUND", `${label} 입력창을 찾지 못했습니다.`);
  }
}

async function clickSubmitNearTextarea(client, label) {
  const result = await evaluate(
    client,
    `
      (() => {
        const textarea = document.querySelector(${JSON.stringify(`textarea[aria-label="${label}"]`)});
        const form = textarea?.closest('form');
        const button = form?.querySelector('button[type="submit"]');
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("SUBMIT_NOT_FOUND", `${label} 제출 버튼을 찾지 못했습니다.`);
  }
}

async function clickFirstPhoto(client) {
  const result = await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('button')].find((candidate) => {
          const label = candidate.getAttribute('aria-label') ?? '';
          return label.includes('사진 보기.') || label.endsWith('사진 확인');
        });
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );
  return result === true;
}

async function clickFirstCommentReport(client) {
  const result = await clickHitTestedButton(client, {
    ariaIncludes: "댓글 신고",
  });
  return result === true;
}

async function openFirstCommentReportDialog(client, timeoutMs) {
  return waitFor(async () => {
    if (await isReportDialogOpen(client)) {
      return true;
    }
    if (!(await clickFirstCommentReport(client))) {
      return false;
    }
    await delay(250);
    return isReportDialogOpen(client);
  }, "comment.reportDialogOpen", timeoutMs)
    .then(() => true)
    .catch(() => false);
}

async function clickFirstCommentLike(client) {
  const result = await clickHitTestedButton(client, {
    ariaIncludes: "댓글 도움돼요",
  });
  return result === true;
}

async function clickFirstPhotoReport(client) {
  const result = await clickHitTestedButton(client, {
    ariaIncludes: "사진 신고",
  });
  return result === true;
}

async function openFirstPhotoReportDialog(client, timeoutMs) {
  return waitFor(async () => {
    if (await isReportDialogOpen(client)) {
      return true;
    }
    if (!(await clickFirstPhotoReport(client))) {
      return false;
    }
    await delay(250);
    return isReportDialogOpen(client);
  }, "photo.reportDialogOpen", timeoutMs)
    .then(() => true)
    .catch(() => false);
}

async function clickFirstPhotoDelete(client) {
  const result = await evaluate(
    client,
    `
      (() => {
        const button = [...document.querySelectorAll('button')].find((candidate) =>
          candidate.getAttribute('aria-label')?.includes('사진 삭제')
        );
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = button.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!target || !button.contains(target)) return false;
        button.click();
        return true;
      })()
    `,
  );
  return result === true;
}

async function clickModalReason(client, text) {
  await clickHitTestedTextButton(client, text, {
    withinSelector: '[role="dialog"][aria-label="신고 이유 선택"]',
  });
}

async function createFieldReportFromBrowser(client, config, networkEvents) {
  const openedFromSheet = await clickHitTestedButton(client, {
    ariaIncludes: "현장 제보 작성",
  });
  if (openedFromSheet !== true) {
    await clickHitTestedTextButton(client, "올리기", { exact: true });
  }

  await waitForEvaluate(client, `document.body.innerText.includes('올리기')`, "fieldReports.form", config.timeoutMs);
  const placeSelectionRequired = await evaluate(
    client,
    `Boolean(document.querySelector('[aria-label="최근 확인한 장소 선택"]'))`,
  );
  if (placeSelectionRequired) {
    await clickHitTestedTextButton(client, config.placeName, {
      withinSelector: '[aria-label="최근 확인한 장소 선택"]',
    });
  }
  await waitForEvaluate(
    client,
    `Boolean(document.querySelector('section[aria-label="사진 선택"] input[type="file"]'))`,
    "fieldReports.placeSelection",
    config.timeoutMs,
  );
  record(
    config.checks,
    "fieldReports.placeSelection",
    "pass",
    placeSelectionRequired
      ? "일반 올리기 진입에서 장소를 명시적으로 선택한 뒤 작성 화면을 열었습니다."
      : "장소 상세에서 선택한 장소를 유지한 채 작성 화면을 열었습니다.",
    { placeId: config.placeId },
  );
  if (config.fieldReportPhoto) {
    await confirmPhotoRights(client);
    record(
      config.checks,
      "fieldReports.photoRightsAttestation",
      "pass",
      "사진마다 촬영·게시 권한 확인을 직접 선택한 뒤 파일 입력이 활성화됐습니다.",
    );
    await attachFieldReportPhoto(client);
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/photos/upload", "POST"), "fieldReports.photoUploadRequest", config.timeoutMs);
    await waitForEvaluate(client, `document.body.innerText.includes('사진 업로드 완료')`, "fieldReports.photoUploadComplete", config.timeoutMs);
    record(config.checks, "fieldReports.photoUpload", "pass", "브라우저에서 안전 fixture 사진을 업로드하고 현장 제보에 연결할 준비를 마쳤습니다.");
  }
  await clickHitTestedTextButton(client, "혼잡", { exact: true });
  await fillTextareaById(client, "reportText", fieldReportScreenshotCopy);
  await clickHitTestedTextButton(client, config.fieldReportPhoto ? "지금컷 올리기" : "사진 없이 상태만 올리기", { exact: true });
  await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/reports", "POST"), "fieldReports.create", config.timeoutMs);
  record(config.checks, "fieldReports.create", "pass", "상태 제보 작성 UI가 Worker /api/reports로 POST 됐습니다.");

  if (config.fieldReportPhoto) {
    await waitForEvaluate(client, `document.body.innerText.includes('접수 완료')`, "fieldReports.reload", config.timeoutMs);
    await verifyFieldReportDeepLink(client, config);
    await clickBottomNavButton(client, "검색");
    await waitForEvaluate(client, `document.body.innerText.includes('인기 해시태그')`, "hashtags.searchScreen", config.timeoutMs);
    await fillSearchInput(client, "장소, 해시태그, 지역 검색", "");
    await waitForEvaluate(client, `Boolean(document.querySelector('button[aria-label="#지금 해시태그 보기"]'))`, "hashtags.visible", config.timeoutMs);
    const clickedHashtag = await clickHitTestedButton(client, { ariaIncludes: "#지금 해시태그 보기" });
    if (!clickedHashtag) {
      throw new SmokeError("HASHTAG_BUTTON_NOT_CLICKABLE", "#지금 해시태그 버튼을 실제 클릭 가능한 위치에서 누르지 못했습니다.");
    }
    await waitForEvaluate(
      client,
      `(() => {
        const input = document.querySelector('input[aria-label="장소, 해시태그, 지역 검색"]');
        return input instanceof HTMLInputElement
          && input.value === '#지금'
          && document.body.innerText.includes('최신 제보 사진')
          && document.body.innerText.includes(${JSON.stringify(fieldReportScreenshotCopy)});
      })()`,
      "hashtags.fieldReportPhoto",
      config.timeoutMs,
    );
    record(config.checks, "hashtags.fieldReportPhoto", "pass", "소셜피드가 꺼진 상태에서도 #지금이 승인된 최신 현장사진 제보를 검색 화면에 표시했습니다.");

    const hashtagFollowRequestCount = countApiRequests(networkEvents, config.apiBaseUrl, "/api/preferences", "POST");
    await clickHitTestedTextButton(client, "#지금 팔로우", { exact: true });
    await waitForEvaluate(
      client,
      `Boolean([...document.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('#지금 팔로잉 해제') && button.getAttribute('aria-pressed') === 'true'))`,
      "hashtags.followPressed",
      config.timeoutMs,
    );
    await waitFor(
      () => countApiRequests(networkEvents, config.apiBaseUrl, "/api/preferences", "POST") > hashtagFollowRequestCount,
      "hashtags.followPreference",
      config.timeoutMs,
    );
    await clickBottomNavButton(client, "마이");
    await waitForEvaluate(
      client,
      `Boolean(document.querySelector('button[aria-label="#지금 최신 사진 다시 보기"]'))`,
      "hashtags.followReturnButton",
      config.timeoutMs,
    );
    let clickedFollowReturn = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(500);
      clickedFollowReturn = await clickHitTestedButton(client, { ariaIncludes: "#지금 최신 사진 다시 보기" });
      if (!clickedFollowReturn) break;
      await delay(500);
      const returnedToHashtag = await evaluate(
        client,
        `(() => {
          const input = document.querySelector('input[aria-label="장소, 해시태그, 지역 검색"]');
          return input instanceof HTMLInputElement && input.value === '#지금';
        })()`,
      );
      if (returnedToHashtag) break;
    }
    if (!clickedFollowReturn) {
      throw new SmokeError("HASHTAG_RETURN_NOT_CLICKABLE", "마이 화면의 #지금 최신 사진 다시 보기 버튼을 누르지 못했습니다.");
    }
    await waitForEvaluate(
      client,
      `(() => {
        const input = document.querySelector('input[aria-label="장소, 해시태그, 지역 검색"]');
        return input instanceof HTMLInputElement
          && input.value === '#지금'
          && document.body.innerText.includes(${JSON.stringify(fieldReportScreenshotCopy)});
      })()`,
      "hashtags.followReturn",
      config.timeoutMs,
    );
    record(config.checks, "hashtags.followReturn", "pass", "#지금 팔로우를 Worker 환경설정에 저장하고 마이 화면에서 같은 최신 사진 결과로 복귀했습니다.");

    const hashtagPageRequestCount = countApiRequests(networkEvents, config.apiBaseUrl, "/api/hashtags", "GET");
    const paginationVisible = await evaluate(
      client,
      `Boolean([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('#지금 최신 사진 더 보기')))`,
    );
    if (paginationVisible) {
      await clickHitTestedTextButton(client, "#지금 최신 사진 더 보기", { exact: true });
      await waitFor(
        () => countApiRequests(networkEvents, config.apiBaseUrl, "/api/hashtags", "GET") > hashtagPageRequestCount,
        "hashtags.paginationRequest",
        config.timeoutMs,
      );
      await waitForEvaluate(
        client,
        `document.body.innerText.includes('#지금 사진 1건을 더 불러왔습니다.')`,
        "hashtags.pagination",
        config.timeoutMs,
      );
      record(config.checks, "hashtags.pagination", "pass", "#지금 최신순 cursor 다음 페이지를 실제 버튼으로 불러와 기존 결과에 병합했습니다.");
    }

    await evaluate(
      client,
      `(() => {
        const heading = [...document.querySelectorAll('h2')].find((candidate) => candidate.textContent?.includes('사진 있는 최근 결과'));
        heading?.closest('section')?.scrollIntoView({ block: 'start', inline: 'nearest' });
      })()`,
    );
    await resetWindowScroll(client);
    await delay(250);
    const hashtagScreenshot = await captureViewportScreenshot(client);
    await fillSearchInput(client, "장소, 해시태그, 지역 검색", "성수 웨이팅");
    await waitForEvaluate(
      client,
      `document.body.innerText.includes('현재는 앱에 등록된 장소만 검색합니다.')
        && document.body.innerText.includes('앱 안 지도에서 보기')
        && !document.body.innerText.includes('장소 추가 검색은 준비 중')`,
      "search.externalFallback",
      config.timeoutMs,
    );
    record(config.checks, "search.externalFallback", "pass", "외부 장소 검색이 미설정이어도 완성된 앱 안 검색 범위와 지도 복구 행동을 표시했습니다.");

    await clickHitTestedTextButton(client, "장소 추가 요청 작성", { exact: true });
    await fillTextInput(client, 'input[placeholder="직접 알고 있는 장소명"]', "성수 새 장소", "장소 추가 요청 장소명");
    await fillTextInput(client, 'input[placeholder="도로명 또는 지번 주소"]', "서울특별시 성동구 테스트로 1", "장소 추가 요청 주소");
    const placeRequestCountBefore = countApiRequests(networkEvents, config.apiBaseUrl, "/api/place-requests", "POST");
    await clickHitTestedTextButton(client, "검토 요청 보내기", { exact: true });
    await waitFor(
      () => countApiRequests(networkEvents, config.apiBaseUrl, "/api/place-requests", "POST") > placeRequestCountBefore,
      "placeRequests.createRequest",
      config.timeoutMs,
    );
    await waitForEvaluate(
      client,
      `document.body.innerText.includes('검토 요청을 접수했습니다. 마이에서 진행 상태를 확인할 수 있습니다.')`,
      "placeRequests.createNotice",
      config.timeoutMs,
    );
    record(config.checks, "placeRequests.create", "pass", "미등록 장소를 자동 공개하지 않고 익명 증명 기반 비공개 검토 큐로 접수했습니다.");

    await clickBottomNavButton(client, "마이");
    await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '마이'`, "placeRequests.myScreen", config.timeoutMs);
    await waitFor(
      () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/place-requests", "GET", "mine", "1"),
      "placeRequests.mineRequest",
      config.timeoutMs,
    );
    await waitForEvaluate(
      client,
      `document.body.innerText.includes('성수 새 장소')
        && document.body.innerText.includes('추가 확인 중')
        && document.body.innerText.includes('서울특별시 성동구 테스트로 1')`,
      "placeRequests.ownerStatus",
      config.timeoutMs,
    );
    record(config.checks, "placeRequests.ownerStatus", "pass", "마이 화면에서 요청자 본인에게만 장소 검토 상태와 주소를 표시했습니다.");
    return hashtagScreenshot.data;
  }

  return null;
}

async function verifyFieldReportDeepLink(client, config) {
  const reportsUrl = new URL(
    `/api/reports?placeId=${encodeURIComponent(config.placeId)}&limit=100`,
    config.apiBaseUrl,
  ).toString();
  const reportId = await evaluate(
    client,
    `
      (async () => {
        const response = await fetch(${JSON.stringify(reportsUrl)});
        const payload = await response.json();
        const report = Array.isArray(payload?.data)
          ? payload.data.find((candidate) => candidate?.comment === ${JSON.stringify(fieldReportScreenshotCopy)})
          : null;
        return typeof report?.id === 'string' ? report.id : null;
      })()
    `,
  );
  if (typeof reportId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(reportId)) {
    throw new SmokeError("FIELD_REPORT_SHARE_ID_MISSING", "공유할 승인 제보 ID를 공개 목록에서 찾지 못했습니다.");
  }

  const deepLinkUrl = new URL(config.pagesUrl);
  deepLinkUrl.searchParams.set("place", config.placeId);
  deepLinkUrl.searchParams.set("report", reportId);
  await client.send("Page.navigate", { url: deepLinkUrl.toString() });
  await waitForEvaluate(
    client,
    `(() => {
      const card = document.querySelector(${JSON.stringify(`[data-report-id="${reportId}"]`)});
      return card instanceof HTMLElement
        && card.getAttribute('aria-current') === 'true'
        && document.activeElement === card;
    })()`,
    "fieldReports.shareDeepLink",
    config.timeoutMs,
  );
  record(
    config.checks,
    "fieldReports.shareDeepLink",
    "pass",
    "공유 링크가 승인 제보의 장소 상세를 열고 정확한 제보 카드로 스크롤·초점 이동했습니다.",
    { placeId: config.placeId, reportId },
  );
}

async function attachFieldReportPhoto(client) {
  const attached = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector('section[aria-label="사진 선택"] input[type="file"]');
        if (!(input instanceof HTMLInputElement)) return false;
        const bytes = Uint8Array.from(atob(${JSON.stringify(fieldReportPhotoBase64)}), (character) => character.charCodeAt(0));
        const file = new File([bytes], 'field-report-smoke.jpg', { type: 'image/jpeg' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `,
  );
  if (attached !== true) {
    throw new SmokeError("FIELD_REPORT_PHOTO_INPUT_MISSING", "현장 제보 사진 입력을 찾지 못했습니다.");
  }
}

async function confirmPhotoRights(client) {
  const confirmed = await evaluate(
    client,
    `
      (() => {
        const checkbox = document.querySelector('label[aria-label="사진 게시 권한 확인"] input[type="checkbox"]');
        if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) return false;
        checkbox.click();
        const fileInput = document.querySelector('section[aria-label="사진 선택"] input[type="file"]');
        return checkbox.checked && fileInput instanceof HTMLInputElement && !fileInput.disabled;
      })()
    `,
  );
  if (confirmed !== true) {
    throw new SmokeError("PHOTO_RIGHTS_CONFIRMATION_REQUIRED", "사진 게시 권한 확인 후 파일 입력이 활성화되지 않았습니다.");
  }
}

async function fillTextareaById(client, id, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const textarea = document.querySelector(${JSON.stringify(`textarea#${id}`)});
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, ${JSON.stringify(value)});
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("TEXTAREA_NOT_FOUND", `${id} 입력창을 찾지 못했습니다.`);
  }
}

async function isReportDialogOpen(client) {
  return Boolean(await evaluate(client, `Boolean(document.querySelector('[role="dialog"][aria-label="신고 이유 선택"]'))`));
}

async function waitForReportDialogClosed(client, timeoutMs) {
  await waitForEvaluate(client, `!document.querySelector('[role="dialog"][aria-label="신고 이유 선택"]')`, "report.dialogClosed", timeoutMs);
}

async function readBrowserAnonymousSession(client) {
  const value = await evaluate(client, `window.localStorage.getItem(${JSON.stringify(anonymousSessionKey)})`);
  const session = parseAnonymousSessionCredential(value);
  if (!session) {
    throw new SmokeError("ANON_SESSION_NOT_FOUND", "브라우저의 유효한 서버 결합 익명 세션을 찾지 못했습니다.");
  }

  return session;
}

export function parseAnonymousSessionCredential(raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  try {
    const value = JSON.parse(raw);
    if (
      value
      && typeof value === "object"
      && typeof value.anonymousId === "string"
      && /^[a-zA-Z0-9_-]{12,80}$/.test(value.anonymousId)
      && typeof value.proof === "string"
      && /^[a-zA-Z0-9_-]{43}$/.test(value.proof)
      && typeof value.expiresAt === "string"
      && Number.isFinite(Date.parse(value.expiresAt))
      && Date.parse(value.expiresAt) > now
    ) {
      return {
        anonymousId: value.anonymousId,
        proof: value.proof,
        expiresAt: value.expiresAt,
      };
    }
  } catch {
  }

  return null;
}

async function fetchRealtimeRoomFromBrowser(client, config, scope, roomId) {
  const path = scope === "global" ? "/api/realtime/global" : `/api/realtime/${scope}/${encodeURIComponent(roomId)}`;
  const url = new URL(path, config.apiBaseUrl).toString();
  const result = await evaluate(
    client,
    `
      (async () => {
        const response = await fetch(${JSON.stringify(url)});
        const payload = await response.json();
        return {
          ok: response.ok,
          scope: payload?.data?.scope,
          roomId: payload?.data?.roomId,
          eventsIsArray: Array.isArray(payload?.data?.events),
        };
      })()
    `,
  );
  if (result?.ok !== true || result.scope !== scope || result.roomId !== roomId || result.eventsIsArray !== true) {
    throw new SmokeError("REALTIME_ROOM_FETCH_FAILED", `${scope}:${roomId} realtime room 응답 형식이 올바르지 않습니다.`);
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  return result.result?.value;
}

async function waitForEvaluate(client, expression, name, timeoutMs) {
  await waitFor(async () => Boolean(await evaluate(client, expression)), name, timeoutMs);
}

async function waitFor(predicate, name, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new SmokeError(name, `${name} 조건이 ${timeoutMs}ms 안에 충족되지 않았습니다.`);
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function hasResponse(events, origin) {
  return events.some((event) => event.type === "response" && event.url?.startsWith(origin) && event.status >= 200 && event.status < 500);
}

function hasPageResponse(events, expectedUrl) {
  return events.some((event) => {
    if (event.type !== "response" || typeof event.url !== "string" || event.status < 200 || event.status >= 400) {
      return false;
    }

    try {
      const url = new URL(event.url);
      return url.origin === expectedUrl.origin && url.pathname === expectedUrl.pathname;
    } catch {
      return false;
    }
  });
}

export function hasApiRequest(events, apiBaseUrl, path, method = "GET") {
  return events.some((event) => Boolean(matchingApiRequestUrl(event, apiBaseUrl, path, method)));
}

function countApiRequests(events, apiBaseUrl, path, method = "GET") {
  return events.filter((event) => Boolean(matchingApiRequestUrl(event, apiBaseUrl, path, method))).length;
}

function hasApiRequestPrefix(events, apiBaseUrl, pathPrefix, method = "GET") {
  const expected = new URL(pathPrefix, apiBaseUrl);
  return events.some((event) => {
    const url = matchingApiRequestOrigin(event, expected.origin, method);
    return Boolean(url && url.pathname.startsWith(expected.pathname));
  });
}

export function hasApiRequestWithSearchParam(events, apiBaseUrl, path, method, key, value) {
  return events.some((event) => {
    const url = matchingApiRequestUrl(event, apiBaseUrl, path, method);
    return Boolean(url && url.searchParams.get(key) === value);
  });
}

export function hasApiReportRequest(events, apiBaseUrl, targetType) {
  return events.some((event) => {
    const url = matchingApiRequestUrl(event, apiBaseUrl, "/api/moderation/reports", "POST");
    return Boolean(url && event.reportTargetType === targetType);
  });
}

export function hasApiCommentLikeRequest(events, apiBaseUrl) {
  const expected = new URL("/api/comments/", apiBaseUrl);
  return events.some((event) => {
    const url = matchingApiRequestOrigin(event, expected.origin, "POST");
    return Boolean(url && /^\/api\/comments\/[^/]+\/like$/.test(url.pathname));
  });
}

export function hasApiPhotoDeleteRequest(events, apiBaseUrl) {
  const expected = new URL("/api/photos/", apiBaseUrl);
  return events.some((event) => {
    const url = matchingApiRequestOrigin(event, expected.origin, "DELETE");
    return Boolean(url && /^\/api\/photos\/[^/]+$/.test(url.pathname));
  });
}

function moderationReportTargetType(rawUrl, method, postData) {
  if (method !== "POST" || !rawUrl || !postData) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (url.pathname !== "/api/moderation/reports") {
      return null;
    }
    const targetType = JSON.parse(postData)?.targetType;
    return targetType === "place" || targetType === "comment" || targetType === "photo" ? targetType : null;
  } catch {
    return null;
  }
}

function isFieldReportRequest(rawUrl, method) {
  if (method !== "POST" || !rawUrl) {
    return false;
  }

  try {
    return new URL(rawUrl).pathname === "/api/reports";
  } catch {
    return false;
  }
}

function matchingApiRequestUrl(event, apiBaseUrl, path, method) {
  const expected = new URL(path, apiBaseUrl);
  const url = matchingApiRequestOrigin(event, expected.origin, method);
  if (!url || url.pathname !== expected.pathname) {
    return null;
  }

  return url;
}

function matchingApiRequestOrigin(event, origin, method) {
  if (event.type !== "request" || event.method !== method || !event.url) {
    return null;
  }

  try {
    const url = new URL(event.url);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

async function cleanupLike(apiBaseUrl, placeId, anonymousSession) {
  const response = await fetch(new URL(`/api/places/${encodeURIComponent(placeId)}/like`, apiBaseUrl), {
    method: "DELETE",
    headers: {
      "x-silsigan-anon-id": anonymousSession.anonymousId,
      "x-silsigan-anon-proof": anonymousSession.proof,
    },
  }).catch(() => null);
  if (!response?.ok) {
    throw new SmokeError("BROWSER_CLEANUP_LIKE_FAILED", "브라우저 smoke 좋아요 정리에 실패했습니다.");
  }
}

async function cleanupComment(apiBaseUrl, placeId, body, anonymousSession) {
  const response = await fetch(new URL(`/api/comments?placeId=${encodeURIComponent(placeId)}&limit=20`, apiBaseUrl), {
    headers: {
      "x-silsigan-anon-id": anonymousSession.anonymousId,
      "x-silsigan-anon-proof": anonymousSession.proof,
    },
  }).catch(() => null);
  if (!response?.ok) {
    throw new SmokeError("BROWSER_CLEANUP_COMMENT_LIST_FAILED", "브라우저 smoke 댓글 정리를 위한 목록 조회에 실패했습니다.");
  }

  const payload = await response.json().catch(() => null);
  const comment = Array.isArray(payload?.data) ? payload.data.find((item) => item?.body === body) : null;
  if (!comment?.id) {
    throw new SmokeError("BROWSER_CLEANUP_COMMENT_NOT_FOUND", "브라우저 smoke 댓글을 같은 익명 세션에서 찾지 못했습니다.");
  }

  const deleteResponse = await fetch(new URL(`/api/comments/${encodeURIComponent(comment.id)}`, apiBaseUrl), {
    method: "DELETE",
    headers: {
      "x-silsigan-anon-id": anonymousSession.anonymousId,
      "x-silsigan-anon-proof": anonymousSession.proof,
    },
  }).catch(() => null);
  if (!deleteResponse?.ok) {
    throw new SmokeError("BROWSER_CLEANUP_COMMENT_FAILED", "브라우저 smoke 댓글 삭제에 실패했습니다.");
  }
}

async function findChromePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new SmokeError("CHROME_NOT_FOUND", "Chrome/Chromium 실행 파일을 찾지 못했습니다. --chrome-path 또는 SILSIGAN_CHROME_PATH를 지정하세요.");
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForFileText(path, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new SmokeError("CHROME_DEVTOOLS_PORT_TIMEOUT", "Chrome DevToolsActivePort 파일을 기다리다 시간이 초과됐습니다.");
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function removeDirectoryWithRetry(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw lastError;
}

async function fetchJsonFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new SmokeError("CHROME_DEVTOOLS_HTTP_FAILED", `Chrome DevTools endpoint가 ${response.status}로 응답했습니다.`);
  }

  return response.json();
}

function requiredUrl(value, code, message) {
  if (!value) {
    throw new SmokeError(code, message);
  }

  try {
    return new URL(value);
  } catch {
    throw new SmokeError(code, message);
  }
}

function numberOption(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function record(checks, name, status, message, details = {}) {
  checks.push({
    name,
    status,
    message,
    ...details,
  });
}

function publicErrorMessage(error) {
  if (error instanceof SmokeError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "알 수 없는 오류가 발생했습니다.";
}

function printHelp() {
  console.log(`Usage: node scripts/cloudflare-pages-smoke.mjs --pages-url=https://<pages-url> [--api-base-url=https://<worker-url>] [--mutating] [--report] [--field-report-photo] [--account-deletion]

Environment:
  SILSIGAN_STAGING_PAGES_URL
  SILSIGAN_STAGING_API_BASE_URL
  SILSIGAN_STAGING_BROWSER_MUTATION=1
  SILSIGAN_STAGING_BROWSER_REPORT=1   # requires mutation; creates place/comment/photo reports
  --field-report-photo                # local fixture mode; uploads one JPEG and links it to the field report
  --account-deletion                  # loopback + --mutating only; permanently deletes mock-owned content and verifies session rotation
  SILSIGAN_STAGING_BROWSER_SHARE_POST_ID=post_id_for_share_smoke
  SILSIGAN_CHROME_PATH=/path/to/chrome
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

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
const anonymousIdKey = "silsigan.anonymousId.v1";
const REGION_LABEL_BY_ID = {
  nationwide: "전국",
  seoul: "서울",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  gwangju: "광주",
  daejeon: "대전",
  ulsan: "울산",
  sejong: "세종",
  gyeonggi: "경기",
  gangwon: "강원",
  chungbuk: "충북",
  chungnam: "충남",
  jeonbuk: "전북",
  jeonnam: "전남",
  gyeongbuk: "경북",
  gyeongnam: "경남",
  jeju: "제주",
};

class SmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmokeError";
    this.code = code;
  }
}

class CdpClient {
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

async function main() {
  const { flags, options } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    printHelp();
    return;
  }

  const checks = [];
  const artifacts = {};
  const browserDiagnostics = { networkEvents: [], consoleMessages: [] };
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

    await mkdir(config.artifactDir, { recursive: true });
    const browser = await launchChrome(config.chromePath);
    cleanup = browser.cleanup;
    record(checks, "browser.launch", "pass", "headless Chrome DevTools 세션을 열었습니다.");

    const result = await runBrowserSmoke(browser.client, {
      pagesUrl,
      apiBaseUrl,
      placeId: config.placeId,
      placeName: config.placeName,
      regionId: config.regionId,
      sharePostId: config.sharePostId,
      fieldReportPhotoFile: config.fieldReportPhotoFile,
      adminFieldReport: config.adminFieldReport,
      adminToken: config.adminToken,
      mutating: config.mutating,
      report: config.report,
      requirePhoto: config.requirePhoto,
      timeoutMs: config.timeoutMs,
      checks,
      diagnostics: browserDiagnostics,
    });

    const artifactTimestamp = Date.now();
    const homeScreenshotPath = join(config.artifactDir, `pages-smoke-home-${artifactTimestamp}.png`);
    await writeFile(homeScreenshotPath, Buffer.from(result.homeScreenshotBase64, "base64"));
    artifacts.homeScreenshot = homeScreenshotPath;

    const mapScreenshotPath = join(config.artifactDir, `pages-smoke-map-${artifactTimestamp}.png`);
    await writeFile(mapScreenshotPath, Buffer.from(result.mapScreenshotBase64, "base64"));
    artifacts.mapScreenshot = mapScreenshotPath;

    const screenshotPath = join(config.artifactDir, `pages-smoke-${artifactTimestamp}.png`);
    await writeFile(screenshotPath, Buffer.from(result.screenshotBase64, "base64"));
    artifacts.screenshot = screenshotPath;

    if (result.adminScreenshotBase64) {
      const adminScreenshotPath = join(config.artifactDir, `pages-smoke-admin-${artifactTimestamp}.png`);
      await writeFile(adminScreenshotPath, Buffer.from(result.adminScreenshotBase64, "base64"));
      artifacts.adminScreenshot = adminScreenshotPath;
    }

    const networkPath = join(config.artifactDir, `pages-smoke-network-${artifactTimestamp}.json`);
    await writeFile(networkPath, JSON.stringify(result.networkEvents, null, 2), "utf8");
    artifacts.network = networkPath;

    const consolePath = join(config.artifactDir, `pages-smoke-console-${artifactTimestamp}.log`);
    await writeFile(consolePath, result.consoleMessages.join("\n"), "utf8");
    artifacts.console = consolePath;
  } catch (error) {
    record(checks, "harness", "fail", publicErrorMessage(error));
    if (browserDiagnostics.networkEvents.length > 0 || browserDiagnostics.consoleMessages.length > 0) {
      const artifactTimestamp = Date.now();
      const networkPath = join(config.artifactDir, `pages-smoke-network-failure-${artifactTimestamp}.json`);
      await writeFile(networkPath, JSON.stringify(browserDiagnostics.networkEvents, null, 2), "utf8");
      artifacts.network = networkPath;

      const consolePath = join(config.artifactDir, `pages-smoke-console-failure-${artifactTimestamp}.log`);
      await writeFile(consolePath, browserDiagnostics.consoleMessages.join("\n"), "utf8");
      artifacts.console = consolePath;
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
    fieldReportPhotoFile: options.get("field-report-photo-file") ?? env.SILSIGAN_STAGING_BROWSER_FIELD_REPORT_PHOTO_FILE ?? null,
    adminFieldReport: flags.has("admin-field-report") || env.SILSIGAN_STAGING_BROWSER_ADMIN_FIELD_REPORT === "1",
    adminToken: options.get("admin-token") ?? env.SILSIGAN_STAGING_BROWSER_ADMIN_TOKEN ?? null,
    timeoutMs: numberOption(options.get("timeout-ms") ?? env.SILSIGAN_STAGING_BROWSER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    mutating: flags.has("mutating") || env.SILSIGAN_STAGING_BROWSER_MUTATION === "1",
    report: flags.has("report") || env.SILSIGAN_STAGING_BROWSER_REPORT === "1",
    requirePhoto: flags.has("require-photo") || env.SILSIGAN_STAGING_BROWSER_REQUIRE_PHOTO === "1",
  };
}

async function runBrowserSmoke(client, config) {
  const networkEvents = config.diagnostics?.networkEvents ?? [];
  const consoleMessages = config.diagnostics?.consoleMessages ?? [];
  let adminScreenshotBase64 = null;

  client.on("Network.requestWillBeSent", (event) => {
    const requestEvent = {
      type: "request",
      method: event.request?.method,
      url: event.request?.url,
    };
    if (event.request?.method === "POST" && event.request?.url) {
      try {
        const requestUrl = new URL(event.request.url);
        if (requestUrl.pathname === "/api/admin/login") {
          requestEvent.adminLoginBodyPresent = typeof event.request.postData === "string" && event.request.postData.includes("token=");
        }
      } catch {
      }
    }
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
  await client.send("DOM.enable");
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
  }
  // The persisted first-visit effect is scheduled after hydration. Let that state
  // settle before deciding whether the onboarding sheet exists; otherwise the
  // sheet can appear only after we navigate back home and cover the bottom nav.
  await delay(250);
  await dismissOnboardingIfPresent(client, config.timeoutMs);
  await waitForEvaluate(
    client,
    `!document.querySelector('[aria-label="#실시간 첫 방문 안내"], [class*="onboardingOverlay"]')`,
    "onboarding.initialDismiss",
    config.timeoutMs,
  );
  record(config.checks, "onboarding.dismiss", "pass", "첫 방문 상태가 안정화된 뒤 안내를 닫고 V2 홈에서 지도로 이동할 준비를 마쳤습니다.");
  const homeScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await clickBottomNavButton(client, "지도");
  await waitForEvaluate(client, `document.querySelector('h1')?.textContent?.trim() === '지도'`, "bottomNav.mapInitial", config.timeoutMs);
  await waitForEvaluate(
    client,
    "Boolean(document.querySelector('[aria-label=\"클릭 가능한 전국 실시간 장소 지도\"], [aria-label=\"네이버 지도 기반 전국 실시간 장소 지도\"]'))",
    "map.surface",
    config.timeoutMs,
  );
  record(config.checks, "map.surface", "pass", "지도 surface가 렌더링됐습니다.");
  await assertMapSurfaceVisible(client, config.timeoutMs);
  record(config.checks, "map.visible", "pass", "지도 surface 크기와 내부 콘텐츠를 확인했습니다.");
  const mapScreenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await runMapControlChecks(client, config);

  if (config.apiBaseUrl) {
    const regionLabel = regionLabelForId(config.regionId);
    if (!regionLabel) {
      throw new SmokeError("REGION_NOT_SUPPORTED", `${config.regionId} 지역은 브라우저 스모크에서 지원하지 않습니다.`);
    }
    await clickHitTestedTextButton(client, regionLabel, { withinSelector: '[aria-label="지역 랭킹 선택"]' });
    await waitFor(
      () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/places", "GET", "regionId", config.regionId),
      "worker.placesRegionScope",
      config.timeoutMs,
    );
    record(config.checks, "worker.placesRegionScope", "pass", "지정한 지역 탭이 Worker 장소 목록 regionId 요청에 반영됐습니다.", {
      regionId: config.regionId,
    });
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/places"), "worker.placesRequest", config.timeoutMs);
    record(config.checks, "worker.placesRequest", "pass", "프론트 장소 목록이 Worker API base로 요청됐습니다.", { path: "/api/places" });
    const placeSearchQuery = config.placeName.slice(0, 3);
    await fillSearchInput(client, ["사진 올라온 장소 검색", "지도 장소 검색"], placeSearchQuery, { timeoutMs: config.timeoutMs });
    await waitFor(
      () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/places", "GET", "q", placeSearchQuery),
      "worker.placesSearchRequest",
      config.timeoutMs,
    );
    record(config.checks, "worker.placesSearchRequest", "pass", "지도 검색어가 Worker 장소 목록 q 파라미터로 전달됐습니다.", { q: placeSearchQuery });
    try {
      await waitFor(
        () => hasApiRequestWithSearchParam(networkEvents, config.apiBaseUrl, "/api/photos", "GET", "placeId", config.placeId),
        "worker.photosPlaceScope",
        config.timeoutMs,
      );
    } catch (error) {
      const photoRequests = networkEvents
        .filter((event) => event.type === "request" && event.method === "GET" && typeof event.url === "string")
        .map((event) => {
          try {
            const url = new URL(event.url);
            return url.pathname === "/api/photos" ? `${url.pathname}?${url.searchParams.toString()}` : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      throw new SmokeError("WORKER_PHOTO_SCOPE_MISSING", `${error.message} photoRequests=${JSON.stringify(photoRequests)}`);
    }
    record(config.checks, "worker.photosPlaceScope", "pass", "프론트 사진 목록이 Worker API base로 장소별 요청됐습니다.", { placeId: config.placeId });
  }

  const rankingState = await assertRankingPanelsVisible(client, config);
  record(config.checks, "rankings.visible", "pass", "지도 화면 안 TOP 10 랭킹 패널이 실제 후보 또는 명시적 정보 부족 상태로 렌더링됐습니다.", {
    state: rankingState.populated ? "populated" : "empty-current-evidence",
  });
  if (rankingState.populated) {
    await clickRankingPlace(client, config.placeName);
    await waitForEvaluate(client, `Boolean(document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)}))`, "rankings.detail", config.timeoutMs);
    record(config.checks, "rankings.detail", "pass", "랭킹 항목 클릭으로 장소 상세 시트를 브라우저에서 열었습니다.", { placeName: config.placeName });
    await clickAriaButton(client, "상세 닫기");
    await waitForEvaluate(client, `!document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)})`, "rankings.detailClose", config.timeoutMs);
  } else {
    record(config.checks, "rankings.detail", "skip", "현재 유효한 랭킹 후보가 없어 랭킹 항목 상세 클릭을 건너뜁니다.");
  }

  await clickMapMarker(client, config.placeName, config.timeoutMs);
  try {
    await waitForEvaluate(client, `Boolean(document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)}))`, "place.detail", config.timeoutMs);
  } catch (error) {
    const detailDiagnostic = await evaluate(client, `({
      url: location.href,
      detailOpen: Boolean(document.querySelector(${JSON.stringify(`[aria-label="${config.placeName} 상세 정보"]`)})),
      map: (() => { const element = document.querySelector('[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]'); if (!(element instanceof HTMLElement)) return null; const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label'), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) }; })(),
      markers: [...document.querySelectorAll('[aria-label="클릭 가능한 전국 실시간 장소 지도"] button, [aria-label="네이버 지도 기반 전국 실시간 장소 지도"] button')].slice(0, 12).map((button) => ({ label: button.getAttribute('aria-label'), visible: (() => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })() })),
    })`);
    const markerDiagnostic = await describeMapMarkerHitTest(client, config.placeName);
    throw new SmokeError("PLACE_DETAIL_NOT_OPEN", `${error.message} diagnostic=${JSON.stringify({ detail: detailDiagnostic, marker: markerDiagnostic })}`);
  }
  record(config.checks, "place.detail", "pass", "지도 마커 클릭으로 장소 상세 시트를 브라우저에서 열었습니다.", { placeName: config.placeName });

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

  if (config.mutating && config.apiBaseUrl) {
    adminScreenshotBase64 = await runMutatingBrowserChecks(client, config, networkEvents);
  } else {
    record(config.checks, "browser.mutation", "skip", "--mutating 또는 SILSIGAN_STAGING_BROWSER_MUTATION=1 이 없어 쓰기 UI smoke를 건너뜁니다.");
  }

  if (config.sharePostId) {
    await runSharePostChecks(client, config, networkEvents);
  } else {
    record(config.checks, "share.postPage", "skip", "--share-post-id 또는 SILSIGAN_STAGING_BROWSER_SHARE_POST_ID가 없어 공유 페이지 smoke를 건너뜁니다.");
    record(config.checks, "share.opengraphImage", "skip", "--share-post-id 또는 SILSIGAN_STAGING_BROWSER_SHARE_POST_ID가 없어 OG 이미지 smoke를 건너뜁니다.");
  }

  await runSharePlaceChecks(client, config, networkEvents);

  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });

  return {
    homeScreenshotBase64: homeScreenshot.data,
    mapScreenshotBase64: mapScreenshot.data,
    screenshotBase64: screenshot.data,
    adminScreenshotBase64,
    networkEvents,
    consoleMessages,
  };
}

export function regionLabelForId(regionId) {
  return REGION_LABEL_BY_ID[regionId] ?? null;
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

async function runSharePlaceChecks(client, config, networkEvents) {
  const shareUrl = new URL(`/share/place/${encodeURIComponent(config.placeId)}`, config.pagesUrl);
  await client.send("Page.navigate", { url: shareUrl.toString() });
  await waitFor(() => hasPageResponse(networkEvents, shareUrl), "share.placePage.response", config.timeoutMs);
  await waitForEvaluate(
    client,
    `
      (() => {
        const card = document.querySelector('[aria-label="#실시간 장소 공유 카드"]');
        const action = card?.querySelector('a[href*="?place="]');
        return card instanceof HTMLElement &&
          card.innerText.includes(${JSON.stringify(config.placeName)}) &&
          card.innerText.includes('현재 상태는 앱에서 출처와 관측 시각을 확인한 뒤 판단할 수 있습니다.') &&
          action instanceof HTMLAnchorElement;
      })()
    `,
    "share.placePage",
    config.timeoutMs,
  );
  record(config.checks, "share.placePage", "pass", "장소 공유 페이지가 현재 상태를 과장하지 않는 중립 안내로 렌더링됐습니다.", { placeId: config.placeId });

  const imageResult = await evaluate(
    client,
    `
      (async () => {
        const response = await fetch(${JSON.stringify(`${shareUrl.pathname}/opengraph-image`)}, { cache: 'no-store' });
        const blob = await response.blob();
        return {
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          byteSize: blob.size,
        };
      })()
    `,
  );
  if (imageResult?.ok !== true || imageResult.contentType !== "image/png" || !(imageResult.byteSize > 0)) {
    throw new SmokeError("PLACE_SHARE_OG_IMAGE_FAILED", `장소 공유 OG 이미지 응답이 올바르지 않습니다. detail=${JSON.stringify(imageResult)}`);
  }
  record(config.checks, "share.placeOgImage", "pass", "장소 공유 OG 이미지가 image/png로 렌더링됐습니다.", {
    placeId: config.placeId,
    byteSize: imageResult.byteSize,
  });
}

async function runMutatingBrowserChecks(client, config, networkEvents) {
  const anonymousId = await readBrowserAnonymousId(client);
  let adminScreenshotBase64 = null;

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
    await createFieldReportFromBrowser(client, config, networkEvents);
    if (config.adminFieldReport) {
      adminScreenshotBase64 = await runAdminFieldReportChecks(client, config, networkEvents);
    }
  } else {
    record(config.checks, "reports.create", "skip", "--report 없이 실제 신고 생성은 실행하지 않습니다.");
  }

  await cleanupLike(config.apiBaseUrl, config.placeId, anonymousId);
  await cleanupComment(config.apiBaseUrl, config.placeId, commentBody, anonymousId);
  record(config.checks, "browser.cleanup", "pass", "브라우저 smoke 좋아요/댓글을 같은 익명 세션으로 정리했습니다.");
  return adminScreenshotBase64;
}

async function assertMapSurfaceVisible(client, timeoutMs) {
  await waitForEvaluate(
    client,
    `
      (() => {
        const maps = [...document.querySelectorAll('[aria-label="클릭 가능한 전국 실시간 장소 지도"], [aria-label="네이버 지도 기반 전국 실시간 장소 지도"]')]
          .filter((map) => map instanceof HTMLElement);
        return maps.some((map) => {
          const rect = map.getBoundingClientRect();
          const hasInteractiveMarker = [...map.querySelectorAll('button')].some((button) => {
            const markerRect = button.getBoundingClientRect();
            const label = button.getAttribute('aria-label') ?? '';
            return markerRect.width > 0 && markerRect.height > 0 && (button.hasAttribute('data-silsigan-place-id') || label.includes('상세'));
          });
          return rect.width >= 240 && rect.height >= 140 && hasInteractiveMarker;
        });
      })()
    `,
    "map.visible",
    timeoutMs,
  );
}

async function assertRankingPanelsVisible(client, config) {
  try {
    await waitForEvaluate(
      client,
      `
        (() => {
          const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
          if (!(grid instanceof HTMLElement)) return false;
          const text = grid.innerText;
          const buttons = [...grid.querySelectorAll('button')];
          const populated = buttons.some((button) => button.textContent?.includes(${JSON.stringify(config.placeName)}));
          const explicitEmpty = buttons.length === 0 && text.includes('아직 순위를 만들 현장 정보가 없어요');
          return text.includes('지도 화면 안 TOP 10') &&
            !text.includes('전국 TOP 10') &&
            (populated || explicitEmpty);
        })()
      `,
      "rankings.visible",
      config.timeoutMs,
    );
  } catch (error) {
    const detail = await evaluate(
      client,
      `
        (() => {
          const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
          return grid instanceof HTMLElement
            ? { text: grid.innerText.slice(0, 800), buttons: [...grid.querySelectorAll('button')].map((button) => button.textContent?.trim()).filter(Boolean) }
            : { text: null, buttons: [] };
        })()
      `,
    );
    throw new SmokeError("RANKINGS_NOT_VISIBLE", `${error.message} detail=${JSON.stringify(detail)}`);
  }

  return evaluate(
    client,
    `
      (() => {
        const grid = document.querySelector('[aria-label="실시간 장소 랭킹"]');
        const buttons = grid instanceof HTMLElement ? [...grid.querySelectorAll('button')] : [];
        return { populated: buttons.some((button) => button.textContent?.includes(${JSON.stringify(config.placeName)})) };
      })()
    `,
  );
}

async function runMapControlChecks(client, config) {
  await assertTextButtonAboveBottomNav(client, "교통 켜기");
  await assertTextButtonAboveBottomNav(client, "이 지역 다시 검색");
  await assertTextButtonAboveBottomNav(client, "현재 위치");
  record(config.checks, "map.controlsUncovered", "pass", "초기 지도 도구와 현재 위치 버튼이 하단 내비게이션에 가려지지 않습니다.");
  await assertBottomNavOpaque(client, config.timeoutMs);
  record(config.checks, "layout.bottomNavOpaque", "pass", "하단 내비게이션이 뒤쪽 버튼을 비쳐 보이게 하지 않습니다.");

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
    `document.body.innerText.includes('현재 지도 화면 기준으로 다시 불러왔습니다.') || document.body.innerText.includes('현재 검색어 기준으로 장소를 다시 불러왔습니다.')`,
    "map.requeryButton",
    config.timeoutMs,
  );
  record(config.checks, "map.requeryButton", "pass", "이 지역 다시 검색 버튼 클릭 후 토스트가 갱신됐습니다.");

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
        const overlay = document.querySelector('[aria-label="#실시간 첫 방문 안내"], [class*="onboardingOverlay"]');
        if (!(overlay instanceof HTMLElement)) return false;
        const buttons = [...overlay.querySelectorAll('button')].filter((candidate) => !candidate.disabled);
        const button =
          buttons.find((candidate) => candidate.textContent?.trim() === '바로 둘러보기') ??
          buttons.find((candidate) => candidate.getAttribute('aria-label')?.includes('닫기')) ??
          buttons.find((candidate) => /둘러보기|닫기|시작|확인/.test(candidate.textContent?.trim() ?? '')) ??
          buttons[0];
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()
    `,
  );

  if (dismissed) {
    await waitForEvaluate(
      client,
      `!document.querySelector('[aria-label="#실시간 첫 방문 안내"], [class*="onboardingOverlay"]')`,
      "onboarding.dismiss",
      timeoutMs,
    );
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

async function launchChrome(chromePathInput) {
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
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      await waitForChildExit(child, 2_000);
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

export async function clickHitTestedTextButton(client, text, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 2_000;
  try {
    await waitFor(
      () =>
        clickHitTestedButton(client, {
          text,
          exact: Boolean(options.exact),
          withinSelector: options.withinSelector ?? null,
        }),
      `button.${text}.clickable`,
      timeoutMs,
    );
  } catch {
    const detail = await describeTextButtonHitTest(client, text, {
      exact: Boolean(options.exact),
      withinSelector: options.withinSelector ?? null,
    });
    throw new SmokeError("BUTTON_NOT_CLICKABLE", `${text} 버튼을 실제 클릭 가능한 위치에서 누를 수 없습니다. detail=${JSON.stringify(detail)}`);
  }
}

async function describeTextButtonHitTest(client, text, { exact = false, withinSelector = null } = {}) {
  return evaluate(
    client,
    `
      (() => {
        const root = ${withinSelector ? `document.querySelector(${JSON.stringify(withinSelector)})` : "document"};
        if (!root) return { viewport: { width: window.innerWidth, height: window.innerHeight }, buttons: [] };
        const buttons = [...root.querySelectorAll('button')].filter((button) => {
          const buttonText = button.textContent?.trim() ?? '';
          return ${JSON.stringify(exact)} ? buttonText === ${JSON.stringify(text)} : buttonText.includes(${JSON.stringify(text)});
        });
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          activeHeading: document.querySelector('h1')?.textContent?.trim() ?? null,
          onboardingVisible: Boolean(document.querySelector('[aria-label="#실시간 첫 방문 안내"], [class*="onboardingOverlay"]')),
          buttons: buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const target = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
              ? document.elementFromPoint(x, y)
              : null;
            return {
              text: button.textContent?.trim() ?? '',
              disabled: button.disabled,
              rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
              hitTag: target instanceof HTMLElement ? target.tagName : null,
              hitText: target instanceof HTMLElement ? target.textContent?.trim()?.slice(0, 120) ?? null : null,
              hitClass: target instanceof HTMLElement ? String(target.className).slice(0, 120) : null,
              hitAriaLabel: target instanceof HTMLElement ? target.getAttribute('aria-label') : null,
              hitConnected: target instanceof Node ? target.isConnected : false,
              documentContainsHit: target instanceof Node ? document.contains(target) : false,
              buttonContainsHit: target instanceof Node ? button.contains(target) : false,
            };
          }),
        };
      })()
    `,
  );
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

async function fillInputBySelector(client, selector, value) {
  const result = await evaluate(
    client,
    `
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
        return true;
      })()
    `,
  );
  if (result !== true) {
    throw new SmokeError("INPUT_NOT_FOUND", `${selector} 입력창을 찾지 못했습니다.`);
  }
}

export async function fillSearchInput(client, label, value, options = {}) {
  const labels = Array.isArray(label) ? label : [label];
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 2_000;
  try {
    await waitFor(
      () =>
        evaluate(
          client,
          `
            (() => {
              const labels = ${JSON.stringify(labels)};
              const input = [...document.querySelectorAll('input')].find((candidate) =>
                labels.includes(candidate.getAttribute('aria-label') ?? '')
              );
              if (!(input instanceof HTMLInputElement)) return false;
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setter?.call(input, ${JSON.stringify(value)});
              input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
              return true;
            })()
          `,
        ),
      `input.${labels.join("|")}.ready`,
      timeoutMs,
    );
  } catch {
    throw new SmokeError("INPUT_NOT_FOUND", `${labels.join(" 또는 ")} 입력창을 찾지 못했습니다.`);
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
        const button = [...document.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label')?.endsWith('사진 확인'));
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
  const result = await clickHitTestedButton(client, {
    ariaIncludes: "사진 삭제",
  });
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
  if (config.fieldReportPhotoFile) {
    await setFileInputFiles(client, 'section[aria-label="사진 선택"] input[type="file"]', [config.fieldReportPhotoFile]);
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/photos/upload-url", "POST"), "fieldReports.photoUploadTicket", config.timeoutMs);
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/photos/upload", "PUT"), "fieldReports.photoUploadBinary", config.timeoutMs);
    await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/photos/complete", "POST"), "fieldReports.photoUploadComplete", config.timeoutMs);
    await waitForEvaluate(client, "document.body.innerText.includes('사진 업로드 완료')", "fieldReports.photoUploadReady", config.timeoutMs);
    record(config.checks, "fieldReports.photoUpload", "pass", "현장 제보 화면에서 synthetic 사진이 Worker 업로드 경로로 처리됐습니다.");
  }
  await clickHitTestedTextButton(client, "혼잡", { exact: true });
  await fillTextareaById(client, "reportText", `browser field report ${new Date().toISOString()}`);
  await clickHitTestedTextButton(client, config.fieldReportPhotoFile ? "지금컷 올리기" : "사진 없이 상태만 올리기", { exact: true });
  await waitFor(() => hasApiRequest(networkEvents, config.apiBaseUrl, "/api/reports", "POST"), "fieldReports.create", config.timeoutMs);
  record(config.checks, "fieldReports.create", "pass", "상태 제보 작성 UI가 Worker /api/reports로 POST 됐습니다.");
  if (config.fieldReportPhotoFile) {
    record(config.checks, "fieldReports.photoAttachment", "pass", "현장 제보 POST가 사진 첨부 모드로 제출됐습니다.");
  }
}

async function runAdminFieldReportChecks(client, config, networkEvents) {
  if (!config.adminToken) {
    throw new SmokeError("ADMIN_TOKEN_REQUIRED", "관리자 현장 제보 smoke에는 --admin-token 또는 SILSIGAN_STAGING_BROWSER_ADMIN_TOKEN이 필요합니다.");
  }

  const publicReportsUrl = new URL(`/api/reports?placeId=${encodeURIComponent(config.placeId)}`, config.apiBaseUrl).toString();
  const pendingPublicState = await readBrowserFieldReportState(client, publicReportsUrl);
  if (pendingPublicState.ok !== true || pendingPublicState.count !== 0) {
    throw new SmokeError("FIELD_REPORT_PUBLIC_BEFORE_APPROVAL", `승인 전 현장 제보가 공개되었습니다. detail=${JSON.stringify(pendingPublicState)}`);
  }
  record(config.checks, "admin.fieldReportPrivate", "pass", "승인 전 현장 제보가 공개 목록과 현재 판단에서 제외됐습니다.");

  const loginUrl = new URL("/admin/login", config.pagesUrl);
  await client.send("Page.navigate", { url: loginUrl.toString() });
  await waitFor(() => hasPageResponse(networkEvents, loginUrl), "admin.loginPage.response", config.timeoutMs);
  await waitForEvaluate(client, "Boolean(document.querySelector('form[action=\"/api/admin/login\"] input[name=\"token\"]'))", "admin.loginPage", config.timeoutMs);
  record(config.checks, "admin.loginPage", "pass", "관리자 로그인 화면을 브라우저에서 열었습니다.");

  await fillInputBySelector(client, 'form[action="/api/admin/login"] input[name="token"]', config.adminToken);
  const adminInputLength = await evaluate(client, "document.querySelector('form[action=\"/api/admin/login\"] input[name=\"token\"]')?.value?.length ?? 0");
  if (adminInputLength !== config.adminToken.length) {
    throw new SmokeError("ADMIN_TOKEN_INPUT_FAILED", `관리자 토큰 입력 길이가 예상과 다릅니다. length=${adminInputLength}`);
  }
  await clickHitTestedTextButton(client, "운영 큐 열기", { exact: true, withinSelector: 'form[action="/api/admin/login"]' });
  await waitFor(() => hasApiRequest(networkEvents, config.pagesUrl.origin, "/api/admin/login", "POST"), "admin.loginSubmit", config.timeoutMs);
  record(config.checks, "admin.loginSubmit", "pass", "관리자 토큰 제출이 Next 인증 route로 POST 됐습니다.");
  try {
    await waitForEvaluate(client, "Boolean(document.querySelector('[aria-labelledby=\"field-report-queue-heading\"]'))", "admin.fieldReportQueue", config.timeoutMs);
  } catch (error) {
    const snapshot = await evaluate(client, "({ url: location.href, title: document.title, text: document.body?.innerText?.slice(0, 800) ?? '', forms: document.forms.length, tokenValueLength: document.querySelector('form[action=\"/api/admin/login\"] input[name=\"token\"]')?.value?.length ?? 0 })");
    const loginRequests = networkEvents.filter((event) => event.type === "request" && typeof event.url === "string" && new URL(event.url).pathname === "/api/admin/login").map((event) => ({ method: event.method, adminLoginBodyPresent: event.adminLoginBodyPresent }));
    const loginResponses = networkEvents.filter((event) => event.type === "response" && typeof event.url === "string" && new URL(event.url).pathname === "/api/admin/login").map((event) => event.status);
    throw new SmokeError("ADMIN_FIELD_REPORT_QUEUE_MISSING", `${error.message} snapshot=${JSON.stringify(snapshot)} loginRequests=${JSON.stringify(loginRequests)} loginResponses=${JSON.stringify(loginResponses)}`);
  }
  await waitForEvaluate(client, `document.body.innerText.includes(${JSON.stringify(config.placeName)}) && document.body.innerText.includes('검수 대기')`, "admin.fieldReportQueue.data", config.timeoutMs);
  await waitForEvaluate(
    client,
    `document.querySelector('[aria-labelledby="field-report-queue-heading"]')?.getAttribute('data-silsigan-hydrated') === 'true'`,
    "admin.fieldReportQueue.interactive",
    config.timeoutMs,
  );
  record(config.checks, "admin.fieldReportQueue", "pass", "관리자 현장 제보 검수 큐에 pending 제보가 표시됐습니다.");

  await clickHitTestedTextButton(client, "승인", { exact: true, withinSelector: 'section[aria-labelledby="field-report-queue-heading"]' });
  try {
    await waitFor(() => hasApiRequest(networkEvents, config.pagesUrl.origin, "/api/admin/field-reports", "POST"), "admin.fieldReportApproval.request", config.timeoutMs);
  } catch (error) {
    const snapshot = await evaluate(client, "({ url: location.href, text: document.body?.innerText?.slice(0, 1200) ?? '', buttons: [...document.querySelectorAll('[aria-labelledby=\\\"field-report-queue-heading\\\"] button')].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })) })");
    const recentRequests = networkEvents.filter((event) => event.type === "request").slice(-12).map((event) => ({ method: event.method, url: event.url }));
    throw new SmokeError("ADMIN_FIELD_REPORT_APPROVAL_REQUEST_MISSING", `${error.message} snapshot=${JSON.stringify(snapshot)} recentRequests=${JSON.stringify(recentRequests)}`);
  }
  await waitForEvaluate(client, "document.body.innerText.includes('현재 장소 판단에 반영됩니다')", "admin.fieldReportApproval", config.timeoutMs);
  record(config.checks, "admin.fieldReportApproval", "pass", "관리자 승인 후 현장 제보가 공개 상태 반영 안내를 표시했습니다.");

  const publicState = await readBrowserFieldReportState(client, publicReportsUrl);
  if (publicState.ok !== true || publicState.count !== 1) {
    throw new SmokeError("FIELD_REPORT_PUBLIC_AFTER_APPROVAL", `승인 후 현장 제보가 공개 목록에 나타나지 않았습니다. detail=${JSON.stringify(publicState)}`);
  }
  record(config.checks, "admin.fieldReportPublic", "pass", "관리자 승인 후 현장 제보가 공개 API 목록에 나타났습니다.");

  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  return screenshot.data;
}

async function readBrowserFieldReportState(client, url) {
  return evaluate(
    client,
    `(async () => {
      const response = await fetch(${JSON.stringify(url)}, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      const reports = Array.isArray(payload?.data) ? payload.data : [];
      return { ok: response.ok, status: response.status, count: reports.length };
    })()`,
  );
}

async function setFileInputFiles(client, selector, files) {
  const documentResult = await client.send("DOM.getDocument", { depth: -1, pierce: true });
  const nodeResult = await client.send("DOM.querySelector", {
    nodeId: documentResult.root.nodeId,
    selector,
  });
  if (!nodeResult.nodeId) {
    throw new SmokeError("FILE_INPUT_NOT_FOUND", `${selector} 파일 입력을 찾지 못했습니다.`);
  }

  await client.send("DOM.setFileInputFiles", {
    nodeId: nodeResult.nodeId,
    files,
  });
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

async function readBrowserAnonymousId(client) {
  const value = await evaluate(client, `window.localStorage.getItem(${JSON.stringify(anonymousIdKey)})`);
  if (typeof value !== "string" || value.length === 0) {
    throw new SmokeError("ANON_ID_NOT_FOUND", "브라우저 익명 세션 ID를 찾지 못했습니다.");
  }

  return value;
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

async function cleanupLike(apiBaseUrl, placeId, anonymousId) {
  await fetch(new URL(`/api/places/${encodeURIComponent(placeId)}/like`, apiBaseUrl), {
    method: "DELETE",
    headers: {
      "x-silsigan-anon-id": anonymousId,
    },
  }).catch(() => {});
}

async function cleanupComment(apiBaseUrl, placeId, body, anonymousId) {
  const response = await fetch(new URL(`/api/comments?placeId=${encodeURIComponent(placeId)}&limit=20`, apiBaseUrl), {
    headers: {
      "x-silsigan-anon-id": anonymousId,
    },
  }).catch(() => null);
  if (!response?.ok) {
    return;
  }

  const payload = await response.json().catch(() => null);
  const comment = Array.isArray(payload?.data) ? payload.data.find((item) => item?.body === body) : null;
  if (!comment?.id) {
    return;
  }

  await fetch(new URL(`/api/comments/${encodeURIComponent(comment.id)}`, apiBaseUrl), {
    method: "DELETE",
    headers: {
      "x-silsigan-anon-id": anonymousId,
    },
  }).catch(() => {});
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
    return;
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
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
  console.log(`Usage: node scripts/cloudflare-pages-smoke.mjs --pages-url=https://<pages-url> [--api-base-url=https://<worker-url>] [--mutating] [--report]

Environment:
  SILSIGAN_STAGING_PAGES_URL
  SILSIGAN_STAGING_API_BASE_URL
  SILSIGAN_STAGING_BROWSER_MUTATION=1
  SILSIGAN_STAGING_BROWSER_REPORT=1   # requires mutation; creates place/comment/photo reports
  SILSIGAN_STAGING_BROWSER_SHARE_POST_ID=post_id_for_share_smoke
  SILSIGAN_STAGING_BROWSER_FIELD_REPORT_PHOTO_FILE=/tmp/silsigan-field-report.jpg
  SILSIGAN_CHROME_PATH=/path/to/chrome
`);
}

function isCliEntryPoint() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  findFreePort,
  startNextDev,
  stopNextDev,
  waitForHttpOk,
} from "./cloudflare-pages-local-report-smoke.mjs";
import { launchChrome } from "./cloudflare-pages-smoke.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ARTIFACT_DIR = "artifacts/static-directory-failover";
const STATIC_DIRECTORY_PATH = "/silsigan/snapshots/nationwide-places.v1.json";

class DirectorySmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectorySmokeError";
    this.code = code;
  }
}

if (isCliEntryPoint()) {
  await main();
}

export function validateDirectoryFailoverNetwork({
  networkEvents,
  pagesUrl,
  apiBaseUrl,
  baselineApiRequestCount,
}) {
  const pagesOrigin = new URL(pagesUrl).origin;
  const apiOrigin = new URL(apiBaseUrl).origin;
  const staticAssetRequests = networkEvents.filter((event) => {
    const url = new URL(event.url);
    return url.origin === pagesOrigin && url.pathname === STATIC_DIRECTORY_PATH;
  });
  const apiRequests = networkEvents.filter((event) => new URL(event.url).origin === apiOrigin);
  const providerRequests = networkEvents.filter((event) => {
    const hostname = new URL(event.url).hostname;
    return hostname === "oapi.map.naver.com" || hostname.endsWith(".map.naver.net") || hostname === "nrbe.map.naver.net";
  });
  const analyticsRequests = apiRequests.filter((event) => new URL(event.url).pathname === "/api/analytics/events");
  const postFallbackApiRequestCount = Math.max(0, apiRequests.length - baselineApiRequestCount);

  if (staticAssetRequests.length === 0) {
    throw new DirectorySmokeError("STATIC_DIRECTORY_NOT_REQUESTED", "브라우저가 정적 기본 장소 목록을 요청하지 않았습니다.");
  }
  if (postFallbackApiRequestCount !== 0) {
    throw new DirectorySmokeError("POST_FALLBACK_API_REQUEST_DETECTED", `보호 모드 전환 뒤 API 요청 ${postFallbackApiRequestCount}건이 추가됐습니다.`);
  }
  if (providerRequests.length > 0) {
    throw new DirectorySmokeError("NAVER_PROVIDER_REQUEST_DETECTED", "보호 모드에서 NAVER 지도 provider 요청이 발생했습니다.");
  }
  if (analyticsRequests.length > 0) {
    throw new DirectorySmokeError("ANALYTICS_REQUEST_DETECTED", "보호 모드에서 analytics 요청이 발생했습니다.");
  }

  return {
    staticAssetRequestCount: staticAssetRequests.length,
    baselineApiRequestCount,
    postFallbackApiRequestCount,
    providerRequestCount: providerRequests.length,
    analyticsRequestCount: analyticsRequests.length,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const timeoutMs = numberOption(options.get("timeout-ms"), DEFAULT_TIMEOUT_MS);
  const artifactDir = options.get("artifact-dir") ?? DEFAULT_ARTIFACT_DIR;
  const chromePath = options.get("chrome-path");
  const pagesPort = numberOption(options.get("pages-port"), await findFreePort());
  const failingApi = await startFailingApi();
  const pagesUrl = `http://127.0.0.1:${pagesPort}`;
  const networkEvents = [];
  let nextDev = null;
  let browser = null;

  try {
    nextDev = await startNextDev(pagesPort, failingApi.url, {
      next: `directory-next-${randomUUID()}`,
      worker: `directory-worker-${randomUUID()}`,
    });
    await waitForHttpOk(pagesUrl, "directory-failover.next", timeoutMs);

    browser = await launchChrome(chromePath);
    browser.client.on("Network.requestWillBeSent", ({ request }) => {
      if (!request?.url?.startsWith("http")) return;
      networkEvents.push({
        method: request.method ?? "GET",
        url: request.url,
        at: new Date().toISOString(),
      });
    });
    await Promise.all([
      browser.client.send("Network.enable"),
      browser.client.send("Page.enable"),
      browser.client.send("Runtime.enable"),
      browser.client.send("Page.addScriptToEvaluateOnNewDocument", {
        source: 'window.localStorage.setItem("silsigan.firstVisitSeen.v1", "true");',
      }),
    ]);
    await browser.client.send("Page.navigate", { url: pagesUrl });

    await waitForExpression(
      browser.client,
      'document.body?.innerText.includes("기본 장소 목록") && document.body?.innerText.includes("광안리해수욕장")',
      timeoutMs,
      "DIRECTORY_MODE_NOT_VISIBLE",
    );
    const initialText = await bodyText(browser.client);
    assertIncludes(initialText, "기본 장소 · 실시간 근거 없음", "DIRECTORY_TRUTH_COPY_MISSING");
    assertExcludes(initialText, "샘플 미리보기", "SAMPLE_COPY_VISIBLE");

    await delay(500);
    const baselineApiRequestCount = countOriginRequests(networkEvents, failingApi.url);

    await clickBottomNavigation(browser.client, "지도");
    await waitForExpression(
      browser.client,
      'document.body?.innerText.includes("기본 장소 지도") && document.body?.innerText.includes("모든 상태는 ‘최근 확인 정보 없음’")',
      timeoutMs,
      "STATIC_MAP_NOT_VISIBLE",
    );
    const mapText = await bodyText(browser.client);
    assertIncludes(mapText, "교통 연결 중단", "TRAFFIC_GUARD_COPY_MISSING");

    await clickBottomNavigation(browser.client, "검색");
    await setSearchInput(browser.client, "광안리");
    await waitForExpression(
      browser.client,
      'document.body?.innerText.includes("보호 모드에서는 외부 검색을 호출하지 않습니다")',
      timeoutMs,
      "EXTERNAL_SEARCH_GUARD_COPY_MISSING",
    );

    await clickBottomNavigation(browser.client, "올리기");
    await waitForExpression(
      browser.client,
      'document.body?.innerText.includes("실시간 API 보호 중에는 장소 위치만 볼 수 있습니다")',
      timeoutMs,
      "WRITE_GUARD_COPY_MISSING",
    );
    await delay(1_000);

    const networkValidation = validateDirectoryFailoverNetwork({
      networkEvents,
      pagesUrl,
      apiBaseUrl: failingApi.url,
      baselineApiRequestCount,
    });
    const screenshot = await browser.client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const timestamp = Date.now();
    const screenshotPath = join(artifactDir, `static-directory-failover-${timestamp}.png`);
    const networkPath = join(artifactDir, `static-directory-failover-network-${timestamp}.json`);
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([
      writeFile(screenshotPath, Buffer.from(screenshot.data, "base64")),
      writeFile(networkPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        storesRequestBodies: false,
        events: networkEvents.map((event) => ({
          method: event.method,
          url: safeNetworkUrl(event.url),
          at: event.at,
        })),
      }, null, 2)),
    ]);

    console.log(JSON.stringify({
      ok: true,
      mode: "directory",
      placeCount: 5,
      liveClaimsDisplayed: false,
      networkValidation,
      failingApiObservedRequests: failingApi.requests.length,
      artifacts: { screenshot: screenshotPath, network: networkPath },
    }, null, 2));
  } catch (error) {
    const nextDiagnostics = nextDev
      ? { stdout: nextDev.stdout().slice(-4_000), stderr: nextDev.stderr().slice(-4_000) }
      : null;
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof DirectorySmokeError ? error.code : "DIRECTORY_SMOKE_FAILED",
      message: error instanceof Error ? error.message : "Unknown directory smoke failure",
      nextDiagnostics,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser?.cleanup().catch(() => undefined);
    await stopNextDev(nextDev);
    await failingApi.close();
  }
}

async function startFailingApi() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "GET", url: request.url ?? "/" });
    request.resume();
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type, x-silsigan-anonymous-id, x-silsigan-anonymous-proof");
    response.setHeader("access-control-allow-methods", "GET, HEAD, OPTIONS, POST, PATCH, DELETE");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      success: false,
      error: { code: "WORKER_DAILY_LIMIT_EXHAUSTED", message: "Simulated Worker exhaustion" },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function clickBottomNavigation(client, label) {
  const clicked = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('nav[aria-label="주요 화면"] button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) {
    throw new DirectorySmokeError("BOTTOM_NAV_NOT_FOUND", `${label} 하단 탐색 버튼을 찾지 못했습니다.`);
  }
}

async function setSearchInput(client, value) {
  const changed = await evaluate(client, `(() => {
    const input = document.querySelector('input[aria-label="장소, 해시태그, 지역 검색"]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) {
    throw new DirectorySmokeError("SEARCH_INPUT_NOT_FOUND", "보호 모드 검색 입력을 찾지 못했습니다.");
  }
}

async function bodyText(client) {
  return evaluate(client, "document.body?.innerText ?? ''");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new DirectorySmokeError("BROWSER_EVALUATION_FAILED", "브라우저 검증식을 실행하지 못했습니다.");
  }
  return result.result?.value;
}

async function waitForExpression(client, expression, timeoutMs, code) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new DirectorySmokeError(code, `브라우저 조건이 ${timeoutMs}ms 안에 충족되지 않았습니다.`);
}

function assertIncludes(value, expected, code) {
  if (!value.includes(expected)) {
    throw new DirectorySmokeError(code, `필수 보호 문구가 없습니다: ${expected}`);
  }
}

function assertExcludes(value, forbidden, code) {
  if (value.includes(forbidden)) {
    throw new DirectorySmokeError(code, `보호 모드에 금지 문구가 표시됐습니다: ${forbidden}`);
  }
}

function countOriginRequests(events, url) {
  const origin = new URL(url).origin;
  return events.filter((event) => new URL(event.url).origin === origin).length;
}

function safeNetworkUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function parseOptions(args) {
  const options = new Map();
  for (const arg of args) {
    if (!arg.startsWith("--") || !arg.includes("=")) continue;
    const [key, ...valueParts] = arg.slice(2).split("=");
    options.set(key, valueParts.join("="));
  }
  return options;
}

function numberOption(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isCliEntryPoint() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

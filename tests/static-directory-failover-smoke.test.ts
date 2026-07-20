import assert from "node:assert/strict";
import test from "node:test";
import { validateDirectoryFailoverNetwork } from "../scripts/static-directory-failover-smoke.mjs";

const pagesUrl = "http://127.0.0.1:3000";
const apiBaseUrl = "http://127.0.0.1:4319";

function event(url: string, method = "GET") {
  return { url, method, at: "2026-07-20T00:00:00.000Z" };
}

test("directory failover harness accepts one initial API failure and no post-fallback provider traffic", () => {
  const result = validateDirectoryFailoverNetwork({
    pagesUrl,
    apiBaseUrl,
    baselineApiRequestCount: 1,
    networkEvents: [
      event(`${apiBaseUrl}/api/config`),
      event(`${pagesUrl}/silsigan/snapshots/nationwide-places.v1.json`),
      event(`${pagesUrl}/_next/static/chunks/app.js`),
    ],
  });

  assert.deepEqual(result, {
    staticAssetRequestCount: 1,
    baselineApiRequestCount: 1,
    postFallbackApiRequestCount: 0,
    providerRequestCount: 0,
    analyticsRequestCount: 0,
  });
});

test("directory failover harness rejects post-fallback API, analytics, NAVER, and missing-static regressions", () => {
  const baseEvents = [
    event(`${apiBaseUrl}/api/config`),
    event(`${pagesUrl}/silsigan/snapshots/nationwide-places.v1.json`),
  ];

  assert.throws(
    () => validateDirectoryFailoverNetwork({
      pagesUrl,
      apiBaseUrl,
      baselineApiRequestCount: 1,
      networkEvents: [...baseEvents, event(`${apiBaseUrl}/api/places`)],
    }),
    /보호 모드 전환 뒤 API 요청/,
  );
  assert.throws(
    () => validateDirectoryFailoverNetwork({
      pagesUrl,
      apiBaseUrl,
      baselineApiRequestCount: 2,
      networkEvents: [...baseEvents, event(`${apiBaseUrl}/api/analytics/events`, "POST")],
    }),
    /analytics 요청/,
  );
  assert.throws(
    () => validateDirectoryFailoverNetwork({
      pagesUrl,
      apiBaseUrl,
      baselineApiRequestCount: 1,
      networkEvents: [...baseEvents, event("https://oapi.map.naver.com/openapi/v3/maps.js")],
    }),
    /NAVER 지도 provider 요청/,
  );
  assert.throws(
    () => validateDirectoryFailoverNetwork({
      pagesUrl,
      apiBaseUrl,
      baselineApiRequestCount: 1,
      networkEvents: [event(`${apiBaseUrl}/api/config`)],
    }),
    /정적 기본 장소 목록을 요청하지 않았습니다/,
  );
});

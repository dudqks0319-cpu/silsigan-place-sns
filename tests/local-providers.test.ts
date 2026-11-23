import assert from "node:assert/strict";
import test from "node:test";
import { createLocalProviders } from "../src/features/local-live/server/index.ts";
import { airTimestamp } from "../src/features/local-live/server/air-quality.ts";
import { kmaBase, kmaTimestamp, toKmaGrid } from "../src/features/local-live/server/weather.ts";
import type { Region } from "../src/features/local-live/types.ts";

const region: Region = { id: "seoul", name: "서울", province: "서울특별시", latitude: 37.5665, longitude: 126.978, tagline: "서울" };
const fixedNow = () => new Date("2026-11-24T01:50:00.000Z"); // 10:50 KST

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function weatherRows(values: Record<string, unknown>, date = "20261124", time = "1000") {
  return Object.entries(values).map(([category, obsrValue]) => ({ category, obsrValue, baseDate: date, baseTime: time, nx: 60, ny: 127 }));
}

function kmaPayload(items: unknown[]) {
  return { response: { header: { resultCode: "00" }, body: { items: { item: items } } } };
}

function forecastRows(hour: string, values: Record<string, unknown>, date = "20261124") {
  return Object.entries(values).map(([category, fcstValue]) => ({ category, fcstValue, baseDate: "20261124", baseTime: "1030", fcstDate: date, fcstTime: hour, nx: 60, ny: 127 }));
}

function stationPayload(item: Record<string, unknown>) {
  return { response: { header: { resultCode: "00" }, body: { items: [item] } } };
}

test("missing credentials produce explicit empty states without network calls", async () => {
  let requests = 0;
  const providers = createLocalProviders({ env: {}, now: fixedNow, fetch: async () => { requests++; throw new Error("must not call"); } });
  const weather = await providers.getWeather(region);
  const places = await providers.getPlaces(region, "all", "");
  const air = await providers.getAirQuality(region);
  for (const result of [weather.weather, weather.forecast, places, air]) {
    assert.equal(result.status, "not_configured");
    assert.equal(result.data, null);
    assert.equal(result.observedAt, null);
    assert.equal(result.fetchedAt, null);
  }
  assert.equal(requests, 0);
});

test("KMA grid matches Seoul and Ulsan published grid positions", () => {
  assert.deepEqual(toKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 });
  assert.deepEqual(toKmaGrid(35.5396, 129.3115), { nx: 102, ny: 84 });
  assert.throws(() => toKmaGrid(NaN, 129));
  assert.throws(() => toKmaGrid(0, 0));
});

test("KST publication windows correctly roll into previous day and year", () => {
  const midnight = new Date("2025-12-31T15:05:00Z"); // Jan 1, 00:05 KST
  assert.deepEqual(kmaBase(midnight, "observation"), { date: "20251231", time: "2300" });
  assert.deepEqual(kmaBase(midnight, "forecast"), { date: "20251231", time: "2330" });
  assert.deepEqual(kmaBase(new Date("2025-12-31T15:10:00Z"), "observation"), { date: "20260101", time: "0000" });
  assert.deepEqual(kmaBase(new Date("2025-12-31T15:44:00Z"), "forecast"), { date: "20251231", time: "2330" });
  assert.deepEqual(kmaBase(new Date("2025-12-31T15:45:00Z"), "forecast"), { date: "20260101", time: "0030" });
  assert.equal(kmaTimestamp("20260230", "0000"), null);
  assert.equal(kmaTimestamp("20261124", "2500"), null);
});

test("weather preserves missing measurements and does not call no rain sunshine", async () => {
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "test-key" }, now: fixedNow, fetch: async () => json(kmaPayload(weatherRows({ T1H: "0", REH: "-998", WSD: "", RN1: "-999", PTY: "0" }))) });
  const { weather } = await providers.getWeather(region);
  assert.equal(weather.status, "fresh");
  assert.deepEqual(weather.data, { temperatureC: 0, humidityPercent: null, windSpeedMs: null, precipitationMm: null, condition: "강수 없음" });
  assert.equal(weather.observedAt, "2026-11-24T01:00:00.000Z");
  assert.equal(weather.fetchedAt, "2026-11-24T01:50:00.000Z");
  assert.equal(weather.expiresAt, "2026-11-24T02:30:00.000Z");
});

test("freshness uses original observation time rather than retrieval time", async () => {
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "test-key" }, now: fixedNow, fetch: async () => json(kmaPayload(weatherRows({ T1H: "12" }, "20261124", "0800"))) });
  const { weather } = await providers.getWeather(region);
  assert.equal(weather.status, "stale");
  assert.equal(weather.observedAt, "2026-11-23T23:00:00.000Z");
  assert.match(weather.message, /이전/);
});

test("missing, future and over-day-old weather never become current values", async () => {
  for (const rows of [weatherRows({ T1H: "-999", REH: "", WSD: "-1", RN1: "-1" }), weatherRows({ T1H: "14" }, "20261125", "1000"), weatherRows({ T1H: "14" }, "20261122", "1000")]) {
    const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "test-key" }, now: fixedNow, fetch: async () => json(kmaPayload(rows)) });
    assert.equal((await providers.getWeather(region)).weather.data, null);
  }
});

test("forecast groups by validity time, sorts hours and excludes past predictions", async () => {
  const rows = [
    ...forecastRows("1300", { T1H: "13", PTY: "1", SKY: "4", RN1: "1.0mm 미만" }),
    ...forecastRows("0900", { T1H: "5", PTY: "0", SKY: "1" }),
    ...forecastRows("1100", { T1H: "11", PTY: "0", SKY: "3", RN1: "강수없음" }),
  ];
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "test-key" }, now: fixedNow, fetch: async () => json(kmaPayload(rows)) });
  const { forecast } = await providers.getWeather(region);
  assert.equal(forecast.source.kind, "forecast");
  assert.equal(forecast.observedAt, "2026-11-24T01:30:00.000Z");
  assert.deepEqual(forecast.data?.map((hour) => hour.at), ["2026-11-24T02:00:00.000Z", "2026-11-24T04:00:00.000Z"]);
  assert.equal(forecast.data?.[0].condition, "구름 많음");
  assert.equal(forecast.data?.[1].condition, "비");
});

test("provider failures do not leak keys or URLs through user-visible messages", async () => {
  const secret = "do-not-echo-me";
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: secret }, now: fixedNow, fetch: async () => { throw new Error(`https://example.com?serviceKey=${secret}`); } });
  const result = await providers.getWeather(region);
  assert.equal(result.weather.status, "unavailable");
  assert.equal(result.forecast.status, "unavailable");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("cached forecast removes hours that pass while keeping its original fetch time", async () => {
  let now = new Date("2026-11-24T01:58:00Z");
  let calls = 0;
  const rows = [...forecastRows("1100", { T1H: "11" }), ...forecastRows("1200", { T1H: "12" })];
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "key" }, now: () => now, fetch: async () => { calls++; return json(kmaPayload(rows)); } });
  const first = (await providers.getWeather(region)).forecast;
  now = new Date("2026-11-24T02:01:00Z");
  const second = (await providers.getWeather(region)).forecast;
  assert.equal(first.data?.length, 2);
  assert.equal(second.data?.length, 1);
  assert.equal(second.data?.[0].temperatureC, 12);
  assert.equal(second.fetchedAt, first.fetchedAt);
  // The invalid observation was cached for 30 seconds and is retried, while the valid forecast stays cached.
  assert.equal(calls, 3);
});

test("HTTP and application error responses both fail closed", async () => {
  for (const response of [() => json({}, 429), () => json({ response: { header: { resultCode: "03" } } }), () => json({ unexpected: [] })]) {
    const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "key" }, now: fixedNow, fetch: async () => response() });
    assert.equal((await providers.getWeather(region)).weather.status, "unavailable");
  }
});

test("KMA retries one previous issuance only for explicit NO_DATA and preserves source time", async () => {
  for (const mode of ["previous-available", "still-no-data", "auth-error"] as const) {
    const requested: string[] = [];
    const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "key" }, now: fixedNow, fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("getUltraSrtFcst")) return json(kmaPayload(forecastRows("1100", { T1H: "12" })));
      requested.push(`${url.searchParams.get("base_date")}:${url.searchParams.get("base_time")}`);
      if (mode === "auth-error") return json({ response: { header: { resultCode: "30" } } });
      if (mode === "still-no-data" || requested.length === 1) return json({ response: { header: { resultCode: "03" } } });
      return json(kmaPayload(weatherRows({ T1H: "10" }, "20261124", "0900")));
    } });
    const { weather } = await providers.getWeather(region);
    if (mode === "previous-available") {
      assert.deepEqual(requested, ["20261124:1000", "20261124:0900"]);
      assert.equal(weather.status, "stale");
      assert.equal(weather.observedAt, "2026-11-24T00:00:00.000Z");
      assert.equal(weather.data?.temperatureC, 10);
    } else {
      assert.equal(requested.length, mode === "auth-error" ? 1 : 2);
      assert.equal(weather.status, "unavailable");
      assert.equal(weather.data, null);
    }
  }
});

test("requests are coalesced and credential encoding is normalized exactly once", async () => {
  const calls: URL[] = [];
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "abc%2Bdef%2F%3D" }, now: fixedNow, fetch: async (input) => {
    calls.push(new URL(String(input)));
    return json(kmaPayload(weatherRows({ T1H: "14" })));
  } });
  await Promise.all(Array.from({ length: 6 }, () => providers.getWeather(region)));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("serviceKey"), "abc+def/=");
  assert.equal(calls[0].hostname, "apis.data.go.kr");
});

test("a timed-out provider returns unavailable", async () => {
  const providers = createLocalProviders({ env: { KMA_SERVICE_KEY: "key" }, now: fixedNow, timeoutMs: 5, fetch: async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }) });
  assert.equal((await providers.getWeather(region)).weather.status, "unavailable");
});

const placeDocument = { id: "123", place_name: "테스트 카페", category_name: "음식점 > 카페", category_group_code: "CE7", address_name: "서울 종로구", road_address_name: "서울 종로구 테스트로 1", x: "126.98", y: "37.57", phone: "02-123-1234", place_url: "javascript:alert(1)" };

test("Kakao places use server auth, category and region radius without inventing live facts", async () => {
  let calledUrl = new URL("https://example.com");
  let auth = "";
  const providers = createLocalProviders({ env: { KAKAO_REST_API_KEY: "private-key" }, now: fixedNow, fetch: async (input, init) => {
    calledUrl = new URL(String(input));
    auth = new Headers(init?.headers).get("Authorization") ?? "";
    assert.equal(init?.redirect, "error");
    return json({ documents: [placeDocument] });
  } });
  const result = await providers.getPlaces(region, "cafe", "");
  assert.equal(calledUrl.pathname, "/v2/local/search/category.json");
  assert.equal(calledUrl.searchParams.get("radius"), "20000");
  assert.equal(calledUrl.searchParams.get("category_group_code"), "CE7");
  assert.equal(auth, "KakaoAK private-key");
  assert.equal(result.observedAt, null);
  assert.equal(result.data?.[0].mapUrl, "https://place.map.kakao.com/123");
  assert.equal(result.data?.[0].category, "cafe");
  assert.equal("isOpen" in result.data![0], false);
  assert.equal("crowd" in result.data![0], false);
});

test("family search is explicitly a keyword search, not a verified facility filter", async () => {
  let query = "";
  const providers = createLocalProviders({ env: { KAKAO_REST_API_KEY: "key" }, now: fixedNow, fetch: async (input) => {
    query = new URL(String(input)).searchParams.get("query") ?? "";
    return json({ documents: [] });
  } });
  const result = await providers.getPlaces(region, "family", "도서관");
  assert.equal(query, "어린이 도서관");
  assert.match(result.message, /확인해/);
  assert.deepEqual(result.data, []);
});

test("Kakao all keeps successful categories and signals partial failure; all failures remain unavailable", async () => {
  const partial = createLocalProviders({ env: { KAKAO_REST_API_KEY: "key" }, now: fixedNow, fetch: async (input) => {
    const code = new URL(String(input)).searchParams.get("category_group_code")!;
    if (code === "PK6") return json({}, 503);
    const id = { AT4: "1", FD6: "2", CE7: "3" }[code];
    return json({ documents: [{ ...placeDocument, id, category_group_code: code }] });
  } });
  const result = await partial.getPlaces(region, "all", "");
  assert.equal(result.status, "fresh");
  assert.deepEqual(result.data?.map((place) => place.category), ["attraction", "restaurant", "cafe"]);
  assert.match(result.message, /일부 분류/);
  const failed = createLocalProviders({ env: { KAKAO_REST_API_KEY: "key" }, now: fixedNow, fetch: async () => json({}, 429) });
  assert.equal((await failed.getPlaces(region, "all", "")).status, "unavailable");
});

test("malformed and out-of-country places are rejected", async () => {
  for (const payload of [{ documents: [{ ...placeDocument, id: "bad/id" }] }, { documents: [{ ...placeDocument, x: "0", y: "0" }] }, { documents: "not-an-array" }]) {
    const providers = createLocalProviders({ env: { KAKAO_REST_API_KEY: "key" }, now: fixedNow, fetch: async () => json(payload) });
    assert.equal((await providers.getPlaces(region, "cafe", "")).status, "unavailable");
  }
});

test("air quality requires explicit region-to-station mapping", async () => {
  let called = false;
  const providers = createLocalProviders({ env: { AIRKOREA_SERVICE_KEY: "key" }, now: fixedNow, fetch: async () => { called = true; throw new Error("unexpected"); } });
  assert.equal((await providers.getAirQuality(region)).status, "unsupported");
  assert.equal(called, false);
});

test("AirKorea flags and missing readings stay null; 24h grades do not replace 1h grades", async () => {
  const providers = createLocalProviders({ env: { AIRKOREA_SERVICE_KEY: "key", AIRKOREA_STATIONS: '{"seoul":"종로구"}' }, now: fixedNow, fetch: async () => json(stationPayload({ dataTime: "2026-11-24 10:00", pm10Value: "25", pm10Flag: "점검및교정", pm10Grade1h: "1", pm25Value: "12", pm25Grade: "1" })) });
  const result = await providers.getAirQuality(region);
  assert.deepEqual(result.data, { stationName: "종로구", pm10: null, pm25: 12, pm10Grade: null, pm25Grade: null });
  assert.equal(result.observedAt, "2026-11-24T01:00:00.000Z");
  assert.match(result.message, /측정소/);
});

test("AirKorea all-missing readings are unavailable instead of zero or good", async () => {
  const providers = createLocalProviders({ env: { AIRKOREA_SERVICE_KEY: "key", AIRKOREA_STATIONS: '{"seoul":"종로구"}' }, now: fixedNow, fetch: async () => json(stationPayload({ dataTime: "2026-11-24 10:00", pm10Value: "-", pm25Value: null, pm10Grade1h: "1" })) });
  assert.equal((await providers.getAirQuality(region)).data, null);
});

test("AirKorea 24:00 timestamps normalize to next midnight", () => {
  assert.equal(airTimestamp("2026-12-31 24:00"), "2026-12-31T15:00:00.000Z");
  assert.equal(airTimestamp("2026-02-30 12:00"), null);
  assert.equal(airTimestamp("2026-11-24 24:15"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicDataGateway,
  PublicDataGatewayError,
  type AdapterHealthResult,
  type PublicDataAdapter,
  type PublicDataCache,
} from "../workers/api/src/public-data/gateway.ts";
import {
  createKmaWeatherAdapter,
  type KmaWeatherQuery,
  type KmaWeatherResponse,
} from "../workers/api/src/public-data/kma-weather-adapter.ts";
import { createTourApiAdapter, type TourApiResponse } from "../workers/api/src/public-data/tour-api-adapter.ts";
import {
  createNationalParkingAdapter,
  type NationalParkingResponse,
} from "../workers/api/src/public-data/national-parking-adapter.ts";
import {
  createNationalTrafficAdapter,
  type NationalTrafficResponse,
} from "../workers/api/src/public-data/national-traffic-adapter.ts";
import {
  createNationalCctvAdapter,
  type NationalCctvResponse,
} from "../workers/api/src/public-data/national-cctv-adapter.ts";

class MemoryPublicDataCache implements PublicDataCache {
  readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }
}

test("public data gateway retries transient failures and serves a fresh cache", async () => {
  const cache = new MemoryPublicDataCache();
  let fetchCount = 0;
  const adapter = createFixtureAdapter(async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      throw new PublicDataGatewayError("SOURCE_HTTP_ERROR", "temporary", true);
    }
    return { value: "ok" };
  });
  const gateway = new PublicDataGateway({ cache, sleep: async () => undefined });

  const network = await gateway.execute(adapter, { id: "fixture" }, {
    freshTtlSeconds: 60,
    staleTtlSeconds: 300,
    maxAttempts: 2,
  });
  const cached = await gateway.execute(adapter, { id: "fixture" }, {
    freshTtlSeconds: 60,
    staleTtlSeconds: 300,
  });

  assert.equal(network.cacheStatus, "network");
  assert.deepEqual(network.items, [{ value: "ok" }]);
  assert.equal(cached.cacheStatus, "fresh");
  assert.equal(fetchCount, 2);
});

test("public data gateway serves bounded stale data on outage and then opens its circuit", async () => {
  const cache = new MemoryPublicDataCache();
  let nowMs = Date.parse("2026-07-10T00:00:00.000Z");
  let shouldFail = false;
  let fetchCount = 0;
  const adapter = createFixtureAdapter(async () => {
    fetchCount += 1;
    if (shouldFail) throw new PublicDataGatewayError("SOURCE_HTTP_ERROR", "outage", true);
    return { value: "cached" };
  });
  const gateway = new PublicDataGateway({
    cache,
    now: () => new Date(nowMs),
    sleep: async () => undefined,
    circuitFailureThreshold: 1,
    circuitOpenMs: 60_000,
  });
  const policy = { freshTtlSeconds: 10, staleTtlSeconds: 120, maxAttempts: 1 };

  await gateway.execute(adapter, { id: "fixture" }, policy);
  nowMs += 11_000;
  shouldFail = true;
  const staleAfterFailure = await gateway.execute(adapter, { id: "fixture" }, policy);
  const staleWhileOpen = await gateway.execute(adapter, { id: "fixture" }, policy);

  assert.equal(staleAfterFailure.cacheStatus, "stale");
  assert.equal(staleAfterFailure.healthStatus, "degraded");
  assert.equal(staleWhileOpen.cacheStatus, "stale");
  assert.equal(fetchCount, 2);

  nowMs += 120_000;
  await assert.rejects(
    gateway.execute(adapter, { id: "fixture" }, policy),
    (error: unknown) => error instanceof PublicDataGatewayError && error.code === "SOURCE_HTTP_ERROR",
  );
});

test("KMA adapter validates its fixture and keeps provider observation time separate from fetch time", async () => {
  const cache = new MemoryPublicDataCache();
  const serviceKey = "fixture-service-key-never-cache";
  const now = new Date("2026-07-10T00:05:00.000Z");
  const adapter = createKmaWeatherAdapter({ serviceKey, ttlSeconds: 1_800, now: () => now });
  const query: KmaWeatherQuery = {
    placeId: "busan-gwangalli",
    nx: 98,
    ny: 76,
    baseDate: "20260710",
    baseTime: "0900",
  };
  let requestedUrl = "";
  const gateway = new PublicDataGateway({
    cache,
    now: () => now,
    fetcher: async (input) => {
      requestedUrl = String(input);
      return Response.json(kmaFixture());
    },
  });

  const result = await gateway.execute(adapter, query, {
    freshTtlSeconds: 300,
    staleTtlSeconds: 1_800,
  });
  const signal = result.items[0];

  assert.equal(result.cacheStatus, "network");
  assert.equal(signal?.dimension, "weather");
  assert.equal(signal?.valueCode, "clear");
  assert.equal(signal?.temperatureC, 26.4);
  assert.equal(signal?.windSpeedMps, 2.1);
  assert.equal(signal?.observedAt, "2026-07-10T00:00:00.000Z");
  assert.equal(signal?.fetchedAt, "2026-07-10T00:05:00.000Z");
  assert.notEqual(signal?.observedAt, signal?.fetchedAt);
  assert.equal(requestedUrl.includes(serviceKey), true);
  assert.equal([...cache.entries.keys()].some((key) => key.includes(serviceKey)), false);
  assert.equal(result.attribution, "기상청 단기예보 조회서비스");
});

test("KMA adapter rejects provider errors without exposing provider payload details", async () => {
  const adapter = createKmaWeatherAdapter({ serviceKey: "fixture-key", ttlSeconds: 1_800 });
  const gateway = new PublicDataGateway({
    fetcher: async () => Response.json({
      response: {
        header: { resultCode: "99", resultMsg: "secret provider trace" },
        body: { totalCount: 0, items: { item: [] } },
      },
    }),
  });

  await assert.rejects(
    gateway.execute(adapter, {
      placeId: "busan-gwangalli",
      nx: 98,
      ny: 76,
      baseDate: "20260710",
      baseTime: "0900",
    }, {
      freshTtlSeconds: 60,
      staleTtlSeconds: 120,
      maxAttempts: 1,
    }),
    (error: unknown) => {
      assert.equal(error instanceof PublicDataGatewayError, true);
      assert.equal((error as PublicDataGatewayError).code, "SOURCE_INVALID_RESPONSE");
      assert.equal((error as Error).message.includes("secret provider trace"), false);
      return true;
    },
  );
});

test("official static adapters preserve source metadata without current-state timestamps", async () => {
  const cache = new MemoryPublicDataCache();
  const now = new Date("2026-07-10T00:05:00.000Z");
  const tourKey = "tour-fixture-key-never-cache";
  const parkingKey = "parking-fixture-key-never-cache";
  const responses = [tourFixture(), parkingFixture()];
  const requestedUrls: string[] = [];
  const gateway = new PublicDataGateway({
    cache,
    now: () => now,
    fetcher: async (input) => {
      requestedUrls.push(String(input));
      return Response.json(responses.shift());
    },
  });
  const tourAdapter = createTourApiAdapter({ serviceKey: tourKey, now: () => now });
  const parkingAdapter = createNationalParkingAdapter({
    serviceKey: parkingKey,
    endpointUrl: "https://api.odcloud.kr/api/15012896/v1/uddi:fixture-parking",
    now: () => now,
  });

  const tour = await gateway.execute(tourAdapter, {
    areaCode: "6", contentTypeId: "12", pageNo: 1, numOfRows: 10,
  }, { freshTtlSeconds: 300, staleTtlSeconds: 86_400 });
  const parking = await gateway.execute(parkingAdapter, {
    pageNo: 1, numOfRows: 10,
  }, { freshTtlSeconds: 300, staleTtlSeconds: 86_400 });
  const tourPlace = tour.items[0];
  const parkingPlace = parking.items[0];

  assert.equal(tourPlace?.sourceType, "official_static");
  assert.equal(tourPlace?.sourceUpdatedAt, "2026-07-09T23:30:00.000Z");
  assert.equal(parkingPlace?.sourceType, "official_static");
  assert.equal(parkingPlace?.sourceUpdatedAt, "2026-07-08T15:00:00.000Z");
  for (const item of [tourPlace, parkingPlace]) {
    assert.equal(item && "observedAt" in item, false);
    assert.equal(item && "fetchedAt" in item, false);
    assert.equal(item && "expiresAt" in item, false);
  }
  assert.equal(tourPlace ? tourAdapter.getObservedAt(tourPlace) : undefined, null);
  assert.equal(parkingPlace ? parkingAdapter.getExpiresAt(parkingPlace) : undefined, null);
  assert.equal(requestedUrls.every((url) => new URL(url).searchParams.size > 0), true);
  assert.equal([...cache.entries.keys()].some((key) => key.includes(tourKey) || key.includes(parkingKey)), false);
});

test("national traffic normalizes provider observation time and bounded live expiry", async () => {
  const cache = new MemoryPublicDataCache();
  const serviceKey = "traffic-fixture-key-never-cache";
  const now = new Date("2026-07-10T00:05:00.000Z");
  const adapter = createNationalTrafficAdapter({ serviceKey, ttlSeconds: 600, now: () => now });
  let requestedUrl = "";
  const gateway = new PublicDataGateway({
    cache,
    now: () => now,
    fetcher: async (input) => {
      requestedUrl = String(input);
      return Response.json(trafficFixture());
    },
  });

  const result = await gateway.execute(adapter, {
    placeId: "busan-gwangalli",
    roadType: "all",
    bbox: { minLng: 129.10, maxLng: 129.14, minLat: 35.14, maxLat: 35.17 },
  }, {
    freshTtlSeconds: 60, staleTtlSeconds: 600,
  });
  const signal = result.items[0];

  assert.equal(signal?.dimension, "road_traffic");
  assert.equal(signal?.sourceType, "official_live");
  assert.equal(signal?.speedKph, 42);
  assert.equal(signal?.valueCode, "slow");
  assert.equal(signal?.isEstimated, true);
  assert.equal(signal?.observedAt, "2026-07-10T00:01:00.000Z");
  assert.equal(signal?.fetchedAt, "2026-07-10T00:05:00.000Z");
  assert.notEqual(signal?.observedAt, signal?.fetchedAt);
  assert.equal(signal?.expiresAt, "2026-07-10T00:11:00.000Z");
  assert.equal(new URL(requestedUrl).searchParams.get("type"), "all");
  assert.equal(new URL(requestedUrl).searchParams.get("minX"), "129.1");
  assert.equal([...cache.entries.keys()].some((key) => key.includes(serviceKey)), false);
});

test("national CCTV keeps metadata and blocks playback without leaking stream fields", async () => {
  const serviceKey = "cctv-fixture-key";
  const adapter = createNationalCctvAdapter({ serviceKey });
  const validated = adapter.validateResponse(cctvFixture());
  const gateway = new PublicDataGateway({ fetcher: async () => Response.json(cctvFixture()) });

  const result = await gateway.execute(adapter, {
    roadType: "its",
    cctvType: "4",
    bbox: { minLng: 129.10, maxLng: 129.14, minLat: 35.14, maxLat: 35.17 },
  }, {
    freshTtlSeconds: 300, staleTtlSeconds: 86_400,
  });
  const camera = result.items[0];
  const serialized = JSON.stringify(camera);

  assert.equal(camera?.roadSectionId, "2600012400");
  assert.equal(camera?.rightsStatus, "playback_prohibited_unless_licensed");
  assert.equal(camera?.playbackAllowed, false);
  assert.equal(camera?.sourceType, "official_static");
  assert.equal("cctvUrl" in validated.response.data[0]!, false);
  assert.equal(camera && "observedAt" in camera, false);
  assert.equal(camera && "expiresAt" in camera, false);
  assert.equal(/cctvUrl|streamUrl|proxyUrl|m3u8|provider-secret/i.test(serialized), false);
  assert.equal(camera ? adapter.getObservedAt(camera) : undefined, null);
});

test("new adapters reject malformed provider shapes through the redacted gateway error", async () => {
  const adapter = createNationalTrafficAdapter({ serviceKey: "fixture-key", ttlSeconds: 600 });
  const gateway = new PublicDataGateway({
    fetcher: async () => Response.json({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL" },
        body: { items: { item: [{ linkId: "secret provider trace", speed: "fast" }] } },
      },
    }),
  });

  await assert.rejects(
    gateway.execute(adapter, {
      placeId: "busan-gwangalli",
      roadType: "all",
      bbox: { minLng: 129.10, maxLng: 129.14, minLat: 35.14, maxLat: 35.17 },
    }, {
      freshTtlSeconds: 60, staleTtlSeconds: 600, maxAttempts: 1,
    }),
    (error: unknown) => {
      assert.equal(error instanceof PublicDataGatewayError, true);
      assert.equal((error as PublicDataGatewayError).code, "SOURCE_INVALID_RESPONSE");
      assert.equal((error as Error).message.includes("secret provider trace"), false);
      return true;
    },
  );
});

function createFixtureAdapter(
  fetchValue: () => Promise<unknown>,
): PublicDataAdapter<{ id: string }, { value: string }, { value: string }> {
  return {
    sourceKey: "fixture_source",
    validateQuery(query) {
      if (!query.id) throw new Error("missing id");
    },
    cacheKey(query) {
      return query.id;
    },
    fetch() {
      return fetchValue();
    },
    validateResponse(raw) {
      if (!raw || typeof raw !== "object" || typeof (raw as { value?: unknown }).value !== "string") {
        throw new Error("invalid fixture");
      }
      return raw as { value: string };
    },
    normalize(raw) {
      return [raw];
    },
    getObservedAt() {
      return null;
    },
    getExpiresAt() {
      return null;
    },
    getAttribution() {
      return "fixture";
    },
    async healthCheck(): Promise<AdapterHealthResult> {
      return { status: "healthy", checkedAt: new Date().toISOString(), responseTimeMs: 0 };
    },
  };
}

function kmaFixture(): KmaWeatherResponse {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        totalCount: 4,
        items: {
          item: [
            { baseDate: "20260710", baseTime: "0900", category: "T1H", nx: 98, ny: 76, obsrValue: "26.4" },
            { baseDate: "20260710", baseTime: "0900", category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
            { baseDate: "20260710", baseTime: "0900", category: "WSD", nx: 98, ny: 76, obsrValue: "2.1" },
            { baseDate: "20260710", baseTime: "0900", category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
          ],
        },
      },
    },
  };
}

function tourFixture(): TourApiResponse {
  return {
    response: {
      header: { resultCode: "0000", resultMsg: "OK" },
      body: {
        totalCount: 1,
        items: { item: [{
          contentid: "126508", title: "광안리해수욕장", addr1: "부산광역시 수영구 광안해변로 219",
          mapx: "129.1185509", mapy: "35.1531696", modifiedtime: "20260710083000",
        }] },
      },
    },
  };
}

function parkingFixture(): NationalParkingResponse {
  return {
    currentCount: 1,
    matchCount: 1,
    page: 1,
    perPage: 10,
    totalCount: 1,
    data: [{
      "주차장관리번호": "PK-26000-014",
      "주차장명": "민락수변공원 공영주차장",
      "소재지도로명주소": "부산광역시 수영구 민락수변로 129",
      "위도": 35.1541,
      "경도": 129.1311,
      "데이터기준일자": "2026-07-09",
      "관리기관명": "부산광역시 수영구",
    }],
  };
}

function trafficFixture(): NationalTrafficResponse {
  return {
    response: {
      header: { resultCode: "0", resultMsg: "SUCCESS" },
      body: {
        totalCount: "1",
        items: { item: [{
          linkId: "2600012400",
          roadName: "광안대로",
          roadDrcType: "up",
          speed: "42",
          travelTime: "88.1",
          createdDate: "20260710090100",
        }] },
      },
    },
  };
}

function cctvFixture(): NationalCctvResponse {
  return {
    response: {
      header: { resultCode: "0", resultMsg: "SUCCESS" },
      data: [{
        roadsectionid: "2600012400",
        filecreatetime: "20260710085500",
        cctvtype: "4",
        cctvname: "광안리 해변 교차로",
        cctvresolution: "1280x720",
        cctvformat: "HLS",
        coordx: "129.1188",
        coordy: "35.1533",
        cctvurl: "https://provider-secret.example/live/camera.m3u8",
      }],
    },
  };
}

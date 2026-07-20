#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePlaceSignals } from "../packages/contracts/src/live.ts";
import {
  PublicDataGateway,
  PublicDataGatewayError,
} from "../workers/api/src/public-data/gateway.ts";
import { createKmaWeatherAdapter } from "../workers/api/src/public-data/kma-weather-adapter.ts";
import { createNationalCctvAdapter } from "../workers/api/src/public-data/national-cctv-adapter.ts";
import { createNationalParkingAdapter } from "../workers/api/src/public-data/national-parking-adapter.ts";
import { createNationalTrafficAdapter } from "../workers/api/src/public-data/national-traffic-adapter.ts";
import { createSeoulRealtimeAdapter } from "../workers/api/src/public-data/seoul-realtime-adapter.ts";
import { createTourApiAdapter } from "../workers/api/src/public-data/tour-api-adapter.ts";

const SCHEMA_VERSION = "silsigan-public-source-fallback-evidence/v1";
const EVALUATED_AT = "2026-07-20T00:00:00.000Z";
const FRESH_TTL_SECONDS = 10;
const STALE_TTL_SECONDS = 120;
const SECRET_MARKER = "fixture-service-key-never-output";
const PROVIDER_ERROR_MARKER = "provider-secret-payload-never-output";
const SENSITIVE_PATTERNS = [
  ["credential_marker", /fixture-service-key|provider-secret|ServiceKey|apiKey/i],
  ["absolute_url", /https?:\/\//i],
  ["stream_field", /cctvUrl|streamUrl|proxyUrl|m3u8/i],
  ["raw_coordinate", /(?:129\.1\d+|35\.1\d+)/],
];

class MemoryPublicDataCache {
  entries = new Map();

  async get(key) {
    return this.entries.get(key) ?? null;
  }

  async put(key, value) {
    this.entries.set(key, value);
  }
}

export async function runPublicSourceFallbackEvidence() {
  const sources = [];
  for (const scenario of createScenarios()) {
    sources.push(await runScenario(scenario));
  }

  const baseResult = {
    schemaVersion: SCHEMA_VERSION,
    evaluatedAt: EVALUATED_AT,
    scope: "local-fixtures-only",
    sources,
  };
  const sensitiveHits = detectSensitiveHits(JSON.stringify(baseResult));
  const passedSources = sources.filter((source) => source.passed).length;
  const failedSources = sources.length - passedSources;

  return {
    ...baseResult,
    ok: sources.length === 6 && failedSources === 0 && sensitiveHits.length === 0,
    passedSources,
    failedSources,
    sensitiveHits,
  };
}

async function runScenario(scenario) {
  let nowMs = Date.parse(scenario.baseNow);
  let providerAvailable = true;
  const cache = new MemoryPublicDataCache();
  const gateway = new PublicDataGateway({
    cache,
    now: () => new Date(nowMs),
    sleep: async () => undefined,
    circuitFailureThreshold: 1,
    circuitOpenMs: 60_000,
    fetcher: async () => providerAvailable
      ? Response.json(scenario.fixture)
      : new Response(PROVIDER_ERROR_MARKER, { status: 503 }),
  });
  const policy = {
    freshTtlSeconds: FRESH_TTL_SECONDS,
    staleTtlSeconds: STALE_TTL_SECONDS,
    maxAttempts: 1,
  };

  try {
    const network = await gateway.execute(scenario.adapter, scenario.query, policy);
    const fresh = await gateway.execute(scenario.adapter, scenario.query, policy);
    nowMs += (FRESH_TTL_SECONDS + 1) * 1_000;
    providerAvailable = false;
    const stale = await gateway.execute(scenario.adapter, scenario.query, policy);
    nowMs += STALE_TTL_SECONDS * 1_000;

    let terminalErrorCode = "NO_ERROR";
    try {
      await gateway.execute(scenario.adapter, scenario.query, policy);
    } catch (error) {
      terminalErrorCode = error instanceof PublicDataGatewayError ? error.code : "UNEXPECTED_ERROR";
    }

    const firstItem = network.items[0];
    const timestampContract = timestampContractFor(scenario, firstItem);
    const expiredDecision = expiredDecisionFor(scenario, firstItem);
    const cacheContainsSecret = [...cache.entries.values()].some((value) =>
      /fixture-service-key|provider-secret|cctvUrl|streamUrl|proxyUrl|m3u8|https?:\/\//i.test(value),
    );
    const passed = Boolean(firstItem)
      && network.cacheStatus === "network"
      && fresh.cacheStatus === "fresh"
      && stale.cacheStatus === "stale"
      && stale.healthStatus === "degraded"
      && JSON.stringify(stale.items) === JSON.stringify(network.items)
      && terminalErrorCode === "SOURCE_HTTP_ERROR"
      && expiredDecision === "insufficient"
      && timestampContract === (scenario.sourceKind === "live" ? "bounded-live" : "static-only")
      && !cacheContainsSecret;

    return {
      sourceKey: scenario.adapter.sourceKey,
      sourceKind: scenario.sourceKind,
      cacheSequence: [network.cacheStatus, fresh.cacheStatus, stale.cacheStatus, expiredDecision],
      outageHealth: stale.healthStatus,
      expiredDecision,
      terminalErrorCode,
      timestampContract,
      attributionPresent: network.attribution.trim().length > 0,
      itemCount: network.items.length,
      passed,
    };
  } catch {
    return {
      sourceKey: scenario.adapter.sourceKey,
      sourceKind: scenario.sourceKind,
      cacheSequence: [],
      outageHealth: "unknown",
      expiredDecision: "unknown",
      terminalErrorCode: "HARNESS_SCENARIO_FAILED",
      timestampContract: "unverified",
      attributionPresent: false,
      itemCount: 0,
      passed: false,
    };
  }
}

function timestampContractFor(scenario, item) {
  if (!item) return "unverified";
  const observedAt = scenario.adapter.getObservedAt(item);
  const expiresAt = scenario.adapter.getExpiresAt(item);

  if (scenario.sourceKind === "static") {
    return observedAt === null
      && expiresAt === null
      && !("observedAt" in item)
      && !("expiresAt" in item)
      ? "static-only"
      : "invalid-static";
  }

  return observedAt instanceof Date
    && expiresAt instanceof Date
    && Number.isFinite(observedAt.getTime())
    && expiresAt.getTime() > observedAt.getTime()
    ? "bounded-live"
    : "invalid-live";
}

function expiredDecisionFor(scenario, item) {
  if (!item || scenario.sourceKind === "static") {
    return aggregatePlaceSignals([], fallbackProfile("crowd"), new Date(EVALUATED_AT)).status;
  }

  const signal = {
    id: `fixture-${scenario.adapter.sourceKey}`,
    placeId: item.placeId,
    dimension: item.dimension,
    valueCode: item.valueCode,
    ...(typeof item.valueNumber === "number" ? { valueNumber: item.valueNumber } : {}),
    ...(typeof item.valueText === "string" ? { valueText: item.valueText } : {}),
    ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
    sourceId: scenario.adapter.sourceKey,
    sourceType: item.sourceType,
    sourceName: item.sourceName,
    attributionText: item.attributionText,
    observedAt: item.observedAt,
    fetchedAt: item.fetchedAt,
    expiresAt: item.expiresAt,
    confidenceScore: item.confidenceScore,
    isEstimated: item.isEstimated,
    isPubliclyVisible: true,
    evidenceType: "api",
  };
  const afterExpiry = new Date(Date.parse(item.expiresAt) + 1);
  return aggregatePlaceSignals([signal], fallbackProfile(item.dimension, item.valueCode), afterExpiry).status;
}

function fallbackProfile(dimension, positiveValueCode = "available") {
  return {
    key: `fallback-evidence-${dimension}`,
    dimensions: [{
      dimension,
      required: true,
      importance: "critical",
      positiveValueCodes: [positiveValueCode],
      negativeValueCodes: [],
    }],
  };
}

function detectSensitiveHits(serialized) {
  return SENSITIVE_PATTERNS
    .filter(([, pattern]) => pattern.test(serialized))
    .map(([name]) => name);
}

function createScenarios() {
  const busanNow = "2026-07-10T00:05:00.000Z";
  const seoulNow = "2026-07-14T04:05:00.000Z";
  const nowFor = (iso) => () => new Date(iso);
  const bbox = { minLng: 129.10, maxLng: 129.14, minLat: 35.14, maxLat: 35.17 };

  return [
    {
      sourceKind: "live",
      baseNow: busanNow,
      adapter: createKmaWeatherAdapter({ serviceKey: SECRET_MARKER, ttlSeconds: 1_800, now: nowFor(busanNow) }),
      query: { placeId: "busan-gwangalli", nx: 98, ny: 76, baseDate: "20260710", baseTime: "0900" },
      fixture: kmaFixture(),
    },
    {
      sourceKind: "static",
      baseNow: busanNow,
      adapter: createTourApiAdapter({ serviceKey: SECRET_MARKER, now: nowFor(busanNow) }),
      query: { areaCode: "6", contentTypeId: "12", pageNo: 1, numOfRows: 10 },
      fixture: tourFixture(),
    },
    {
      sourceKind: "static",
      baseNow: busanNow,
      adapter: createNationalParkingAdapter({
        serviceKey: SECRET_MARKER,
        endpointUrl: "https://api.odcloud.kr/api/15012896/v1/uddi:fixture-parking",
        now: nowFor(busanNow),
      }),
      query: { pageNo: 1, numOfRows: 10 },
      fixture: parkingFixture(),
    },
    {
      sourceKind: "live",
      baseNow: busanNow,
      adapter: createNationalTrafficAdapter({ serviceKey: SECRET_MARKER, ttlSeconds: 600, now: nowFor(busanNow) }),
      query: { placeId: "busan-gwangalli", roadType: "all", bbox },
      fixture: trafficFixture(),
    },
    {
      sourceKind: "static",
      baseNow: busanNow,
      adapter: createNationalCctvAdapter({ serviceKey: SECRET_MARKER, now: nowFor(busanNow) }),
      query: { roadType: "its", cctvType: "4", bbox },
      fixture: cctvFixture(),
    },
    {
      sourceKind: "live",
      baseNow: seoulNow,
      adapter: createSeoulRealtimeAdapter({
        serviceKey: SECRET_MARKER,
        ttlSeconds: 600,
        endpointUrl: "https://seoul-fixture.example",
        now: nowFor(seoulNow),
      }),
      query: { placeId: "seoul-yeouido", areaName: "여의도 한강공원", areaCode: "POI001" },
      fixture: seoulFixture(),
    },
  ];
}

function kmaFixture() {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        totalCount: 4,
        items: { item: [
          { baseDate: "20260710", baseTime: "0900", category: "T1H", nx: 98, ny: 76, obsrValue: "26.4" },
          { baseDate: "20260710", baseTime: "0900", category: "RN1", nx: 98, ny: 76, obsrValue: "0" },
          { baseDate: "20260710", baseTime: "0900", category: "WSD", nx: 98, ny: 76, obsrValue: "2.1" },
          { baseDate: "20260710", baseTime: "0900", category: "PTY", nx: 98, ny: 76, obsrValue: "0" },
        ] },
      },
    },
  };
}

function tourFixture() {
  return {
    response: {
      header: { resultCode: "0000", resultMsg: "OK" },
      body: {
        totalCount: 1,
        items: { item: [{
          contentid: "126508",
          title: "광안리해수욕장",
          addr1: "부산광역시 수영구 광안해변로 219",
          mapx: "129.1185509",
          mapy: "35.1531696",
          modifiedtime: "20260710083000",
        }] },
      },
    },
  };
}

function parkingFixture() {
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

function trafficFixture() {
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

function cctvFixture() {
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

function seoulFixture() {
  return {
    "SeoulRtd.citydata": {
      RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다." },
      AREA_NM: "여의도 한강공원",
      AREA_CD: "POI001",
      LIVE_PPLTN_STTS: [{
        AREA_CONGEST_LVL: "약간 붐빔",
        AREA_CONGEST_MSG: "실시간 인구 추정값입니다.",
        AREA_PPLTN_MIN: "1000",
        AREA_PPLTN_MAX: "1200",
        PPLTN_TIME: "2026-07-14 13:00",
      }],
    },
  };
}

async function writeEvidence(path, payload) {
  const root = resolve(process.cwd(), "artifacts");
  const target = resolve(process.cwd(), path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Evidence output must stay under artifacts/.");
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseOutputPath(args) {
  const raw = args.find((arg) => arg.startsWith("--out="));
  return raw ? raw.slice("--out=".length) : null;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await runPublicSourceFallbackEvidence();
  const outputPath = parseOutputPath(process.argv.slice(2));
  if (outputPath) await writeEvidence(outputPath, result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

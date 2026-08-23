import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIngestionRequestBody,
  nextIngestionAt,
  parseIngestionTargetQuery,
  validateIngestionTargetQuery,
} from "../workers/api/src/public-data/ingestion-targets.ts";

test("ingestion target validation rejects secret-like fields and reserved routing fields", () => {
  assert.throws(
    () => parseIngestionTargetQuery({ apiKey: "must-not-be-stored" }),
    /INGESTION_TARGET_QUERY_SECRET_FIELD/,
  );
  assert.throws(
    () => validateIngestionTargetQuery("kma_weather", { placeId: "other-place", nx: 98, ny: 76, useLatestKmaNowcast: true }),
    /INGESTION_TARGET_QUERY_RESERVED_FIELD/,
  );
});

test("KMA scheduled target derives the latest available Korea nowcast time without storing credentials", () => {
  const body = buildIngestionRequestBody(
    "kma_weather",
    "busan-gwangalli",
    { nx: 98, ny: 76, useLatestKmaNowcast: true },
    new Date("2026-07-13T00:03:00.000Z"),
  );

  assert.deepEqual(body, {
    placeId: "busan-gwangalli",
    nx: 98,
    ny: 76,
    baseDate: "20260713",
    baseTime: "0850",
  });
  assert.equal(JSON.stringify(body).includes("service"), false);
});

test("official static and traffic targets require provider-specific matching evidence", () => {
  assert.doesNotThrow(() => validateIngestionTargetQuery("tour_api", {
    externalId: "126508",
    areaCode: "6",
    contentTypeId: "12",
    matchMethod: "manual",
    manuallyVerified: true,
  }));
  assert.doesNotThrow(() => validateIngestionTargetQuery("national_cctv", {
    externalId: "cctv-1",
    roadType: "its",
    cctvType: "1",
    minLng: 129.1,
    maxLng: 129.14,
    minLat: 35.14,
    maxLat: 35.17,
    matchMethod: "provider_id",
    manuallyVerified: false,
  }));
  assert.doesNotThrow(() => validateIngestionTargetQuery("national_traffic", {
    linkId: "2600012400",
    roadType: "all",
    minLng: 129.1,
    maxLng: 129.14,
    minLat: 35.14,
    maxLat: 35.17,
  }));
  assert.throws(
    () => validateIngestionTargetQuery("national_traffic", { linkId: "2600012400", roadType: "all" }),
    /INGESTION_TARGET_QUERY_INVALID/,
  );
});

test("failed ingestion targets back off at least five minutes while successful targets use source cadence", () => {
  const now = new Date("2026-07-13T00:00:00.000Z");
  assert.equal(nextIngestionAt(now, 60, "failed"), "2026-07-13T00:05:00.000Z");
  assert.equal(nextIngestionAt(now, 1_800, "succeeded"), "2026-07-13T00:30:00.000Z");
  assert.equal(nextIngestionAt(now, null, "skipped"), "2026-07-14T00:00:00.000Z");
});

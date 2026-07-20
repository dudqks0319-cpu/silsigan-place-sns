import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_FEATURE_FLAGS,
  aggregatePlaceSignals,
  identityKey,
  isLiveSignalCurrent,
  listObservedReportSignals,
  resolveFeatureFlag,
  resolveSignalExpiry,
  validateLiveSignal,
} = await import(new URL("../packages/contracts/src/index.ts", import.meta.url).href);
const { applyBoundedSlidingWindowRateLimit } = await import(new URL("../workers/api/src/policies.ts", import.meta.url).href);

const now = new Date("2026-07-10T00:30:00.000Z");

test("Worker fallback limiter bounds memory and reclaims expired identities", () => {
  const buckets = new Map();
  const options = {
    buckets,
    limit: 2,
    windowMs: 60_000,
    capacity: 2,
  };

  assert.equal(applyBoundedSlidingWindowRateLimit({ ...options, key: "first", nowMs: 1_000 }).result.allowed, true);
  assert.equal(applyBoundedSlidingWindowRateLimit({ ...options, key: "second", nowMs: 1_000 }).result.allowed, true);

  const capacityStop = applyBoundedSlidingWindowRateLimit({ ...options, key: "third", nowMs: 1_000 });
  assert.equal(capacityStop.result.allowed, false);
  assert.equal(capacityStop.capacityExceeded, true);
  assert.equal(buckets.size, 2);

  const afterExpiry = applyBoundedSlidingWindowRateLimit({ ...options, key: "third", nowMs: 61_001 });
  assert.equal(afterExpiry.result.allowed, true);
  assert.equal(afterExpiry.capacityExceeded, false);
  assert.equal(buckets.size, 1);
});

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "signal-1",
    placeId: "busan-gwangalli",
    dimension: "crowd",
    valueCode: "quiet",
    sourceId: "user-a",
    sourceType: "verified_ugc",
    sourceName: "현장 인증 사용자",
    observedAt: "2026-07-10T00:20:00.000Z",
    fetchedAt: "2026-07-10T00:21:00.000Z",
    expiresAt: "2026-07-10T00:50:00.000Z",
    confidenceScore: 0.8,
    isEstimated: false,
    isPubliclyVisible: true,
    evidenceType: "user_report",
    ...overrides,
  };
}

const beachProfile = {
  key: "beach",
  dimensions: [
    {
      dimension: "weather",
      required: true,
      importance: "critical",
      positiveValueCodes: ["clear", "calm"],
      negativeValueCodes: ["storm", "closed"],
    },
    {
      dimension: "local_condition",
      required: true,
      importance: "critical",
      positiveValueCodes: ["safe"],
      negativeValueCodes: ["danger", "closed"],
    },
    {
      dimension: "crowd",
      required: false,
      importance: "important",
      positiveValueCodes: ["quiet", "normal"],
      negativeValueCodes: ["packed"],
    },
  ],
} as const;

test("live signals require a real provider observation timestamp", () => {
  assert.throws(
    () =>
      validateLiveSignal(
        signal({
          observedAt: undefined,
          fetchedAt: "2026-07-10T00:21:00.000Z",
        }),
      ),
    /observedAt/,
  );
});

test("live signals require an explicit expiry timestamp", () => {
  assert.throws(() => validateLiveSignal(signal({ expiresAt: undefined })), /expiresAt is required/);
  assert.equal(isLiveSignalCurrent(signal({ expiresAt: undefined }), now), false);
});

test("expired and official static signals never count as current state", () => {
  assert.equal(isLiveSignalCurrent(signal({ expiresAt: "2026-07-10T00:29:59.000Z" }), now), false);
  assert.equal(isLiveSignalCurrent(signal({ sourceType: "official_static" }), now), false);
  assert.equal(isLiveSignalCurrent(signal({ isPubliclyVisible: false }), now), false);
});

test("signal expiry is resolved from dimension settings rather than a global constant", () => {
  assert.equal(
    resolveSignalExpiry({
      observedAt: "2026-07-10T00:00:00.000Z",
      dimension: "parking",
      ttlSecondsByDimension: { parking: 900, crowd: 1800 },
    }),
    "2026-07-10T00:15:00.000Z",
  );
  assert.equal(
    resolveSignalExpiry({
      observedAt: "2026-07-10T00:00:00.000Z",
      dimension: "crowd",
      ttlSecondsByDimension: { parking: 900, crowd: 1800 },
    }),
    "2026-07-10T00:30:00.000Z",
  );
});

test("aggregation returns insufficient instead of treating missing information as good", () => {
  const result = aggregatePlaceSignals([], beachProfile, now);

  assert.equal(result.status, "insufficient");
  assert.deepEqual(result.missingRequiredDimensions, ["weather", "local_condition"]);
  assert.deepEqual(result.currentSignals, []);
});

test("positive aggregation requires fresh independent evidence and no conflict", () => {
  const result = aggregatePlaceSignals(
    [
      signal({
        id: "weather-1",
        dimension: "weather",
        valueCode: "clear",
        sourceId: "kma",
        sourceType: "official_live",
        sourceName: "기상청",
      }),
      signal({
        id: "condition-1",
        dimension: "local_condition",
        valueCode: "safe",
        sourceId: "user-a",
      }),
      signal({ id: "crowd-1", dimension: "crowd", valueCode: "quiet", sourceId: "user-b" }),
    ],
    beachProfile,
    now,
  );

  assert.equal(result.status, "likely_good");
  assert.equal(result.independentSourceCount, 3);
  assert.deepEqual(result.conflictingDimensions, []);
});

test("aggregation preserves conflicts and does not collapse them into a positive result", () => {
  const result = aggregatePlaceSignals(
    [
      signal({
        id: "weather-1",
        dimension: "weather",
        valueCode: "clear",
        sourceId: "kma",
        sourceType: "official_live",
        sourceName: "기상청",
      }),
      signal({ id: "condition-1", dimension: "local_condition", valueCode: "safe", sourceId: "user-a" }),
      signal({ id: "condition-2", dimension: "local_condition", valueCode: "danger", sourceId: "user-b" }),
    ],
    beachProfile,
    now,
  );

  assert.equal(result.status, "check_before_visit");
  assert.deepEqual(result.conflictingDimensions, ["local_condition"]);
});

test("all launch feature flags default to disabled and support a region override", () => {
  assert.deepEqual(DEFAULT_FEATURE_FLAGS, {
    QNA_ENABLED: false,
    REWARDS_ENABLED: false,
    ADS_ENABLED: false,
    LIVE_STREAMS_ENABLED: false,
    DEMO_DATA_ENABLED: false,
    SEOUL_REALTIME_ENABLED: false,
    SOCIAL_FEED_ENABLED: false,
  });
  assert.equal(resolveFeatureFlag("QNA_ENABLED", [], "busan"), false);
  assert.equal(
    resolveFeatureFlag(
      "QNA_ENABLED",
      [
        { key: "QNA_ENABLED", enabled: false, scopeType: "global", scopeKey: "*" },
        { key: "QNA_ENABLED", enabled: true, scopeType: "region", scopeKey: "busan" },
      ],
      "busan",
    ),
    true,
  );
});

test("report observations omit dimensions the user did not observe", () => {
  assert.deepEqual(
    listObservedReportSignals({
      crowd: "unknown",
      queue: "10_to_30",
      parking: undefined,
      localConditions: ["rain", "not_observed", "slippery"],
    }),
    [
      { dimension: "queue", valueCode: "10_to_30" },
      { dimension: "local_condition", valueCode: "rain" },
      { dimension: "local_condition", valueCode: "slippery" },
    ],
  );
});

test("anonymous and member identities use separate stable namespaces", () => {
  assert.equal(identityKey({ kind: "anonymous", anonymousId: "anon-1" }), "anonymous:anon-1");
  assert.equal(identityKey({ kind: "member", profileId: "profile-1" }), "member:profile-1");
});

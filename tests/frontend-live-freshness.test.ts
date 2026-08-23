import assert from "node:assert/strict";
import test from "node:test";

const { createRequestGeneration, currentPlaceStatus, hasCurrentExpiry, nextExpiryDelay } = await import(
  new URL("../src/lib/live-freshness.ts", import.meta.url).href
);

const nowMs = Date.parse("2026-07-11T00:00:00.000Z");

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "signal-weather",
    placeId: "busan-gwangalli",
    dimension: "weather",
    valueCode: "clear",
    sourceId: "source-kma-weather",
    sourceType: "official_periodic",
    sourceName: "기상청",
    observedAt: "2026-07-10T23:50:00.000Z",
    fetchedAt: "2026-07-10T23:51:00.000Z",
    expiresAt: "2026-07-11T00:20:00.000Z",
    confidenceScore: 0.9,
    isEstimated: false,
    isExpired: false,
    ...overrides,
  };
}

function status(currentSignals: ReturnType<typeof signal>[]) {
  return {
    contractVersion: 2,
    placeId: "busan-gwangalli",
    dataMode: "live",
    status: "likely_good",
    currentSignals,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    independentSourceCount: currentSignals.length,
    confidenceScore: 0.8,
    reasonCodes: ["independent_positive_evidence"],
    observedAt: "2026-07-10T23:55:00.000Z",
    computedAt: "2026-07-10T23:55:00.000Z",
  };
}

test("frontend keeps fresh weather while removing expired or unbounded dimensions", () => {
  const filtered = currentPlaceStatus(
    status([
      signal(),
      signal({
        id: "signal-parking-expired",
        dimension: "parking",
        sourceId: "source-user-report",
        sourceType: "verified_ugc",
        expiresAt: "2026-07-10T23:59:59.000Z",
        confidenceScore: 0.7,
      }),
      signal({
        id: "signal-crowd-unbounded",
        dimension: "crowd",
        sourceId: "source-user-report",
        sourceType: "ugc",
        expiresAt: undefined,
        confidenceScore: 0.5,
      }),
    ]),
    nowMs,
  );

  assert.ok(filtered);
  assert.equal(filtered.status, "insufficient");
  assert.deepEqual(filtered.currentSignals.map((item: { id: string }) => item.id), ["signal-weather"]);
  assert.equal(filtered.observedAt, "2026-07-10T23:50:00.000Z");
  assert.deepEqual(filtered.reasonCodes, ["independent_positive_evidence", "client_expired_signal_filtered"]);
});

test("frontend excludes official static observations from current state", () => {
  const filtered = currentPlaceStatus(
    status([
      signal(),
      signal({
        id: "signal-static-weather",
        sourceType: "official_static",
        expiresAt: "2026-07-11T01:00:00.000Z",
      }),
    ]),
    nowMs,
  );

  assert.ok(filtered);
  assert.equal(filtered.status, "insufficient");
  assert.deepEqual(filtered.currentSignals.map((item: { id: string }) => item.id), ["signal-weather"]);
});

test("frontend fails closed when a live status has no current signals", () => {
  const filtered = currentPlaceStatus(status([]), nowMs);

  assert.ok(filtered);
  assert.equal(filtered.status, "insufficient");
  assert.deepEqual(filtered.currentSignals, []);
  assert.equal(filtered.independentSourceCount, 0);
  assert.equal(filtered.confidenceScore, 0);
  assert.equal(filtered.observedAt, null);
  assert.deepEqual(filtered.reasonCodes, ["independent_positive_evidence", "client_no_current_signal"]);
});

test("frontend report freshness fails closed and schedules the exact next expiry", () => {
  assert.equal(hasCurrentExpiry({ expiresAt: undefined }, nowMs), false);
  assert.equal(hasCurrentExpiry({ expiresAt: "invalid" }, nowMs), false);
  assert.equal(hasCurrentExpiry({ expiresAt: "2026-07-10T23:59:59.000Z" }, nowMs), false);
  assert.equal(hasCurrentExpiry({ expiresAt: "2026-07-11T00:00:10.000Z" }, nowMs), true);
  assert.equal(
    nextExpiryDelay(
      [
        { expiresAt: "2026-07-11T00:00:30.000Z" },
        { expiresAt: "2026-07-11T00:00:10.000Z" },
        { expiresAt: undefined },
      ],
      nowMs,
    ),
    10_000,
  );
});

test("only the newest overlapping request generation may commit", async () => {
  const generations = createRequestGeneration();
  const commits: string[] = [];
  let resolveOld: ((value: string) => void) | undefined;
  let resolveNew: ((value: string) => void) | undefined;
  const oldResponse = new Promise<string>((resolve) => { resolveOld = resolve; });
  const newResponse = new Promise<string>((resolve) => { resolveNew = resolve; });

  const run = async (response: Promise<string>) => {
    const generation = generations.begin();
    const value = await response;
    if (generations.isCurrent(generation)) {
      commits.push(value);
    }
  };
  const oldRun = run(oldResponse);
  const newRun = run(newResponse);
  resolveNew?.("new");
  await newRun;
  resolveOld?.("old");
  await oldRun;

  assert.deepEqual(commits, ["new"]);
});

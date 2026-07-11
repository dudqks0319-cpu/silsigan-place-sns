import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/lib/errors.ts";
import {
  assertLocalDemoApiAvailable,
  isRuntimeDataModeAllowed,
  shouldClearTruthBearingDataOnLoadFailure,
} from "../src/lib/runtime-data-mode.ts";
import { getStore } from "../src/lib/store.ts";

test("production rejects a demo runtime transition while local preview remains available", () => {
  assert.equal(isRuntimeDataModeAllowed("production", "live"), true);
  assert.equal(isRuntimeDataModeAllowed("production", "demo"), false);
  assert.equal(isRuntimeDataModeAllowed("development", "demo"), true);
});

test("production clears stale current-state data when a refresh request fails", () => {
  assert.equal(shouldClearTruthBearingDataOnLoadFailure("production"), true);
  assert.equal(shouldClearTruthBearingDataOnLoadFailure("development"), false);
});

test("production rejects every legacy Next demo API access with a stable 503 code", () => {
  const isLiveBackendRequired = (error: unknown) =>
    error instanceof ApiError && error.status === 503 && error.code === "LIVE_BACKEND_REQUIRED";

  assert.throws(() => assertLocalDemoApiAvailable("production"), isLiveBackendRequired);
  assert.throws(() => getStore("demo", "production").listHashtags(), isLiveBackendRequired);
  assert.doesNotThrow(() => assertLocalDemoApiAvailable("development"));
});

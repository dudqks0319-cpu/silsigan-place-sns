import assert from "node:assert/strict";
import test from "node:test";
import { assertLegacyWriteAllowed, isCommunityReadEnabled, isLegacyDemoEnabled, isRecentPublicPost } from "../src/lib/legacy-access.ts";
import { ApiError } from "../src/lib/errors.ts";

test("legacy public mutations are disabled unless a local in-memory demo is explicitly requested", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { SILSIGAN_ENABLE_LEGACY_DEMO_WRITES: "false" }]) {
    assert.equal(isLegacyDemoEnabled(env), false);
    assert.throws(() => assertLegacyWriteAllowed(env), (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === "LEGACY_WRITE_DISABLED");
  }
  for (const driver of [undefined, "demo", "mock"]) {
    const env = { NODE_ENV: "development", SILSIGAN_ENABLE_LEGACY_DEMO_WRITES: "true", SILSIGAN_STORE_DRIVER: driver };
    assert.equal(isLegacyDemoEnabled(env), true);
    assert.doesNotThrow(() => assertLegacyWriteAllowed(env));
  }
});

test("the demo flag cannot enable anonymous writes against Supabase or a deployed production/preview app", () => {
  const enabled = { SILSIGAN_ENABLE_LEGACY_DEMO_WRITES: "true", SILSIGAN_STORE_DRIVER: "demo", NODE_ENV: "development" };
  for (const env of [
    { ...enabled, SILSIGAN_STORE_DRIVER: "supabase" },
    { ...enabled, SILSIGAN_STORE_DRIVER: "unknown" },
    { ...enabled, NODE_ENV: "production" },
    { ...enabled, VERCEL: "1" },
    { ...enabled, VERCEL: "true", NODE_ENV: "test" },
  ]) {
    assert.equal(isLegacyDemoEnabled(env), false);
    assert.throws(() => assertLegacyWriteAllowed(env), ApiError);
  }
});

test("public community reads require both the real store and explicit opt-in", () => {
  for (const env of [{}, { SILSIGAN_STORE_DRIVER: "supabase" }, { LOCAL_LIVE_COMMUNITY_ENABLED: "true" }, { SILSIGAN_STORE_DRIVER: "demo", LOCAL_LIVE_COMMUNITY_ENABLED: "true" }]) {
    assert.equal(isCommunityReadEnabled(env), false);
  }
  assert.equal(isCommunityReadEnabled({ SILSIGAN_STORE_DRIVER: "supabase", LOCAL_LIVE_COMMUNITY_ENABLED: "true" }), true);
});

test("only visible, valid, recent past reports can appear in public feeds and share previews", () => {
  const now = new Date("2026-11-24T03:00:00.000Z");
  assert.equal(isRecentPublicPost({ createdAt: "2026-11-24T03:00:00.000Z", hiddenAt: null }, now), true);
  assert.equal(isRecentPublicPost({ createdAt: "2026-11-24T00:00:00.001Z" }, now), true);
  for (const post of [
    { createdAt: "2026-11-24T00:00:00.000Z" },
    { createdAt: "2026-11-23T23:59:00.000Z" },
    { createdAt: "2026-11-24T03:00:00.001Z" },
    { createdAt: "invalid" },
    { createdAt: "2026-11-24T02:59:00.000Z", hiddenAt: "2026-11-24T03:00:00.000Z" },
  ]) assert.equal(isRecentPublicPost(post, now), false);
});

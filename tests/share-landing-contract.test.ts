import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { findSharedPost, isSafePlaceId } = await import(new URL("../src/lib/shared-post.ts", import.meta.url).href);

const testDir = dirname(fileURLToPath(import.meta.url));
const sharePageSource = readFileSync(resolve(testDir, "../src/app/share/post/[postId]/page.tsx"), "utf8");
const placePageSource = readFileSync(resolve(testDir, "../src/app/place/[placeId]/page.tsx"), "utf8");

function sharedPostPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "post_share_1",
    placeId: "busan-gwangalli",
    hiddenAt: null,
    locationVerified: true,
    photoLabel: "방금 현장 사진",
    crowdLevel: "normal",
    parkingStatus: "limited",
    lineStatus: "short",
    createdAt: "2026-07-19T01:00:00.000Z",
    shareCard: {
      headline: "광안리 지금",
      body: "현재 공개 가능한 현장 정보입니다.",
      url: "https://worker.example.test/place/busan-gwangalli",
      hashtags: ["광안리", "지금"],
      variant: "neutral",
    },
    status: {
      dataMode: "live",
      status: "check_before_visit",
      currentSignals: [],
      independentSourceCount: 1,
      confidenceScore: 0.8,
      reasonCodes: [],
      observedAt: "2026-07-19T01:05:00.000Z",
      computedAt: "2026-07-19T01:06:00.000Z",
    },
    thumbnail: {
      url: "https://worker.example.test/api/photos/photo_1/file",
      alt: "광안리 현장 사진",
      moderationStatus: "approved",
    },
    ...overrides,
  };
}

async function lookupWorkerPayload(data: unknown) {
  return findSharedPost("post_share_1", {
    env: { SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test" },
    fetcher: async () => Response.json({ success: true, data }),
  });
}

test("shared landing normalizes safe place, observation, and approved same-origin thumbnail data", async () => {
  const post = await lookupWorkerPayload(sharedPostPayload());

  assert.equal(post?.placeId, "busan-gwangalli");
  assert.equal(post?.observedAt, "2026-07-19T01:05:00.000Z");
  assert.deepEqual(post?.thumbnail, {
    url: "https://worker.example.test/api/photos/photo_1/file",
    alt: "광안리 현장 사진",
    moderationStatus: "approved",
  });
});

test("shared landing drops unapproved or unsafe thumbnails without dropping the post", async () => {
  const unapproved = await lookupWorkerPayload(
    sharedPostPayload({
      thumbnail: {
        url: "https://worker.example.test/api/photos/photo_1/file",
        alt: "검토 중 사진",
        moderationStatus: "pending",
      },
    }),
  );
  const crossOrigin = await lookupWorkerPayload(
    sharedPostPayload({
      thumbnail: {
        url: "https://tracker.example.test/pixel",
        alt: "외부 사진",
        moderationStatus: "approved",
      },
    }),
  );
  const insecure = await lookupWorkerPayload(
    sharedPostPayload({
      thumbnail: {
        url: "http://worker.example.test/api/photos/photo_1/file",
        alt: "비보안 사진",
        moderationStatus: "approved",
      },
    }),
  );

  assert.equal(unapproved?.thumbnail, null);
  assert.equal(crossOrigin?.thumbnail, null);
  assert.equal(insecure?.thumbnail, null);
});

test("shared landing rejects unsafe place IDs and replaces unsafe share-card destinations", async () => {
  const unsafePlace = await lookupWorkerPayload(sharedPostPayload({ placeId: "../admin" }));
  const wrongPlaceUrl = await lookupWorkerPayload(
    sharedPostPayload({
      shareCard: {
        headline: "광안리 지금",
        body: "현재 공개 가능한 현장 정보입니다.",
        url: "https://worker.example.test/place/seoul-yeouido",
        hashtags: ["광안리"],
        variant: "neutral",
      },
    }),
  );
  const trackingUrl = await lookupWorkerPayload(
    sharedPostPayload({
      shareCard: {
        headline: "광안리 지금",
        body: "현재 공개 가능한 현장 정보입니다.",
        url: "https://worker.example.test/place/busan-gwangalli?token=unsafe",
        hashtags: ["광안리"],
        variant: "neutral",
      },
    }),
  );

  assert.equal(unsafePlace, null);
  assert.equal(wrongPlaceUrl?.shareCard.url, "/place/busan-gwangalli");
  assert.equal(trackingUrl?.shareCard.url, "/place/busan-gwangalli");
});

test("shared landing uses a valid createdAt only when status observation is unavailable", async () => {
  const post = await lookupWorkerPayload(
    sharedPostPayload({
      status: {
        dataMode: "live",
        status: "insufficient",
        currentSignals: [],
        independentSourceCount: 0,
        confidenceScore: 0,
        reasonCodes: ["no_current_evidence"],
        observedAt: null,
        computedAt: "2026-07-19T01:06:00.000Z",
      },
    }),
  );
  const invalid = await lookupWorkerPayload(
    sharedPostPayload({
      createdAt: "not-a-date",
      status: {
        dataMode: "live",
        status: "insufficient",
        currentSignals: [],
        independentSourceCount: 0,
        confidenceScore: 0,
        reasonCodes: ["no_current_evidence"],
        observedAt: null,
        computedAt: "2026-07-19T01:06:00.000Z",
      },
    }),
  );

  assert.equal(post?.observedAt, "2026-07-19T01:00:00.000Z");
  assert.equal(invalid, null);
});

test("place IDs and landing navigation stay path-safe and target the exact local place", () => {
  assert.equal(isSafePlaceId("busan-gwangalli"), true);
  assert.equal(isSafePlaceId("../admin"), false);
  assert.equal(isSafePlaceId("busan/gwangalli"), false);
  assert.equal(isSafePlaceId("BUSAN"), false);

  assert.match(sharePageSource, /const placeUrl = `\/place\/\$\{encodeURIComponent\(post\.placeId\)\}`;/);
  assert.match(sharePageSource, /<a className=\{styles\.cta\} href=\{placeUrl\}>/);
  assert.match(placePageSource, /if \(!isSafePlaceId\(placeId\)\) \{\s*notFound\(\);/);
  assert.match(placePageSource, /redirect\(`\/\?place=\$\{encodeURIComponent\(placeId\)\}`\);/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { REGIONS, findNearestRegion, getRegion } from "../src/features/local-live/regions.ts";
import { getGuidePlaces } from "../src/features/local-live/guides.ts";
import { parseLocalLiveQuery } from "../src/features/local-live/query.ts";
import { normalizeCommunityReports, getCommunityReports } from "../src/features/local-live/community.ts";

test("region lookup is stable and geolocation never substitutes an unrelated foreign place", () => {
  assert.equal(new Set(REGIONS.map((region) => region.id)).size, REGIONS.length);
  assert.equal(findNearestRegion(35.54, 129.31)?.id, "ulsan");
  assert.equal(findNearestRegion(33.5, 126.53)?.id, "jeju");
  assert.equal(findNearestRegion(40.71, -74)?.id, undefined);
  assert.equal(findNearestRegion(Number.NaN, 129), null);
  assert.equal(getRegion("invalid").id, "ulsan");
});

test("server rejects invalid region/category/long searches and raw location input", () => {
  const query = (value: string) => parseLocalLiveQuery(new URL(`https://app.example/api/local-live?${value}`));
  assert.equal(query("").region, "ulsan");
  assert.throws(() => query("region=unknown"));
  assert.throws(() => query("region=ulsan&latitude=35.123456"));
  assert.throws(() => query("category=pretend"));
  assert.throws(() => query(`q=${"a".repeat(81)}`));
  assert.equal(query("region=busan&category=cafe&q=%20coffee%20").q, "coffee");
});

test("directory guidance never impersonates live weather, facilities or local reports", () => {
  const guides = getGuidePlaces("ulsan", "all", "태화강");
  assert.equal(guides.length, 1);
  assert.match(guides[0].sourceName, /실시간 정보 아님/);
  assert.equal("weather" in guides[0], false);
  assert.equal("crowd" in guides[0], false);
  assert.equal(getGuidePlaces("ulsan", "parking", "").length, 0);
  assert.equal(getGuidePlaces("seoul", "all", "").length, 0);
});

const now = new Date("2026-11-24T03:00:00Z");
const row = {
  id: "report-id", place_id: "ulsan-taehwagang", caption: "산책 중", crowd_level: "quiet", parking_status: "unknown",
  location_verified: false, hidden_at: null, created_at: "2026-11-24T02:30:00Z", place: { name: "태화강 국가정원", region: "ulsan" },
};

test("community feed omits hidden, future, expired, malformed and other-region records", () => {
  const rows = [
    row,
    { ...row, id: "hidden", hidden_at: now.toISOString() },
    { ...row, id: "expired", created_at: "2026-11-24T00:00:00Z" },
    { ...row, id: "future", created_at: "2026-11-24T03:01:00Z" },
    { ...row, id: "wrong-region", place: { name: "광안리", region: "busan" } },
    { ...row, id: "broken", crowd_level: "unproven" },
  ];
  const results = normalizeCommunityReports(rows, "ulsan", now);
  assert.deepEqual(results.map((report) => report.id), ["report-id"]);
  assert.match(results[0].crowd, /제보/);
  assert.equal(results[0].locationVerified, false);
  assert.equal("latitude" in results[0], false);
});

test("missing community configuration returns no simulated fresh reports", async () => {
  const oldFlag = process.env.LOCAL_LIVE_COMMUNITY_ENABLED;
  delete process.env.LOCAL_LIVE_COMMUNITY_ENABLED;
  try {
    const result = await getCommunityReports(getRegion("ulsan"));
    assert.equal(result.status, "not_configured");
    assert.equal(result.data, null);
    assert.equal(result.observedAt, null);
  } finally {
    if (oldFlag === undefined) delete process.env.LOCAL_LIVE_COMMUNITY_ENABLED;
    else process.env.LOCAL_LIVE_COMMUNITY_ENABLED = oldFlag;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  KOREA_SIDO_REGIONS,
  isKoreaPlaceRegionId,
  isKoreaSidoId,
  placeRegionIdsForScope,
  placeRegionMatchesScope,
} from "../packages/contracts/src/index.ts";

test("nationwide scope exposes all 17 Korean first-level regions without synthetic place data", () => {
  assert.equal(KOREA_SIDO_REGIONS.length, 17);
  assert.equal(new Set(KOREA_SIDO_REGIONS.map((region) => region.id)).size, 17);
  assert.equal(KOREA_SIDO_REGIONS.every((region) => isKoreaSidoId(region.id)), true);
  assert.equal(KOREA_SIDO_REGIONS.every((region) => isKoreaPlaceRegionId(region.id)), true);
  assert.deepEqual(placeRegionIdsForScope("nationwide"), []);
});

test("province scopes include existing city-level place identifiers", () => {
  assert.deepEqual(placeRegionIdsForScope("gyeongbuk"), ["gyeongbuk", "gyeongju", "pohang"]);
  assert.deepEqual(placeRegionIdsForScope("gyeongnam"), ["gyeongnam", "changwon", "gimhae", "yangsan"]);
  assert.equal(placeRegionMatchesScope("gyeongju", "gyeongbuk"), true);
  assert.equal(placeRegionMatchesScope("busan", "gyeongbuk"), false);
  assert.equal(placeRegionMatchesScope("busan", "nationwide"), true);
});

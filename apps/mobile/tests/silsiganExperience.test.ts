import assert from "node:assert/strict";
import test from "node:test";
import {
  getHomePriority,
  getQuestionControls,
  nationwidePlaces,
  serviceScope,
  type ReportSnapshot,
} from "../src/silsiganExperience.ts";

test("service scope is nationwide instead of a regional beta", () => {
  assert.equal(serviceScope.label, "전국 실시간");
  assert.equal(serviceScope.shortCopy.includes("울산"), false);
  assert.equal(serviceScope.regions.length >= 8, true);
});

test("nationwide places cover multiple Korean regions and core use cases", () => {
  const regionSet = new Set(nationwidePlaces.map((place) => place.region));
  const categorySet = new Set(nationwidePlaces.map((place) => place.category));

  assert.equal(regionSet.has("서울"), true);
  assert.equal(regionSet.has("제주"), true);
  assert.equal(regionSet.has("강원"), true);
  assert.equal(categorySet.has("주차"), true);
  assert.equal(categorySet.has("병원"), true);
  assert.equal(categorySet.has("관광지"), true);
});

test("home priority puts live evidence before marketing copy", () => {
  const reports: ReportSnapshot[] = [
    { placeId: "jeju-airport", verified: true, hasPhoto: false, minutesAgo: 8 },
    { placeId: "seoul-gwanghwamun", verified: false, hasPhoto: true, minutesAgo: 2 },
  ];

  assert.deepEqual(getHomePriority(reports).slice(0, 4), [
    "search",
    "live-summary",
    "quick-actions",
    "recent-reports",
  ]);
});

test("question form exposes a single photo request control", () => {
  assert.deepEqual(getQuestionControls(), {
    includesPhotoRequestType: true,
    includesSeparatePhotoCheckbox: false,
  });
});

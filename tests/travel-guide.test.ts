import assert from "node:assert/strict";
import test from "node:test";
import { buildGroundedTravelGuide } from "../src/lib/travel-guide.ts";

const verifiedTourismAnchor = {
  contentId: "126508",
  name: "광안리해수욕장",
  address: "부산광역시 수영구 광안해변로 219",
  sourceName: "한국관광공사 TourAPI",
  attributionText: "한국관광공사",
  verifiedAt: "2026-07-20T00:00:00.000Z",
} as const;

test("grounded travel guide recommends going now only with current, non-conflicting evidence", () => {
  const guide = buildGroundedTravelGuide({
    dataMode: "live",
    status: "likely_good",
    signalCount: 3,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    alternativeCount: 2,
    officialTourismPlace: verifiedTourismAnchor,
  });

  assert.equal(guide.decision, "go_now");
  assert.equal(guide.title, "지금 가기");
  assert.equal(guide.ctaLabel, "현장 사진 확인");
  assert.equal(guide.tourApiGrounded, true);
  assert.match(guide.sourceLine, /한국관광공사 TourAPI/);
  assert.match(guide.sourceLine, /최신 근거 3개/);
});

test("grounded travel guide sends crowded travelers to nearby alternatives", () => {
  const guide = buildGroundedTravelGuide({
    dataMode: "live",
    status: "likely_crowded",
    signalCount: 2,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    alternativeCount: 4,
    officialTourismPlace: verifiedTourismAnchor,
  });

  assert.equal(guide.decision, "alternatives");
  assert.equal(guide.title, "근처 대안 보기");
  assert.equal(guide.ctaLabel, "대안 4곳 확인");
});

test("grounded travel guide waits when required inputs are missing or sources conflict", () => {
  const missing = buildGroundedTravelGuide({
    dataMode: "live",
    status: "likely_good",
    signalCount: 2,
    missingRequiredDimensions: ["weather"],
    conflictingDimensions: [],
    alternativeCount: 3,
    officialTourismPlace: verifiedTourismAnchor,
  });
  const conflicting = buildGroundedTravelGuide({
    dataMode: "live",
    status: "likely_good",
    signalCount: 2,
    missingRequiredDimensions: [],
    conflictingDimensions: ["crowd"],
    alternativeCount: 3,
    officialTourismPlace: verifiedTourismAnchor,
  });

  assert.equal(missing.decision, "wait");
  assert.equal(conflicting.decision, "wait");
  assert.equal(missing.title, "조금 기다리기");
  assert.match(conflicting.summary, /엇갈/);
});

test("grounded travel guide fails closed for samples, protected directory mode, and missing live evidence", () => {
  for (const dataMode of ["sample", "directory", "unavailable"] as const) {
    const guide = buildGroundedTravelGuide({
      dataMode,
      status: "likely_good",
      signalCount: 3,
      missingRequiredDimensions: [],
      conflictingDimensions: [],
      alternativeCount: 2,
      officialTourismPlace: verifiedTourismAnchor,
    });

    assert.equal(guide.decision, "insufficient");
    assert.equal(guide.title, "판단 보류");
  }

  const noEvidence = buildGroundedTravelGuide({
    dataMode: "live",
    status: "likely_good",
    signalCount: 0,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    alternativeCount: 2,
    officialTourismPlace: null,
  });

  assert.equal(noEvidence.decision, "insufficient");
  assert.equal(noEvidence.tourApiGrounded, false);
  assert.match(noEvidence.sourceLine, /TourAPI 관광지 매핑 확인 필요/);
  assert.deepEqual(noEvidence.hashtags, ["실시간", "여행가이드", "연관관광지추천", "카드뉴스형답변"]);

  const protectedDirectory = buildGroundedTravelGuide({
    dataMode: "directory",
    status: "insufficient",
    signalCount: 0,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    alternativeCount: 2,
    officialTourismPlace: null,
  });
  assert.equal(protectedDirectory.ctaLabel, "근처 2곳 보기");

  const mapFallback = buildGroundedTravelGuide({
    dataMode: "directory",
    status: "insufficient",
    signalCount: 0,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    alternativeCount: 0,
    officialTourismPlace: null,
  });
  assert.equal(mapFallback.ctaLabel, "지도에서 대안 찾기");
});

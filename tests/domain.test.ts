import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateCreditBalance,
  creditEventForQuestion,
  creditEventsForReport,
  judgementFromStatus,
  getCategorySafetyWarning,
  getQuestionCost,
  getReportExpiry,
  isReportExpired,
  recommendHashtags,
  shouldHideForFlags,
  verifiedRadiusFromDistance,
} = await import(new URL("../src/lib/domain.ts", import.meta.url).href);

const { createPost, createReport, flagPost, listPosts } = await import(new URL("../src/lib/mock-store.ts", import.meta.url).href);

test("reports expire three hours after creation", () => {
  const createdAt = new Date("2026-05-08T00:00:00.000Z");
  const expiresAt = getReportExpiry(createdAt);

  assert.equal(expiresAt.toISOString(), "2026-05-08T03:00:00.000Z");
  assert.equal(isReportExpired(expiresAt, new Date("2026-05-08T02:59:59.000Z")), false);
  assert.equal(isReportExpired(expiresAt, new Date("2026-05-08T03:00:00.000Z")), true);
});

test("question credits follow MVP cost rules", () => {
  assert.equal(getQuestionCost("crowd"), 1);
  assert.equal(getQuestionCost("photo_request"), 2);
  assert.deepEqual(creditEventForQuestion("photo_request"), {
    type: "ask_photo_request",
    amount: -2,
  });
});

test("credit balance supports signup, reports, answers, questions, and false-report penalty", () => {
  const balance = calculateCreditBalance([
    { type: "signup_bonus", amount: 3 },
    ...creditEventsForReport(true, true),
    { type: "answer_question", amount: 2 },
    creditEventForQuestion("other"),
    { type: "confirmed_false_report", amount: -5 },
  ]);

  assert.equal(balance, 1);
});

test("sensitive categories return upload warnings", () => {
  assert.match(getCategorySafetyWarning("hospital") ?? "", /환자 얼굴/);
  assert.match(getCategorySafetyWarning("public_office") ?? "", /서류/);
  assert.equal(getCategorySafetyWarning("parking"), null);
});

test("flag rules hide privacy-sensitive, repeated false, or high-volume reports", () => {
  assert.equal(shouldHideForFlags(["privacy_face"]), true);
  assert.equal(shouldHideForFlags(["false_content"]), false);
  assert.equal(shouldHideForFlags(["false_content", "false_content"]), true);
  assert.equal(shouldHideForFlags(["spam", "other"]), false);
  assert.equal(shouldHideForFlags(["spam", "other", "false_content"]), true);
});

test("verified radius stores only coarse radius buckets", () => {
  assert.equal(verifiedRadiusFromDistance(30), 50);
  assert.equal(verifiedRadiusFromDistance(120), 150);
  assert.equal(verifiedRadiusFromDistance(250), 300);
  assert.equal(verifiedRadiusFromDistance(301), null);
});

test("distance outside 300m cannot produce a persisted verification radius", () => {
  assert.equal(verifiedRadiusFromDistance(1_000), null);
});

test("report creation returns a coarse radius and does not persist client coordinates", () => {
  const result = createReport({
    placeId: "ulsan-taehwagang",
    category: "tourism",
    crowdLevel: "normal",
    lineStatus: "short",
    parkingStatus: "limited",
    weatherFeel: "windy",
    comment: "주차장은 조금 붐벼요.",
    clientLocation: {
      latitude: 35.5486,
      longitude: 129.3005,
    },
  });

  assert.equal(result.report.verifiedRadiusM, 50);
  assert.equal("clientLocation" in result.report, false);
  assert.equal("latitude" in result.report, false);
  assert.equal("longitude" in result.report, false);
});

test("status-only reports can be created without location permission", () => {
  const result = createReport({
    placeId: "gyeongju-hwangridan",
    category: "restaurant_cafe",
    crowdLevel: "busy",
    lineStatus: "medium",
    parkingStatus: "limited",
    weatherFeel: "good",
    comment: "사진 없이 웨이팅만 제보합니다.",
  });

  assert.equal(result.report.verifiedRadiusM, null);
  assert.deepEqual(result.credits, []);
});

test("hashtag recommendation is specific and capped at five", () => {
  const tags = recommendHashtags({
    place: {
      id: "busan-gwangalli",
      name: "광안리해수욕장",
      address: "부산 수영구 광안해변로",
      category: "tourism",
      latitude: 35.1532,
      longitude: 129.1186,
      region: "busan",
    },
    crowdLevel: "packed",
    parkingStatus: "full",
    lineStatus: "medium",
    weatherFeel: "good",
  });

  assert.ok(tags.includes("광안리해수욕장지금"));
  assert.ok(tags.includes("주차만차"));
  assert.ok(tags.includes("부산"));
  assert.equal(tags.length <= 5, true);
});

test("feed posts generate share cards and privacy reports can hide posts", () => {
  const created = createPost({
    placeId: "busan-gwangalli",
    crowdLevel: "packed",
    lineStatus: "long",
    parkingStatus: "full",
    weatherFeel: "good",
    caption: "주차 만차라 지금은 우회가 좋아요.",
    photoCount: 1,
    hashtagNames: ["#광안리주차", "#주차만차", "#부산", "#지금", "#부산아이랑", "#초과태그"],
    clientLocation: {
      latitude: 35.1532,
      longitude: 129.1186,
    },
  });

  assert.equal(created.post.hashtagNames.length, 5);
  assert.match(created.post.shareCard.headline, /지금은 비추/);
  assert.equal(judgementFromStatus("packed", "full"), "지금은 비추");

  const flagResult = flagPost({
    postId: created.post.id,
    reason: "privacy_plate",
  });

  assert.equal(flagResult.hidden, true);
  assert.equal(listPosts({ includeHidden: false }).some((post: { id: string }) => post.id === created.post.id), false);
});

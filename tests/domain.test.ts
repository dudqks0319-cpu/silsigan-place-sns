import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateCreditBalance,
  calculateTrustScore,
  canActivateRegion,
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

const { createPost, createReport, flagPost, listPostModerationQueue, listPosts } = await import(new URL("../src/lib/mock-store.ts", import.meta.url).href);
const { isAdminTokenValid } = await import(new URL("../src/lib/admin-auth.ts", import.meta.url).href);
const { assertRateLimit, clearRateLimitBucketsForTests } = await import(new URL("../src/lib/rate-limit.ts", import.meta.url).href);
const { getStore } = await import(new URL("../src/lib/store.ts", import.meta.url).href);

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

test("local reputation score rewards verified helpful reports and penalizes abuse", () => {
  assert.equal(
    calculateTrustScore({
      verifiedReports: 4,
      helpfulReceived: 12,
      falseReports: 1,
      privacyViolations: 0,
    }),
    60,
  );
  assert.equal(calculateTrustScore({ verifiedReports: 99, helpfulReceived: 99, falseReports: 0, privacyViolations: 0 }), 95);
  assert.equal(calculateTrustScore({ verifiedReports: 0, helpfulReceived: 0, falseReports: 3, privacyViolations: 2 }), 0);
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
      regionId: "busan",
      launchStage: "active",
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

test("region activation requires density and moderation readiness", () => {
  assert.equal(
    canActivateRegion({
      seedPlaceCount: 30,
      reportsLast7Days: 100,
      verifiedReportsLast7Days: 30,
      photoReportsLast7Days: 30,
      moderationFlowReady: true,
    }),
    true,
  );
  assert.equal(
    canActivateRegion({
      seedPlaceCount: 30,
      reportsLast7Days: 100,
      verifiedReportsLast7Days: 29,
      photoReportsLast7Days: 30,
      moderationFlowReady: true,
    }),
    false,
  );
  assert.equal(
    canActivateRegion({
      seedPlaceCount: 50,
      reportsLast7Days: 120,
      verifiedReportsLast7Days: 35,
      photoReportsLast7Days: 35,
      moderationFlowReady: false,
    }),
    false,
  );
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
  assert.equal(created.post.verifiedRadiusM, 50);
  assert.equal(created.post.locationVerified, true);
  assert.match(created.post.shareCard.headline, /지금은 비추/);
  assert.equal(judgementFromStatus("packed", "full"), "지금은 비추");

  const flagResult = flagPost({
    postId: created.post.id,
    reason: "privacy_plate",
  });

  assert.equal(flagResult.hidden, true);
  assert.equal(listPosts({ includeHidden: false }).some((post: { id: string }) => post.id === created.post.id), false);
  assert.equal(listPostModerationQueue({ reason: "privacy_plate" }).some((item: { post: { id: string } }) => item.post.id === created.post.id), true);
});

test("posts without real user location remain status reports", () => {
  const created = createPost({
    placeId: "ulsan-taehwagang",
    crowdLevel: "quiet",
    lineStatus: "none",
    parkingStatus: "available",
    weatherFeel: "good",
    caption: "위치 권한 없이 상태만 제보합니다.",
    photoCount: 0,
    hashtagNames: ["#태화강산책"],
  });

  assert.equal(created.post.verifiedRadiusM, null);
  assert.equal(created.post.locationVerified, false);
});

test("posts more than 300m from the place are created without verification", () => {
  const created = createPost({
    placeId: "busan-gwangalli",
    crowdLevel: "busy",
    lineStatus: "medium",
    parkingStatus: "limited",
    weatherFeel: "good",
    caption: "멀리서 보는 상황이라 인증 배지는 없어야 합니다.",
    photoCount: 1,
    hashtagNames: ["#광안리주차"],
    clientLocation: {
      latitude: 35.18,
      longitude: 129.16,
    },
  });

  assert.equal(created.post.verifiedRadiusM, null);
  assert.equal(created.post.locationVerified, false);
});

test("api routes can use the store abstraction in demo mode", () => {
  const store = getStore("demo");

  assert.equal(typeof store.createPost, "function");
  assert.equal(typeof store.listPosts, "function");
  assert.equal(typeof store.listHashtags, "function");
  assert.equal(typeof store.flagPost, "function");
  assert.equal(typeof store.listPostModerationQueue, "function");
  assert.equal(typeof store.moderatePost, "function");
});

test("store abstraction exposes a supabase driver boundary", async () => {
  const store = getStore("supabase");

  await assert.rejects(
    () => store.listPosts(),
    /Supabase 서버 환경변수가 설정되지 않았습니다/,
  );
});

test("rate limit blocks excess requests within a window", () => {
  clearRateLimitBucketsForTests();
  assert.doesNotThrow(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }));
  assert.doesNotThrow(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }));
  assert.throws(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }), /요청이 너무 많습니다/);
});

test("admin token is deny-by-default when configured", () => {
  const previous = process.env.SILSIGAN_ADMIN_TOKEN;
  process.env.SILSIGAN_ADMIN_TOKEN = "secret-admin-token";

  try {
    assert.equal(isAdminTokenValid("wrong-token"), false);
    assert.equal(isAdminTokenValid("secret-admin-token"), true);
  } finally {
    if (previous === undefined) {
      delete process.env.SILSIGAN_ADMIN_TOKEN;
    } else {
      process.env.SILSIGAN_ADMIN_TOKEN = previous;
    }
  }
});

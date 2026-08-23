import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateCreditBalance,
  calculateTrustScore,
  canActivateRegion,
  creditEventForQuestion,
  creditEventsForReport,
  evaluateRegionActivation,
  formatDistanceMeters,
  judgementFromStatus,
  getCategorySafetyWarning,
  getPostExpiry,
  getQuestionCost,
  getReportExpiry,
  isPostExpired,
  isReportExpired,
  recommendHashtags,
  shouldHideForFlags,
  verifiedRadiusFromDistance,
} = await import(new URL("../src/lib/domain.ts", import.meta.url).href);

const { createPost, createReport, flagPost, listPlaces, listPostModerationQueue, listPosts, listQuestions, listReports, listRegionActivationDashboard, moderatePost } = await import(new URL("../src/lib/mock-store.ts", import.meta.url).href);
const { isAdminTokenValid } = await import(new URL("../src/lib/admin-auth.ts", import.meta.url).href);
const { assertRateLimit, clearRateLimitBucketsForTests, rateLimitKey } = await import(new URL("../src/lib/rate-limit.ts", import.meta.url).href);
const { getStore } = await import(new URL("../src/lib/store.ts", import.meta.url).href);
const { redactAnalyticsProperties, trackEvent } = await import(new URL("../src/lib/analytics.ts", import.meta.url).href);
const { buildScopedApiPath, clampApiLimit, normalizeRegionScope } = await import(new URL("../src/lib/api-scope.ts", import.meta.url).href);
const { workerPlaceToAppPlace } = await import(new URL("../src/lib/cloudflare-place-adapter.ts", import.meta.url).href);
const { findSharedPost, formatSharedPostObservedAt } = await import(new URL("../src/lib/shared-post.ts", import.meta.url).href);
const { createReportSchema, moderatePostSchema } = await import(new URL("../src/lib/validators.ts", import.meta.url).href);
const {
  listWorkerDataSources,
  listWorkerModerationReports,
  listWorkerSourceHealth,
  moderateWorkerReport,
  workerAdminApiConfigured,
} = await import(new URL("../src/lib/worker-admin-api.ts", import.meta.url).href);
const {
  handleAdminWorkerCoordinateStatusPost,
  handleAdminWorkerFieldReportsGet,
  handleAdminWorkerFieldReportsPost,
  handleAdminWorkerReportsGet,
  handleAdminWorkerReportsPost,
  handleAdminWorkerSourceHealthGet,
  handleAdminWorkerUserRestrictPost,
  handleAdminWorkerUserUnrestrictPost,
} = await import(new URL("../src/lib/worker-admin-route.ts", import.meta.url).href);

test("reports expire three hours after creation", () => {
  const createdAt = new Date("2026-05-08T00:00:00.000Z");
  const expiresAt = getReportExpiry(createdAt);

  assert.equal(expiresAt.toISOString(), "2026-05-08T03:00:00.000Z");
  assert.equal(isReportExpired(expiresAt, new Date("2026-05-08T02:59:59.000Z")), false);
  assert.equal(isReportExpired(expiresAt, new Date("2026-05-08T03:00:00.000Z")), true);
});

test("status posts expire three hours after creation and invalid expiry fails closed", () => {
  const createdAt = new Date("2026-05-08T00:00:00.000Z");
  const expiresAt = getPostExpiry(createdAt).toISOString();

  assert.equal(expiresAt, "2026-05-08T03:00:00.000Z");
  assert.equal(isPostExpired(expiresAt, new Date("2026-05-08T02:59:59.000Z")), false);
  assert.equal(isPostExpired(expiresAt, new Date("2026-05-08T03:00:00.000Z")), true);
  assert.equal(isPostExpired("not-a-timestamp", createdAt), true);
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

test("distance labels are human-readable without implying precision", () => {
  assert.equal(formatDistanceMeters(42), "40m");
  assert.equal(formatDistanceMeters(999), "1.0km");
  assert.equal(formatDistanceMeters(1_250), "1.3km");
  assert.equal(formatDistanceMeters(Number.NaN), "거리 정보 없음");
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

test("field reports accept only the dimensions the user actually observed", () => {
  const result = createReport({
    placeId: "busan-gwangalli",
    category: "tourism",
    crowdLevel: "busy",
  });

  assert.equal(result.report.lineStatus, undefined);
  assert.deepEqual(result.report.observations?.map((observation: { dimension: string }) => observation.dimension), ["crowd"]);
});

test("report photo URLs allow only public http protocols", () => {
  const base = {
    placeId: "busan-gwangalli",
    category: "tourism",
    crowdLevel: "normal",
  } as const;

  assert.equal(createReportSchema.safeParse({ ...base, photoUrl: "https://example.com/photo.jpg" }).success, true);
  assert.equal(createReportSchema.safeParse({ ...base, photoUrl: "data:image/png;base64,AAAA" }).success, false);
  assert.equal(createReportSchema.safeParse({ ...base, photoUrl: "javascript:alert(1)" }).success, false);
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

test("region activation evaluation exposes dashboard checks", () => {
  const status = evaluateRegionActivation({
    seedPlaceCount: 30,
    reportsLast7Days: 82,
    verifiedReportsLast7Days: 30,
    photoReportsLast7Days: 11,
    moderationFlowReady: true,
  });

  assert.equal(status.canActivate, false);
  assert.equal(status.passedCount, 3);
  assert.equal(status.totalCount, 5);
  assert.deepEqual(
    status.checks.map((check: { key: string; passed: boolean }) => [check.key, check.passed]),
    [
      ["seedPlaceCount", true],
      ["reportsLast7Days", false],
      ["verifiedReportsLast7Days", true],
      ["photoReportsLast7Days", false],
      ["moderationFlowReady", true],
    ],
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
  assert.equal(created.post.isExpired, false);
  assert.equal(Date.parse(created.post.expiresAt) - Date.parse(created.post.createdAt), 3 * 60 * 60 * 1000);
  assert.match(created.post.shareCard.headline, /지금은 비추/);
  assert.match(created.post.shareCard.body, /현장 인증 제보/);
  assert.equal(created.post.shareCard.url, "https://silsigan.pages.dev/place/busan-gwangalli");
  assert.equal(judgementFromStatus("packed", "full"), "지금은 비추");

  const flagResult = flagPost({
    postId: created.post.id,
    reason: "privacy_plate",
  });

  assert.equal(flagResult.hidden, true);
  assert.equal(listPosts({ includeHidden: false }).some((post: { id: string }) => post.id === created.post.id), false);
  assert.equal(listPostModerationQueue({ reason: "privacy_plate" }).some((item: { post: { id: string } }) => item.post.id === created.post.id), true);

  const keepResult = moderatePost({ postId: created.post.id, action: "keep" });
  assert.equal(keepResult.hidden, false);
  assert.equal(listPosts({ includeHidden: false }).some((post: { id: string }) => post.id === created.post.id), true);
  assert.equal(listPostModerationQueue().some((item: { post: { id: string } }) => item.post.id === created.post.id), false);
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
  assert.match(created.post.shareCard.body, /상태 제보/);
  assert.doesNotMatch(created.post.shareCard.body, /현장 인증 제보/);
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

test("scoped API paths normalize nationwide and clamp broad list limits", () => {
  assert.equal(normalizeRegionScope("nationwide"), undefined);
  assert.equal(normalizeRegionScope("busan"), "busan");
  assert.equal(clampApiLimit(999), 200);
  assert.equal(
    buildScopedApiPath("/api/places", {
      regionId: "busan",
      q: "광안리",
      bbox: "129.000000,35.000000,129.200000,35.200000",
      limit: 999,
    }),
    "/api/places?regionId=busan&q=%EA%B4%91%EC%95%88%EB%A6%AC&bbox=129.000000%2C35.000000%2C129.200000%2C35.200000&limit=200",
  );
  assert.equal(buildScopedApiPath("/api/posts", { regionId: "nationwide", limit: 100 }), "/api/posts?limit=100");
  assert.equal(
    buildScopedApiPath("/api/posts", { regionId: "busan", hashtagName: "광안리주차살려줘", limit: 100 }),
    "/api/posts?regionId=busan&hashtagName=%EA%B4%91%EC%95%88%EB%A6%AC%EC%A3%BC%EC%B0%A8%EC%82%B4%EB%A0%A4%EC%A4%98&limit=100",
  );
  assert.equal(buildScopedApiPath("/api/photos", { placeId: "busan-gwangalli", limit: 12 }), "/api/photos?placeId=busan-gwangalli&limit=12");
});

test("local demo lists support region-scoped bounded reads", () => {
  const busanPlaces = listPlaces({ regionId: "busan", limit: 1 });
  const busanPlaceIds = new Set(listPlaces({ regionId: "busan", limit: 100 }).map((place: { id: string }) => place.id));
  const gyeongbukPlaceIds = new Set(listPlaces({ regionId: "gyeongbuk", limit: 100 }).map((place: { id: string }) => place.id));
  const busanHashtagPosts = listPosts({ regionId: "busan", hashtagName: "광안리주차살려줘", limit: 100 });

  assert.equal(busanPlaces.length, 1);
  assert.equal(busanPlaces.every((place: { regionId: string }) => place.regionId === "busan"), true);
  assert.equal(listPlaces({ regionId: "seoul", limit: 100 }).length, 0);
  assert.equal(gyeongbukPlaceIds.has("gyeongju-hwangridan"), true);
  assert.equal(listPosts({ regionId: "gyeongbuk", limit: 100 }).every((post: { placeId: string }) => gyeongbukPlaceIds.has(post.placeId)), true);
  assert.equal(listReports({ regionId: "busan", limit: 100 }).every((report: { placeId: string }) => busanPlaceIds.has(report.placeId)), true);
  assert.equal(listPosts({ regionId: "busan", limit: 1 }).length, 1);
  assert.equal(listPosts({ regionId: "busan", limit: 100 }).every((post: { placeId: string }) => busanPlaceIds.has(post.placeId)), true);
  assert.equal(busanHashtagPosts.length > 0, true);
  assert.equal(busanHashtagPosts.every((post: { isSample?: boolean }) => post.isSample === true), true);
  assert.equal(busanHashtagPosts.every((post: { placeId: string; hashtagNames: string[] }) => busanPlaceIds.has(post.placeId) && post.hashtagNames.includes("광안리주차살려줘")), true);
  assert.equal(listPosts({ regionId: "seoul", hashtagName: "광안리주차살려줘", limit: 100 }).length, 0);
  assert.equal(listQuestions({ regionId: "busan", limit: 100 }).every((question: { placeId: string }) => busanPlaceIds.has(question.placeId)), true);
});

test("local sample reports stay labeled and retain licensed photo attribution", () => {
  const sampleReport = listReports({ regionId: "busan", includeExpired: true, limit: 100 }).find(
    (report: { placeId: string }) => report.placeId === "busan-gwangalli",
  );

  assert.equal(sampleReport?.isSample, true);
  assert.match(sampleReport?.photoUrl ?? "", /^https:\/\/upload\.wikimedia\.org\//);
  assert.match(sampleReport?.photoAttribution ?? "", /CC BY-SA/);
  assert.match(sampleReport?.photoSourceUrl ?? "", /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
});

test("shared post lookup reads from Worker API when configured", async () => {
  const requests: Request[] = [];
  const workerPost = {
    ...listPosts({ includeHidden: true, limit: 1 })[0],
    id: "worker_share_post",
    shareCard: {
      headline: "Worker 공유 카드",
      body: "Worker API에서 내려온 공유 본문",
      url: "https://silsigan.pages.dev/place/worker",
      hashtags: ["worker", "share"],
      variant: "good",
    },
  };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      success: true,
      data: [workerPost],
    });
  };

  const post = await findSharedPost("worker_share_post", {
    env: { SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test/" },
    fetcher,
  });

  assert.equal(post?.shareCard.headline, "Worker 공유 카드");
  assert.equal(post?.createdAt, workerPost.createdAt);
  assert.match(formatSharedPostObservedAt(post?.createdAt ?? ""), /\d+\.\s*\d+/);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/posts?limit=200");
  assert.equal(requests[0]?.headers.get("accept"), "application/json");
});

test("shared post lookup does not fall back to demo posts when Worker API is configured", async () => {
  const demoPost = listPosts({ includeHidden: true, limit: 1 })[0];
  const fetcher = async (): Promise<Response> =>
    Response.json({
      success: true,
      data: [],
    });

  const post = await findSharedPost(demoPost.id, {
    env: { SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test" },
    fetcher,
  });

  assert.equal(post, null);
});

test("shared post lookup rejects Worker share data without a valid observation time", async () => {
  const workerPost = {
    ...listPosts({ includeHidden: true, limit: 1 })[0],
    id: "worker_share_post_without_time",
    createdAt: "not-a-timestamp",
  };

  const post = await findSharedPost(workerPost.id, {
    env: { SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test" },
    fetcher: async (): Promise<Response> =>
      Response.json({
        success: true,
        data: [workerPost],
      }),
  });

  assert.equal(post, null);
});

test("shared post lookup keeps demo fallback only when Worker API is not configured", async () => {
  const demoPost = listPosts({ includeHidden: true, limit: 1 })[0];
  const fetcher = async (): Promise<Response> => {
    throw new Error("fetcher should not run without Worker API URL");
  };

  const post = await findSharedPost(demoPost.id, {
    env: {},
    fetcher,
  });

  assert.equal(post?.id, demoPost.id);
  assert.equal(post?.shareCard.headline, demoPost.shareCard.headline);
});

test("shared post lookup fails closed instead of falling back to demo data in production", async () => {
  const demoPost = listPosts({ includeHidden: true, limit: 1 })[0];
  const post = await findSharedPost(demoPost.id, {
    env: { NODE_ENV: "production" },
    fetcher: async (): Promise<Response> => {
      throw new Error("fetcher should not run without Worker API URL");
    },
  });

  assert.equal(post, null);
});

test("shared post lookup does not expose hidden demo posts", async () => {
  const created = createPost({
    placeId: "busan-gwangalli",
    crowdLevel: "packed",
    lineStatus: "medium",
    parkingStatus: "full",
    weatherFeel: "good",
    caption: "공개 공유에서 숨겨져야 하는 테스트 게시물입니다.",
    photoCount: 1,
    hashtagNames: ["#공유숨김"],
  });
  flagPost({ postId: created.post.id, reason: "privacy_plate" });

  const post = await findSharedPost(created.post.id, {
    env: {},
    fetcher: async (): Promise<Response> => {
      throw new Error("fetcher should not run without Worker API URL");
    },
  });

  assert.equal(post, null);
});

test("worker place adapter maps Cloudflare place records into the frontend place contract", () => {
  const place = workerPlaceToAppPlace({
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    categoryId: "tourism",
    areaId: "busan-suyeong",
    regionId: "busan",
    latitude: 35.1532,
    longitude: 129.1186,
    score: 98.4,
    status: "active",
    coordinateStatus: "verified",
  });

  assert.deepEqual(place, {
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    address: "부산 수영구 · 광안리해수욕장",
    category: "tourism",
    latitude: 35.1532,
    longitude: 129.1186,
    region: "busan",
    regionId: "busan",
    launchStage: "active",
    rankingScore: 98,
  });
});

test("worker place adapter accepts every nationwide first-level region", () => {
  const place = workerPlaceToAppPlace({
    id: "incheon-seed",
    name: "인천 준비 장소",
    categoryId: "tourism",
    areaId: "incheon",
    regionId: "incheon",
    latitude: 37.4563,
    longitude: 126.7052,
    score: 0,
    status: "seed",
    coordinateStatus: "verified",
  });

  assert.equal(place.regionId, "incheon");
  assert.equal(place.address, "인천 · 인천 준비 장소");
});

test("api routes can use the store abstraction in demo mode", () => {
  const store = getStore("demo");

  assert.equal(typeof store.createPost, "function");
  assert.equal(typeof store.listPosts, "function");
  assert.equal(typeof store.listHashtags, "function");
  assert.equal(typeof store.flagPost, "function");
  assert.equal(typeof store.listPostModerationQueue, "function");
  assert.equal(typeof store.listRegionActivationDashboard, "function");
  assert.equal(typeof store.moderatePost, "function");
});

test("store exposes region and area activation dashboard rows", () => {
  const rows = listRegionActivationDashboard();

  assert.equal(rows.length >= 3, true);
  assert.equal(rows.some((row: { status: { canActivate: boolean } }) => row.status.canActivate), true);
  assert.equal(rows.every((row: { areaId: string; status: { checks: unknown[] } }) => row.areaId && row.status.checks.length === 5), true);
  assert.ok(rows.find((row: { areaId: string }) => row.areaId === "ulsan-nam"));
});

test("store abstraction rejects removed supabase driver", () => {
  assert.throws(() => getStore("supabase"), /Supabase 저장소 드라이버는 Cloudflare 전환으로 제거되었습니다/);
});

test("store abstraction documents cloudflare worker boundary", () => {
  assert.throws(() => getStore("cloudflare"), /Workers API 배포를 통해 사용합니다/);
});

test("rate limit blocks excess requests within a window", () => {
  clearRateLimitBucketsForTests();
  assert.doesNotThrow(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }));
  assert.doesNotThrow(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }));
  assert.throws(() => assertRateLimit({ key: "test:rate", limit: 2, windowMs: 60_000 }), /요청이 너무 많습니다/);
});

test("rate limit fingerprints IP addresses and ignores user-agent rotation", async () => {
  const first = await rateLimitKey(
    new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.7", "user-agent": "bot-a" } }),
    "metered-api",
  );
  const rotatedAgent = await rateLimitKey(
    new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.7", "user-agent": "bot-b" } }),
    "metered-api",
  );
  const otherIp = await rateLimitKey(
    new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.8", "user-agent": "bot-a" } }),
    "metered-api",
  );

  assert.equal(first, rotatedAgent);
  assert.notEqual(first, otherIp);
  assert.equal(first.includes("203.0.113.7"), false);
  assert.match(first, /^metered-api:ip:[a-f0-9]{32}$/);
});

test("admin token is deny-by-default when configured", () => {
  const previous = process.env["SILSIGAN_ADMIN_TOKEN"];
  process.env["SILSIGAN_ADMIN_TOKEN"] = "fixture-admin-token";

  try {
    assert.equal(isAdminTokenValid("wrong-token"), false);
    assert.equal(isAdminTokenValid("fixture-admin-token"), true);
  } finally {
    if (previous === undefined) {
      delete process.env.SILSIGAN_ADMIN_TOKEN;
    } else {
      process.env["SILSIGAN_ADMIN_TOKEN"] = previous;
    }
  }
});

test("admin post moderation input is fail-closed", () => {
  assert.deepEqual(moderatePostSchema.parse({ postId: "post_1", action: "hide" }), { postId: "post_1", action: "hide" });
  assert.throws(() => moderatePostSchema.parse({ postId: "", action: "hide" }));
  assert.throws(() => moderatePostSchema.parse({ postId: "post_1", action: "publish" }));
  assert.throws(() => moderatePostSchema.parse({ postId: "post_1" }));
});

test("worker admin moderation helper proxies reports without leaking raw reporter fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: [
        {
          id: "report_worker_1",
          targetType: "photo",
          targetId: "photo_1",
          reason: "privacy_face",
          anonymousUserId: "anon_raw_reporter",
          note: "reporter@example.com real-camera-name.jpg",
          status: "open",
          createdAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });
  };

  const reports = await listWorkerModerationReports(
    { status: "open", limit: 99 },
    {
      fetcher,
      env: {
        SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
        SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
      },
    },
  );

  assert.deepEqual(reports, [
    {
      id: "report_worker_1",
      targetType: "photo",
      targetId: "photo_1",
      reason: "privacy_face",
      status: "open",
      createdAt: "2026-06-19T00:00:00.000Z",
    },
  ]);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/moderation/reports?status=open&limit=50");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
  assert.equal(JSON.stringify(reports).includes("anon_raw_reporter"), false);
  assert.equal(JSON.stringify(reports).includes("reporter@example.com"), false);
});

test("worker source health helper clamps limits and returns only safe health fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: [
        {
          id: "source_health_1",
          sourceId: "source_internal_1",
          sourceKey: "kma-weather",
          status: "healthy",
          message: "공식 출처 확인 완료",
          responseTimeMs: 182,
          checkedAt: "2026-06-19T00:00:00.000Z",
          anonymousUserId: "anon_should_not_escape",
          token: "worker-secret-should-not-escape",
        },
      ],
    });
  };

  const health = await listWorkerSourceHealth(
    { limit: 99 },
    {
      fetcher,
      env: {
        SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
        SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
      },
    },
  );

  assert.deepEqual(health, [
    {
      id: "source_health_1",
      sourceId: "source_internal_1",
      sourceKey: "kma-weather",
      status: "healthy",
      message: "공식 출처 확인 완료",
      responseTimeMs: 182,
      checkedAt: "2026-06-19T00:00:00.000Z",
    },
  ]);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/sources/health?limit=50");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
  assert.equal(JSON.stringify(health).includes("anon_should_not_escape"), false);
  assert.equal(JSON.stringify(health).includes("worker-secret-should-not-escape"), false);
});

test("worker source health helper rejects invalid status, response time, and array shape", async () => {
  const invalidItemFetcher = async (): Promise<Response> =>
    Response.json({
      success: true,
      data: [
        {
          id: "source_health_invalid",
          sourceId: "source_internal_invalid",
          sourceKey: "kma-weather",
          status: "unknown",
          message: null,
          responseTimeMs: -1,
          checkedAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });

  await assert.rejects(
    () =>
      listWorkerSourceHealth(
        {},
        {
          fetcher: invalidItemFetcher,
          env: {
            SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
            SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
          },
        },
      ),
    /Worker 응답 status 필드가 올바르지 않습니다\./,
  );

  const invalidArrayFetcher = async (): Promise<Response> =>
    Response.json({ success: true, data: { unexpected: true } });

  await assert.rejects(
    () =>
      listWorkerSourceHealth(
        {},
        {
          fetcher: invalidArrayFetcher,
          env: {
            SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
            SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
          },
        },
      ),
    /Worker 데이터 출처 상태 응답 형식이 올바르지 않습니다\./,
  );
});

test("worker source registry helper returns only safe rights and activation fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: [
        {
          id: "source_internal_1",
          sourceKey: "kma_weather",
          sourceName: "기상청 단기예보",
          providerName: "기상청",
          sourceType: "official_periodic",
          commercialUseStatus: "allowed_with_attribution",
          agreementRequired: false,
          enabled: true,
          enabledRegions: ["*"],
          healthStatus: "healthy",
          activationStatus: "active",
          documentationUrl: "https://example.test/docs",
          termsUrl: "https://example.test/terms",
          lastTermsCheckedAt: "2026-06-18T00:00:00.000Z",
          lastHealthCheckedAt: "2026-06-19T00:00:00.000Z",
          token: "worker-secret-should-not-escape",
        },
      ],
    });
  };

  const sources = await listWorkerDataSources({
    fetcher,
    env: {
      SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
      SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
    },
  });

  assert.deepEqual(sources, [
    {
      sourceKey: "kma_weather",
      sourceName: "기상청 단기예보",
      providerName: "기상청",
      sourceType: "official_periodic",
      commercialUseStatus: "allowed_with_attribution",
      enabled: true,
      healthStatus: "healthy",
      activationStatus: "active",
      lastTermsCheckedAt: "2026-06-18T00:00:00.000Z",
      lastHealthCheckedAt: "2026-06-19T00:00:00.000Z",
    },
  ]);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/sources");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
  assert.equal(JSON.stringify(sources).includes("worker-secret-should-not-escape"), false);
  assert.equal(JSON.stringify(sources).includes("documentationUrl"), false);
});

test("worker source registry helper rejects invalid activation and response shape", async () => {
  const invalidItemFetcher = async (): Promise<Response> =>
    Response.json({
      success: true,
      data: [
        {
          sourceKey: "kma_weather",
          sourceName: "기상청 단기예보",
          providerName: "기상청",
          sourceType: "official_periodic",
          commercialUseStatus: "unknown",
          enabled: true,
          healthStatus: "healthy",
          activationStatus: "approved",
          lastTermsCheckedAt: null,
          lastHealthCheckedAt: null,
        },
      ],
    });

  await assert.rejects(
    () =>
      listWorkerDataSources({
        fetcher: invalidItemFetcher,
        env: {
          SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
          SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
        },
      }),
    /Worker 응답 activationStatus 필드가 올바르지 않습니다\./,
  );

  const invalidArrayFetcher = async (): Promise<Response> => Response.json({ success: true, data: { unexpected: true } });
  await assert.rejects(
    () =>
      listWorkerDataSources({
        fetcher: invalidArrayFetcher,
        env: {
          SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
          SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
        },
      }),
    /Worker 데이터 출처 목록 응답 형식이 올바르지 않습니다\./,
  );
});

test("worker admin moderation helper prefers dedicated Worker token over staging smoke token", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: [],
    });
  };

  assert.equal(
    workerAdminApiConfigured({
      SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
      SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
      SILSIGAN_STAGING_ADMIN_TOKEN: "staging-admin-token",
    }),
    true,
  );

  await listWorkerModerationReports(
    { status: "open" },
    {
      fetcher,
      env: {
        SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
        SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
        SILSIGAN_STAGING_ADMIN_TOKEN: "staging-admin-token",
      },
    },
  );

  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
});

test("worker admin moderation helper posts report actions through server token", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: {
        id: "report_worker_2",
        targetType: "place",
        targetId: "busan-gwangalli",
        reason: "other",
        status: "rejected",
        createdAt: "2026-06-19T00:00:00.000Z",
      },
    });
  };

  const report = await moderateWorkerReport(
    { reportId: "report_worker_2", status: "rejected", reason: "테스트 정리" },
    {
      fetcher,
      env: {
        SILSIGAN_STAGING_API_BASE_URL: "https://staging-worker.example.test",
        SILSIGAN_STAGING_ADMIN_TOKEN: "staging-admin-token",
      },
    },
  );

  assert.equal(report.status, "rejected");
  assert.equal(requests[0]?.url, "https://staging-worker.example.test/api/moderation/reports/report_worker_2/action");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "staging-admin-token");
  assert.deepEqual(await requests[0]?.json(), {
    status: "rejected",
    reason: "테스트 정리",
  });
});

test("worker field-report admin queue keeps the response coarse and proxies moderator decisions", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];

  clearRateLimitBucketsForTests();
  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-moderator-token";
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (request.method === "POST") {
      return Response.json({
        success: true,
        data: {
          reportId: "field_report_route-123456",
          decision: "approved",
          public: true,
          previousStatus: "pending",
          anonymousUserId: "anon_should_not_escape",
        },
      });
    }

    return Response.json({
      success: true,
      data: [{
        id: "field_report_route-123456",
        placeId: "busan-gwangalli",
        placeName: "광안리해수욕장",
        category: "tourism",
        crowdLevel: "busy",
        lineStatus: null,
        parkingStatus: "limited",
        verifiedRadiusM: 50,
        observedDimensions: ["crowd", "parking"],
        createdAt: "2026-06-19T00:00:00.000Z",
        expiresAt: "2026-06-19T03:00:00.000Z",
        moderationStatus: "pending",
        isExpired: false,
        anonymousUserId: "anon_should_not_escape",
        rawLatitude: 35.1532,
      }],
    });
  };

  try {
    const authHeaders = { "x-silsigan-admin-token": "next-admin-token" };
    const list = await handleAdminWorkerFieldReportsGet(
      new Request("http://localhost/api/admin/field-reports?status=pending&limit=99", { headers: authHeaders }),
    );
    const decision = await handleAdminWorkerFieldReportsPost(
      new Request("http://localhost/api/admin/field-reports", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ reportId: "field_report_route-123456", decision: "approved", reason: "운영자 승인" }),
      }),
    );

    assert.equal(list[0]?.placeName, "광안리해수욕장");
    assert.equal(JSON.stringify(list).includes("anon_should_not_escape"), false);
    assert.equal(JSON.stringify(list).includes("35.1532"), false);
    assert.equal(decision.public, true);
    assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/field-reports?status=pending&limit=50");
    assert.equal(requests[1]?.url, "https://worker.example.test/api/admin/field-reports/field_report_route-123456/moderation");
    assert.equal(requests[1]?.headers.get("x-silsigan-admin-token"), "worker-moderator-token");
    assert.deepEqual(await requests[1]?.json(), { decision: "approved", reason: "운영자 승인" });
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
  }
});

test("worker admin moderation helper is deny-by-default without server token", () => {
  assert.equal(workerAdminApiConfigured({ SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test" }), false);
});

test("admin worker reports route requires Next admin auth before proxying", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalls += 1;
    return Response.json({ success: true, data: [] });
  };

  try {
    await assert.rejects(
      () => handleAdminWorkerReportsGet(new Request("http://localhost/api/admin/moderation/reports?status=open")),
      /관리자 인증이 필요합니다/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
  }
});

test("admin source health route requires Next admin auth before proxying", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalls += 1;
    return Response.json({ success: true, data: [] });
  };

  try {
    await assert.rejects(
      () => handleAdminWorkerSourceHealthGet(new Request("http://localhost/api/admin/sources/health?limit=50")),
      /관리자 인증이 필요합니다/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
  }
});

test("admin source health route proxies with the server token and clamps the limit", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];

  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      success: true,
      data: [
        {
          id: "source_health_route",
          sourceId: "source_internal_route",
          sourceKey: "tour-api",
          status: "degraded",
          message: "공식 출처 응답 지연",
          responseTimeMs: 1_250,
          checkedAt: "2026-06-19T00:00:00.000Z",
          rawToken: "should-not-escape",
        },
      ],
    });
  };

  try {
    const health = await handleAdminWorkerSourceHealthGet(
      new Request("http://localhost/api/admin/sources/health?limit=99", {
        headers: { "x-silsigan-admin-token": "next-admin-token" },
      }),
    );

    assert.deepEqual(health, [
      {
        id: "source_health_route",
        sourceId: "source_internal_route",
        sourceKey: "tour-api",
        status: "degraded",
        message: "공식 출처 응답 지연",
        responseTimeMs: 1_250,
        checkedAt: "2026-06-19T00:00:00.000Z",
      },
    ]);
    assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/sources/health?limit=50");
    assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
    assert.equal(JSON.stringify(health).includes("should-not-escape"), false);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
  }
});

test("admin worker reports route proxies with server token and returns minimal report payload", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];

  clearRateLimitBucketsForTests();
  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);

    if (request.method === "POST") {
      return Response.json({
        success: true,
        data: {
          id: "report_worker_route",
          targetType: "photo",
          targetId: "photo_1",
          reason: "privacy_face",
          anonymousUserId: "anon_route_reporter",
          note: "route@example.com real-camera-name.jpg",
          status: "accepted",
          createdAt: "2026-06-19T00:00:00.000Z",
        },
      });
    }

    return Response.json({
      success: true,
      data: [
        {
          id: "report_worker_route",
          targetType: "photo",
          targetId: "photo_1",
          reason: "privacy_face",
          anonymousUserId: "anon_route_reporter",
          note: "route@example.com real-camera-name.jpg",
          status: "open",
          createdAt: "2026-06-19T00:00:00.000Z",
        },
      ],
    });
  };

  try {
    const authHeaders = { "x-silsigan-admin-token": "next-admin-token" };
    const listPayload = await handleAdminWorkerReportsGet(
      new Request("http://localhost/api/admin/moderation/reports?status=open&limit=99", {
        headers: authHeaders,
      }),
    );
    const actionPayload = await handleAdminWorkerReportsPost(
      new Request("http://localhost/api/admin/moderation/reports", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reportId: "report_worker_route",
          status: "accepted",
          reason: "운영자 승인",
        }),
      }),
    );

    assert.equal(JSON.stringify(listPayload).includes("anon_route_reporter"), false);
    assert.equal(JSON.stringify(listPayload).includes("route@example.com"), false);
    assert.equal(JSON.stringify(actionPayload).includes("real-camera-name.jpg"), false);
    assert.equal(requests[0]?.url, "https://worker.example.test/api/moderation/reports?status=open&limit=50");
    assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
    assert.equal(requests[1]?.url, "https://worker.example.test/api/moderation/reports/report_worker_route/action");
    assert.equal(requests[1]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
    assert.deepEqual(await requests[1]?.json(), {
      status: "accepted",
      reason: "운영자 승인",
    });
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
  }
});

test("admin worker operations require Next admin auth before proxying", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  clearRateLimitBucketsForTests();
  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (): Promise<Response> => {
    fetchCalls += 1;
    return Response.json({ success: true, data: {} });
  };

  try {
    await assert.rejects(
      () =>
        handleAdminWorkerCoordinateStatusPost(
          new Request("http://localhost/api/admin/places/coordinate-status", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              placeId: "jeju-coordinate-review",
              coordinateStatus: "verified",
              latitude: 33.4996,
              longitude: 126.5312,
              source: "coordinate QA",
              reason: "좌표 검증",
            }),
          }),
        ),
      /관리자 인증이 필요합니다/,
    );
    await assert.rejects(
      () =>
        handleAdminWorkerUserRestrictPost(
          new Request("http://localhost/api/admin/users/restrict", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              anonymousUserId: "anon_1234567890abcdef1234567890abcdef1234567890abcdef",
              reason: "반복 스팸",
            }),
          }),
        ),
      /관리자 인증이 필요합니다/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
  }
});

test("admin worker operations proxy coordinate and user restriction actions with server token", async () => {
  const previousAdminToken = process.env["SILSIGAN_ADMIN_TOKEN"];
  const previousWorkerBaseUrl = process.env["SILSIGAN_WORKER_API_BASE_URL"];
  const previousWorkerToken = process.env["SILSIGAN_WORKER_ADMIN_TOKEN"];
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  const anonymousUserId = "anon_1234567890abcdef1234567890abcdef1234567890abcdef";

  clearRateLimitBucketsForTests();
  process.env["SILSIGAN_ADMIN_TOKEN"] = "next-admin-token";
  process.env["SILSIGAN_WORKER_API_BASE_URL"] = "https://worker.example.test";
  process.env["SILSIGAN_WORKER_ADMIN_TOKEN"] = "worker-admin-token";
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/places/coordinate-status") {
      return Response.json({
        success: true,
        data: {
          placeId: "jeju-coordinate-review",
          coordinateStatus: "verified",
          latitude: 33.4996,
          longitude: 126.5312,
          source: "raw-source-should-not-return",
          reason: "raw-reason-should-not-return",
        },
      });
    }

    if (url.pathname === "/api/admin/users/restrict") {
      return Response.json({
        success: true,
        data: {
          anonymousUserId,
          restricted: true,
          blockedUntil: "2099-01-01T00:00:00.000Z",
          reason: "raw-restriction-reason",
        },
      });
    }

    return Response.json({
      success: true,
      data: {
        anonymousUserId,
        restricted: false,
        blockedUntil: null,
        reason: "raw-unrestriction-reason",
      },
    });
  };

  try {
    const authHeaders = { "x-silsigan-admin-token": "next-admin-token", "content-type": "application/json" };
    const coordinatePayload = await handleAdminWorkerCoordinateStatusPost(
      new Request("http://localhost/api/admin/places/coordinate-status", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          placeId: "jeju-coordinate-review",
          coordinateStatus: "verified",
          latitude: 33.4996,
          longitude: 126.5312,
          source: "coordinate QA",
          reason: "좌표 검증 완료",
        }),
      }),
    );
    const restrictionPayload = await handleAdminWorkerUserRestrictPost(
      new Request("http://localhost/api/admin/users/restrict", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          anonymousUserId,
          reason: "반복 스팸",
          blockedUntil: "2099-01-01T00:00:00.000Z",
        }),
      }),
    );
    const unrestrictionPayload = await handleAdminWorkerUserUnrestrictPost(
      new Request("http://localhost/api/admin/users/unrestrict", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          anonymousUserId,
          reason: "테스트 제한 해제",
        }),
      }),
    );

    assert.equal(JSON.stringify(coordinatePayload).includes("raw-source-should-not-return"), false);
    assert.equal(JSON.stringify(coordinatePayload).includes("raw-reason-should-not-return"), false);
    assert.equal(JSON.stringify(restrictionPayload).includes("raw-restriction-reason"), false);
    assert.equal(JSON.stringify(unrestrictionPayload).includes("raw-unrestriction-reason"), false);
    assert.deepEqual(coordinatePayload, {
      placeId: "jeju-coordinate-review",
      coordinateStatus: "verified",
      latitude: 33.4996,
      longitude: 126.5312,
    });
    assert.deepEqual(restrictionPayload, {
      anonymousUserId,
      restricted: true,
      blockedUntil: "2099-01-01T00:00:00.000Z",
    });
    assert.deepEqual(unrestrictionPayload, {
      anonymousUserId,
      restricted: false,
      blockedUntil: null,
    });
    assert.deepEqual(
      requests.map((request) => [request.method, request.url, request.headers.get("x-silsigan-admin-token")]),
      [
        ["POST", "https://worker.example.test/api/admin/places/coordinate-status", "worker-admin-token"],
        ["POST", "https://worker.example.test/api/admin/users/restrict", "worker-admin-token"],
        ["POST", "https://worker.example.test/api/admin/users/unrestrict", "worker-admin-token"],
      ],
    );
    assert.deepEqual(await requests[0]?.json(), {
      placeId: "jeju-coordinate-review",
      coordinateStatus: "verified",
      latitude: 33.4996,
      longitude: 126.5312,
      source: "coordinate QA",
      reason: "좌표 검증 완료",
    });
    assert.deepEqual(await requests[1]?.json(), {
      anonymousUserId,
      reason: "반복 스팸",
      blockedUntil: "2099-01-01T00:00:00.000Z",
    });
    assert.deepEqual(await requests[2]?.json(), {
      anonymousUserId,
      reason: "테스트 제한 해제",
    });
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
  }
});

test("analytics console events redact sensitive values", () => {
  assert.deepEqual(
    redactAnalyticsProperties({
      placeId: "busan-gwangalli",
      locationVerified: true,
      latitude: 35.1532,
      longitude: 129.1186,
      anonymousId: "anon_sensitive_test",
      adminToken: "fixture-token-leakySecretForTestOnly",
      originalFilename: "real-camera-name.jpg",
      adminSubject: "operator@example.test",
    }),
    {
      placeId: "busan-gwangalli",
      locationVerified: true,
      latitude: "[redacted]",
      longitude: "[redacted]",
      anonymousId: "[redacted]",
      adminToken: "[redacted]",
      originalFilename: "[redacted]",
      adminSubject: "[redacted]",
    },
  );

  const previousInfo = console.info;
  const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    trackEvent("submit_post", {
      placeId: "busan-gwangalli",
      latitude: 35.1532,
      anonymousId: "anon_sensitive_test",
      originalFilename: "real-camera-name.jpg",
    });
  } finally {
    console.info = previousInfo;
  }

  assert.deepEqual(calls[0], [
    "[silsigan:event]",
    "submit_post",
    {
      placeId: "busan-gwangalli",
      latitude: "[redacted]",
      anonymousId: "[redacted]",
      originalFilename: "[redacted]",
    },
  ]);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

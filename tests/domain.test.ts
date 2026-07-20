import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateCreditBalance,
  calculateTrustScore,
  canActivateRegion,
  creditEventForQuestion,
  creditEventsForReport,
  evaluateRegionActivation,
  getCategorySafetyWarning,
  getQuestionCost,
  getReportExpiry,
  isReportExpired,
  recommendHashtags,
  shouldHideForFlags,
  verifiedRadiusFromDistance,
} = await import(new URL("../src/lib/domain.ts", import.meta.url).href);
const { isLocationAccuracySufficient, locationAccuracyBucketForMeters } = await import(
  new URL("../packages/contracts/src/index.ts", import.meta.url).href,
);

const { createPost, createQuestion, createReport, flagPost, listPlaces, listPostModerationQueue, listPosts, listQuestions, listReports, listRegionActivationDashboard, moderatePost } = await import(new URL("../src/lib/mock-store.ts", import.meta.url).href);
const { assertAdminMutationOrigin, isAdminTokenValid } = await import(new URL("../src/lib/admin-auth.ts", import.meta.url).href);
const {
  assertRateLimit,
  clearRateLimitBucketsForTests,
  rateLimitDiagnosticsForTests,
  rateLimitKey,
} = await import(new URL("../src/lib/rate-limit.ts", import.meta.url).href);
const { getStore } = await import(new URL("../src/lib/store.ts", import.meta.url).href);
const { redactAnalyticsProperties, trackEvent } = await import(new URL("../src/lib/analytics.ts", import.meta.url).href);
const { buildScopedApiPath, clampApiLimit, normalizeRegionScope } = await import(new URL("../src/lib/api-scope.ts", import.meta.url).href);
const { workerPlaceToAppPlace } = await import(new URL("../src/lib/cloudflare-place-adapter.ts", import.meta.url).href);
const { findSharedPost } = await import(new URL("../src/lib/shared-post.ts", import.meta.url).href);
const { createQuestionSchema, createReportSchema, moderatePostSchema } = await import(new URL("../src/lib/validators.ts", import.meta.url).href);
const { formatDistanceMeters, haversineDistanceMeters } = await import(new URL("../src/lib/geo.ts", import.meta.url).href);
const { parseVerificationGeometry, pointInVerificationGeometry, verifyFieldLocation } = await import(
  new URL("../workers/api/src/location-verification.ts", import.meta.url).href,
);
const {
  getWorkerBetaKpis,
  getWorkerApiCostGuard,
  getWorkerPhotoCostGuard,
  listWorkerFieldReports,
  listWorkerModerationReports,
  moderateWorkerFieldReport,
  moderateWorkerReport,
  reconcileWorkerApiCostGuard,
  updateWorkerApiCostGuard,
  updateWorkerPhotoCostGuard,
  workerAdminApiConfigured,
} = await import(new URL("../src/lib/worker-admin-api.ts", import.meta.url).href);
const {
  handleAdminBetaKpisGet,
  handleAdminFieldReportsGet,
  handleAdminFieldReportsPost,
  handleAdminPhotoCostGuardGet,
  handleAdminPhotoCostGuardPatch,
  handleAdminWorkerCoordinateStatusPost,
  handleAdminWorkerReportsGet,
  handleAdminWorkerReportsPost,
  handleAdminWorkerUserRestrictPost,
  handleAdminWorkerUserUnrestrictPost,
} = await import(new URL("../src/lib/worker-admin-route.ts", import.meta.url).href);

test("location distance uses Haversine meters and privacy-safe display units", () => {
  const origin = { latitude: 35.1796, longitude: 129.0756 };
  const samePoint = haversineDistanceMeters(origin, origin);
  const oneKilometerNorth = haversineDistanceMeters(origin, {
    latitude: origin.latitude + 0.009,
    longitude: origin.longitude,
  });

  assert.equal(samePoint, 0);
  assert.ok(oneKilometerNorth > 950 && oneKilometerNorth < 1_050);
  assert.equal(formatDistanceMeters(250), "250m");
  assert.equal(formatDistanceMeters(1_200), "1.2km");
  assert.equal(formatDistanceMeters(12_000), "12km");
});

test("polygon verification accepts boundaries, rejects holes, and supports multipolygons", () => {
  const geometry = parseVerificationGeometry({
    type: "Polygon",
    coordinates: [
      [
        [129.0, 35.0],
        [129.01, 35.0],
        [129.01, 35.01],
        [129.0, 35.01],
        [129.0, 35.0],
      ],
      [
        [129.003, 35.003],
        [129.007, 35.003],
        [129.007, 35.007],
        [129.003, 35.007],
        [129.003, 35.003],
      ],
    ],
  });
  assert.ok(geometry);
  assert.equal(pointInVerificationGeometry({ latitude: 35.001, longitude: 129.001 }, geometry), true);
  assert.equal(pointInVerificationGeometry({ latitude: 35.0, longitude: 129.005 }, geometry), true);
  assert.equal(pointInVerificationGeometry({ latitude: 35.005, longitude: 129.005 }, geometry), false);
  assert.equal(pointInVerificationGeometry({ latitude: 35.02, longitude: 129.005 }, geometry), false);

  const multipolygon = parseVerificationGeometry({
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [129.1, 35.1],
          [129.11, 35.1],
          [129.11, 35.11],
          [129.1, 35.11],
          [129.1, 35.1],
        ],
      ],
    ],
  });
  assert.ok(multipolygon);
  assert.equal(pointInVerificationGeometry({ latitude: 35.105, longitude: 129.105 }, multipolygon), true);
});

test("field location verification is server-owned and fails closed for low accuracy or missing geometry", () => {
  const context = {
    placeKind: "AREA" as const,
    center: { latitude: 35.0, longitude: 129.0 },
    geometry: parseVerificationGeometry({
      type: "Polygon",
      coordinates: [
        [
          [128.99, 34.99],
          [129.01, 34.99],
          [129.01, 35.01],
          [128.99, 35.01],
          [128.99, 34.99],
        ],
      ],
    }),
    verificationRadiusM: null,
  };
  assert.equal(verifyFieldLocation({ latitude: 35, longitude: 129 }, 18, context).verificationMethod, "polygon");
  assert.equal(verifyFieldLocation({ latitude: 35, longitude: 129 }, 250, context).verificationMethod, "none");
  assert.equal(verifyFieldLocation({ latitude: 35.02, longitude: 129 }, 18, context).reason, "outside_polygon");
  assert.equal(
    verifyFieldLocation({ latitude: 35, longitude: 129 }, 18, { ...context, geometry: null }).reason,
    "geometry_not_configured",
  );
});

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

test("question creation never accepts a client-owned credit balance", () => {
  const parsed = createQuestionSchema.parse({
    placeId: "busan-gwangalli",
    questionType: "crowd",
    body: "지금 사람이 많은가요?",
    availableCredits: 999,
  });

  assert.equal(Object.hasOwn(parsed, "availableCredits"), false);
  assert.throws(
    () => createQuestion(parsed),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CREDIT_LEDGER_REQUIRED",
  );
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

test("location accuracy is reduced to coarse buckets and low accuracy cannot verify", () => {
  assert.equal(locationAccuracyBucketForMeters(18), "high");
  assert.equal(locationAccuracyBucketForMeters(75), "medium");
  assert.equal(locationAccuracyBucketForMeters(250), "low");
  assert.equal(locationAccuracyBucketForMeters(undefined), "unknown");
  assert.equal(isLocationAccuracySufficient(100), true);
  assert.equal(isLocationAccuracySufficient(100.01), false);
  assert.equal(isLocationAccuracySufficient(undefined), false);
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
      accuracyM: 18,
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

test("low accuracy report remains available but never receives a verification credit", () => {
  const result = createReport({
    placeId: "busan-gwangalli",
    category: "tourism",
    crowdLevel: "busy",
    clientLocation: {
      latitude: 35.1532,
      longitude: 129.1186,
      accuracyM: 250,
    },
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
      accuracyM: 18,
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
      accuracyM: 18,
    },
  });

  assert.equal(created.post.hashtagNames.length, 5);
  assert.equal(created.post.verifiedRadiusM, 50);
  assert.equal(created.post.locationVerified, true);
  assert.equal(created.post.shareCard.headline, "광안리해수욕장 현장 제보");
  assert.match(created.post.shareCard.body, /제보 내용: 사람 매우 많음/);
  assert.equal(created.post.shareCard.variant, "neutral");
  assert.equal(created.post.shareCard.url, "https://silsigan.pages.dev/place/busan-gwangalli");

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
      accuracyM: 18,
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
  const busanHashtagPosts = listPosts({ regionId: "busan", hashtagName: "광안리주차살려줘", limit: 100 });

  assert.equal(busanPlaces.length, 1);
  assert.equal(busanPlaces.every((place: { regionId: string }) => place.regionId === "busan"), true);
  assert.equal(listPlaces({ regionId: "seoul", limit: 100 }).length, 0);
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
      variant: "neutral",
    },
    status: {
      dataMode: "live",
      status: "insufficient",
      currentSignals: [],
      independentSourceCount: 0,
      confidenceScore: 0,
      reasonCodes: ["no_current_evidence"],
      observedAt: null,
      computedAt: "2026-07-10T00:00:00.000Z",
    },
  };
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      success: true,
      data: workerPost,
    });
  };

  const post = await findSharedPost("worker_share_post", {
    env: { SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test/" },
    fetcher,
  });

  assert.equal(post?.shareCard.headline, "Worker 공유 카드");
  assert.equal(requests[0]?.url, "https://worker.example.test/api/share/posts/worker_share_post");
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

test("rate limit identity cannot be rotated with user-agent or forwarded-header spoofing", () => {
  const first = new Request("https://silsigan.example/api/external/naver/local-search", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "user-agent": "attacker-agent-a",
      "x-forwarded-for": "198.51.100.1",
      "x-real-ip": "198.51.100.2",
    },
  });
  const second = new Request("https://silsigan.example/api/external/naver/local-search", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "user-agent": "attacker-agent-b",
      "x-forwarded-for": "192.0.2.9",
      "x-real-ip": "192.0.2.10",
    },
  });

  assert.equal(rateLimitKey(first, "naver-local-search"), rateLimitKey(second, "naver-local-search"));
  assert.match(rateLimitKey(first, "naver-local-search"), /^naver-local-search:cf:/);
});

test("rate limit storage fails closed instead of growing without a bound", () => {
  clearRateLimitBucketsForTests();
  const { capacity } = rateLimitDiagnosticsForTests();

  try {
    for (let index = 0; index < capacity; index += 1) {
      assert.doesNotThrow(() => assertRateLimit({ key: `capacity:${index}`, limit: 1, windowMs: 60_000 }));
    }

    assert.equal(rateLimitDiagnosticsForTests().size, capacity);
    assert.throws(
      () => assertRateLimit({ key: "capacity:overflow", limit: 1, windowMs: 60_000 }),
      /요청 보호 한도에 도달했습니다/,
    );
    assert.equal(rateLimitDiagnosticsForTests().size, capacity);
  } finally {
    clearRateLimitBucketsForTests();
  }
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

test("worker admin field report helper keeps moderation payload privacy-safe", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: [
        {
          id: "field_report_12345678",
          placeId: "busan-gwangalli",
          placeName: "광안리해수욕장",
          category: "tourism",
          crowdLevel: "busy",
          lineStatus: null,
          parkingStatus: "limited",
          verifiedRadiusM: 150,
          verificationMethod: "radius",
          accuracyBucket: "high",
          moderationStatus: "pending",
          createdAt: "2026-07-14T00:00:00.000Z",
          expiresAt: "2026-07-14T00:30:00.000Z",
          anonymousUserId: "anon_raw_reporter",
          clientLocation: { latitude: 35.1532, longitude: 129.1186 },
          note: "private reporter note",
        },
      ],
    });
  };

  const reports = await listWorkerFieldReports(
    { status: "pending", limit: 99 },
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
      id: "field_report_12345678",
      placeId: "busan-gwangalli",
      placeName: "광안리해수욕장",
      category: "tourism",
      crowdLevel: "busy",
      lineStatus: null,
      parkingStatus: "limited",
      verifiedRadiusM: 150,
      verificationMethod: "radius",
      accuracyBucket: "high",
      moderationStatus: "pending",
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-14T00:30:00.000Z",
    },
  ]);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/field-reports?limit=50&status=pending");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
  assert.equal(JSON.stringify(reports).includes("anon_raw_reporter"), false);
  assert.equal(JSON.stringify(reports).includes("35.1532"), false);
  assert.equal(JSON.stringify(reports).includes("private reporter note"), false);
});

test("worker admin field report helper posts only an allowed moderation transition", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: {
        id: "field_report_12345678",
        placeId: "busan-gwangalli",
        placeName: "광안리해수욕장",
        category: "tourism",
        crowdLevel: "busy",
        lineStatus: null,
        parkingStatus: "limited",
        verifiedRadiusM: 150,
        verificationMethod: "radius",
        accuracyBucket: "high",
        moderationStatus: "approved",
        createdAt: "2026-07-14T00:00:00.000Z",
        expiresAt: "2026-07-14T00:30:00.000Z",
      },
    });
  };

  const report = await moderateWorkerFieldReport(
    { reportId: "field_report_12345678", status: "approved", reason: "운영자 승인" },
    {
      fetcher,
      env: {
        SILSIGAN_STAGING_API_BASE_URL: "https://staging-worker.example.test",
        SILSIGAN_STAGING_ADMIN_TOKEN: "staging-admin-token",
      },
    },
  );

  assert.equal(report.moderationStatus, "approved");
  assert.equal(requests[0]?.url, "https://staging-worker.example.test/api/admin/field-reports/field_report_12345678/action");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "staging-admin-token");
  assert.deepEqual(await requests[0]?.json(), { status: "approved", reason: "운영자 승인" });
});

test("worker admin moderation helper is deny-by-default without server token", () => {
  assert.equal(workerAdminApiConfigured({ SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test" }), false);
});

test("worker beta KPI helper exposes aggregate-only metrics and strips unexpected Worker fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({
      success: true,
      data: {
        windowDays: 7,
        generatedAt: "2026-07-19T10:00:00.000Z",
        privacy: "aggregate-only",
        audience: { activeUsers: 120, appOpens: 180, actorIdentityKeys: ["must-not-leak"] },
        reportFunnel: { started: 40, submitted: 30, conversionPercent: 75, medianCompletionSeconds: 11 },
        mapReliability: { succeeded: 99, failed: 1, successPercent: 99 },
        moderation: {
          submitted: 20,
          pending: 2,
          approved: 15,
          rejected: 2,
          hidden: 1,
          approvalPercent: 83.33,
          reviewedWithin24HoursPercent: 94.44,
        },
        retention: {
          d1: { cohortUsers: 50, retainedUsers: 20, percent: 40 },
          d7: { cohortUsers: 30, retainedUsers: 9, percent: 30 },
        },
        freshCoverage: {
          eligiblePlaces: 30,
          coveredPlaces: 18,
          percent: 60,
          tierA: { eligiblePlaces: 12, coveredPlaces: 9, percent: 75 },
          tierB: { eligiblePlaces: 18, coveredPlaces: 9, percent: 50 },
        },
        runtimeReliability: { appOpenUsers: 120, errorUsers: 1, errorFreePercent: 99.17 },
        debug: { rawActors: ["must-not-leak"] },
      },
    });
  };

  const metrics = await getWorkerBetaKpis(7, {
    fetcher,
    env: {
      SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
      SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
    },
  });

  assert.equal(metrics.reportFunnel.medianCompletionSeconds, 11);
  assert.equal(metrics.retention.d7.percent, 30);
  assert.equal(metrics.freshCoverage.coveredPlaces, 18);
  assert.deepEqual(metrics.freshCoverage.tierA, { eligiblePlaces: 12, coveredPlaces: 9, percent: 75 });
  assert.deepEqual(metrics.freshCoverage.tierB, { eligiblePlaces: 18, coveredPlaces: 9, percent: 50 });
  assert.equal(JSON.stringify(metrics).includes("must-not-leak"), false);
  assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/beta-kpis?days=7");
  assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
});

test("admin beta KPI route authenticates before proxying", async () => {
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
    return Response.json({
      success: true,
      data: {
        windowDays: 7,
        generatedAt: "2026-07-19T10:00:00.000Z",
        privacy: "aggregate-only",
        audience: { activeUsers: 0, appOpens: 0 },
        reportFunnel: { started: 0, submitted: 0, conversionPercent: null, medianCompletionSeconds: null },
        mapReliability: { succeeded: 0, failed: 0, successPercent: null },
        moderation: { submitted: 0, pending: 0, approved: 0, rejected: 0, hidden: 0, approvalPercent: null, reviewedWithin24HoursPercent: null },
        retention: { d1: { cohortUsers: 0, retainedUsers: 0, percent: null }, d7: { cohortUsers: 0, retainedUsers: 0, percent: null } },
        freshCoverage: {
          eligiblePlaces: 0,
          coveredPlaces: 0,
          percent: null,
          tierA: { eligiblePlaces: 0, coveredPlaces: 0, percent: null },
          tierB: { eligiblePlaces: 0, coveredPlaces: 0, percent: null },
        },
        runtimeReliability: { appOpenUsers: 0, errorUsers: 0, errorFreePercent: null },
      },
    });
  };

  try {
    await assert.rejects(
      () => handleAdminBetaKpisGet(new Request("http://localhost/api/admin/beta-kpis?days=7")),
      /관리자 인증이 필요합니다/,
    );
    assert.equal(fetchCalls, 0);

    const metrics = await handleAdminBetaKpisGet(
      new Request("http://localhost/api/admin/beta-kpis?days=7", {
        headers: { cookie: "silsigan_admin=next-admin-token" },
      }),
    );
    assert.equal(metrics.windowDays, 7);
    assert.equal(fetchCalls, 1);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
  }
});

test("worker photo cost guard helper returns a minimal summary and sends only the allowed control fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      success: true,
      data: {
        uploadsEnabled: request.method === "PATCH" ? false : true,
        readsEnabled: request.method === "PATCH" ? false : true,
        reason: request.method === "PATCH" ? "운영자 긴급 중단" : null,
        activeBytes: 1_073_741_824,
        storageMaxBytes: 4_294_967_296,
        storageStopBytes: 3_435_973_836,
        storagePercent: 25,
        storageStopPercent: 31.25,
        periodUtc: "2026-07",
        writesInPeriod: 4_000,
        monthlyWriteLimit: 16_000,
        monthlyWriteStopLimit: 12_800,
        writePercent: 25,
        writeStopPercent: 31.25,
        transformPeriodUtc: "2026-07",
        transformsInPeriod: 1_000,
        monthlyTransformLimit: 5_000,
        monthlyTransformStopLimit: 4_000,
        transformPercent: 20,
        transformStopPercent: 25,
        readPeriodUtc: "2026-07",
        readsInPeriod: 250_000,
        monthlyReadLimit: 1_000_000,
        monthlyReadStopLimit: 800_000,
        readPercent: 25,
        readStopPercent: 31.25,
        dayUtc: "2026-07-19",
        readsInDay: 1_000,
        dailyReadLimit: 20_000,
        dailyReadStopLimit: 16_000,
        dailyReadPercent: 5,
        dailyReadStopPercent: 6.25,
        updatedBy: "raw-worker-admin-subject",
        updatedAt: "2026-07-19T03:00:00.000Z",
        debug: { token: "must-not-leak" },
      },
    });
  };
  const options = {
    fetcher,
    env: {
      SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
      SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
    },
  };

  const status = await getWorkerPhotoCostGuard(options);
  const stopped = await updateWorkerPhotoCostGuard(
    { uploadsEnabled: false, readsEnabled: false, reason: "운영자 긴급 중단", ignored: "must-not-forward" } as never,
    options,
  );

  assert.equal(status.uploadsEnabled, true);
  assert.equal(stopped.uploadsEnabled, false);
  assert.equal(JSON.stringify(status).includes("raw-worker-admin-subject"), false);
  assert.equal(JSON.stringify(status).includes("must-not-leak"), false);
  assert.deepEqual(Object.keys(status).sort(), [
    "activeBytes",
    "dailyReadLimit",
    "dailyReadPercent",
    "dailyReadStopLimit",
    "dailyReadStopPercent",
    "dayUtc",
    "monthlyReadLimit",
    "monthlyReadStopLimit",
    "monthlyTransformLimit",
    "monthlyTransformStopLimit",
    "monthlyWriteLimit",
    "monthlyWriteStopLimit",
    "periodUtc",
    "readPercent",
    "readPeriodUtc",
    "readStopPercent",
    "readsEnabled",
    "readsInDay",
    "readsInPeriod",
    "reason",
    "storageMaxBytes",
    "storagePercent",
    "storageStopBytes",
    "storageStopPercent",
    "transformPercent",
    "transformPeriodUtc",
    "transformStopPercent",
    "transformsInPeriod",
    "updatedAt",
    "uploadsEnabled",
    "writePercent",
    "writeStopPercent",
    "writesInPeriod",
  ]);
  assert.deepEqual(
    requests.map((request) => [request.method, request.url, request.headers.get("x-silsigan-admin-token")]),
    [
      ["GET", "https://worker.example.test/api/admin/photo-cost-guard", "worker-admin-token"],
      ["PATCH", "https://worker.example.test/api/admin/photo-cost-guard", "worker-admin-token"],
    ],
  );
  assert.deepEqual(await requests[1]?.json(), {
    uploadsEnabled: false,
    readsEnabled: false,
    reconciliationAcknowledged: false,
    reason: "운영자 긴급 중단",
  });
});

test("worker global API guard helper validates meters and forwards only audited control fields", async () => {
  const requests: Request[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      success: true,
      data: {
        control: {
          mode: request.method === "PATCH" ? "stopped" : "running",
          reason: request.method === "PATCH" ? "운영자 긴급 중단" : "initial-enabled",
          generation: request.method === "PATCH" ? 2 : 1,
          automaticMetric: request.method === "PATCH" ? "manual" : null,
          updatedBy: "next-admin",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
        dayUtc: "2026-07-20",
        usage: { workersRequests: 10, d1RowsRead: 1000, d1RowsWritten: 100 },
        limits: {
          workersRequests: 100000,
          d1RowsRead: 5000000,
          d1RowsWritten: 100000,
          warnPercent: 60,
          degradePercent: 70,
          stopPercent: 80,
        },
        meters: { workersPercent: 0.01, d1ReadPercent: 0.02, d1WritePercent: 0.1 },
        reconciliationFresh: request.method === "POST",
        debug: { token: "must-not-leak" },
      },
    });
  };
  const options = {
    fetcher,
    env: {
      SILSIGAN_WORKER_API_BASE_URL: "https://worker.example.test",
      SILSIGAN_WORKER_ADMIN_TOKEN: "worker-admin-token",
    },
  };

  const status = await getWorkerApiCostGuard(options);
  await updateWorkerApiCostGuard({ mode: "stopped", reason: "운영자 긴급 중단", expectedGeneration: 1 }, options);
  await reconcileWorkerApiCostGuard({
    observedWorkersRequests: 10,
    observedD1RowsRead: 1000,
    observedD1RowsWritten: 100,
    note: "Cloudflare 대시보드 대조",
  }, options);

  assert.equal(status.control.mode, "running");
  assert.equal(JSON.stringify(status).includes("must-not-leak"), false);
  assert.deepEqual(requests.map((request) => [request.method, new URL(request.url).pathname]), [
    ["GET", "/api/admin/api-cost-guard"],
    ["PATCH", "/api/admin/api-cost-guard"],
    ["POST", "/api/admin/api-cost-guard/reconciliations"],
  ]);
  assert.deepEqual(await requests[1]?.json(), {
    mode: "stopped",
    reason: "운영자 긴급 중단",
    expectedGeneration: 1,
  });
  const reconciliationBody = await requests[2]?.json() as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(reconciliationBody).sort(),
    ["note", "observedAt", "observedD1RowsRead", "observedD1RowsWritten", "observedWorkersRequests", "source"].sort(),
  );
});

test("admin photo cost guard route authenticates before proxying and validates emergency actions", async () => {
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
    return Response.json({
      success: true,
      data: {
        uploadsEnabled: request.method !== "PATCH",
        readsEnabled: request.method !== "PATCH",
        reason: request.method === "PATCH" ? "운영자 긴급 중단" : null,
        activeBytes: 1024,
        storageMaxBytes: 4096,
        storageStopBytes: 3276,
        storagePercent: 25,
        storageStopPercent: 31.26,
        periodUtc: "2026-07",
        writesInPeriod: 10,
        monthlyWriteLimit: 100,
        monthlyWriteStopLimit: 80,
        writePercent: 10,
        writeStopPercent: 12.5,
        transformPeriodUtc: "2026-07",
        transformsInPeriod: 10,
        monthlyTransformLimit: 5_000,
        monthlyTransformStopLimit: 4_000,
        transformPercent: 0.2,
        transformStopPercent: 0.25,
        readPeriodUtc: "2026-07",
        readsInPeriod: 25,
        monthlyReadLimit: 1000,
        monthlyReadStopLimit: 800,
        readPercent: 2.5,
        readStopPercent: 3.13,
        dayUtc: "2026-07-19",
        readsInDay: 5,
        dailyReadLimit: 20_000,
        dailyReadStopLimit: 16_000,
        dailyReadPercent: 0.03,
        dailyReadStopPercent: 0.03,
        updatedBy: "raw-worker-subject",
        updatedAt: "2026-07-19T03:00:00.000Z",
      },
    });
  };

  try {
    await assert.rejects(
      () => handleAdminPhotoCostGuardGet(new Request("http://localhost/api/admin/photo-cost-guard")),
      /관리자 인증이 필요합니다/,
    );
    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uploadsEnabled: false, reason: "운영자 긴급 중단" }),
          }),
        ),
      /관리자 인증이 필요합니다/,
    );
    assert.equal(requests.length, 0);

    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: {
              cookie: "silsigan_admin=next-admin-token",
              "content-type": "application/json",
              origin: "https://attacker.example",
              "sec-fetch-site": "cross-site",
            },
            body: JSON.stringify({ uploadsEnabled: true, readsEnabled: true, reason: "공격자 재개 시도" }),
          }),
        ),
      /교차 출처 관리자 변경 요청을 허용하지 않습니다/,
    );
    assert.equal(requests.length, 0);

    assert.doesNotThrow(() =>
      assertAdminMutationOrigin(
        new Request("http://localhost:3000/api/admin/photo-cost-guard", {
          method: "PATCH",
          headers: {
            host: "127.0.0.1:4567",
            origin: "http://127.0.0.1:4567",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    );
    assert.throws(
      () =>
        assertAdminMutationOrigin(
          new Request("http://localhost:3000/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: {
              host: "127.0.0.1:4567",
              origin: "https://attacker.example",
              "sec-fetch-site": "same-origin",
            },
          }),
        ),
      /교차 출처 관리자 변경 요청을 허용하지 않습니다/,
    );

    const authHeaders = {
      "x-silsigan-admin-token": "next-admin-token",
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    };
    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ uploadsEnabled: "false", reason: "짧음" }),
          }),
        ),
      /업로드 제어 상태가 올바르지 않습니다/,
    );
    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ uploadsEnabled: false, readsEnabled: "false", reason: "운영자 긴급 중단" }),
          }),
        ),
      /조회 제어 상태가 올바르지 않습니다/,
    );
    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ uploadsEnabled: false, readsEnabled: false, reason: "짧음" }),
          }),
        ),
      /중단 또는 재개 사유를 5자 이상 입력해 주세요/,
    );
    await assert.rejects(
      () =>
        handleAdminPhotoCostGuardPatch(
          new Request("http://localhost/api/admin/photo-cost-guard", {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ uploadsEnabled: true, readsEnabled: true, reason: "운영 대조 없이 재개" }),
          }),
        ),
      /Cloudflare 사용량과 D1 원장 대조 확인이 필요합니다/,
    );
    assert.equal(requests.length, 0);

    const status = await handleAdminPhotoCostGuardGet(
      new Request("http://localhost/api/admin/photo-cost-guard", { headers: authHeaders }),
    );
    const stopped = await handleAdminPhotoCostGuardPatch(
      new Request("http://localhost/api/admin/photo-cost-guard", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ uploadsEnabled: false, readsEnabled: false, reason: "운영자 긴급 중단", ignored: "must-not-forward" }),
      }),
    );

    assert.equal(status.uploadsEnabled, true);
    assert.equal(status.readsEnabled, true);
    assert.equal(stopped.uploadsEnabled, false);
    assert.equal(stopped.readsEnabled, false);
    assert.equal(JSON.stringify(status).includes("raw-worker-subject"), false);
    assert.deepEqual(await requests[1]?.json(), {
      uploadsEnabled: false,
      readsEnabled: false,
      reconciliationAcknowledged: false,
      reason: "운영자 긴급 중단",
    });
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
  }
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

test("browser-facing worker admin mutations reject cross-origin cookie requests before proxying", async () => {
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

  const mutationCases: Array<{
    handler: (request: Request) => Promise<unknown>;
    url: string;
    body: Record<string, unknown>;
  }> = [
    {
      handler: handleAdminWorkerReportsPost,
      url: "http://localhost/api/admin/moderation/reports",
      body: { reportId: "report_worker_route", status: "accepted", reason: "운영자 승인" },
    },
    {
      handler: handleAdminFieldReportsPost,
      url: "http://localhost/api/admin/field-reports",
      body: { reportId: "field_report_12345678", status: "approved", reason: "운영자 승인" },
    },
    {
      handler: handleAdminWorkerCoordinateStatusPost,
      url: "http://localhost/api/admin/places/coordinate-status",
      body: {
        placeId: "jeju-coordinate-review",
        coordinateStatus: "verified",
        latitude: 33.4996,
        longitude: 126.5312,
        source: "coordinate QA",
        reason: "좌표 검증 완료",
      },
    },
    {
      handler: handleAdminWorkerUserRestrictPost,
      url: "http://localhost/api/admin/users/restrict",
      body: {
        anonymousUserId: "anon_1234567890abcdef1234567890abcdef1234567890abcdef",
        reason: "반복 스팸",
      },
    },
    {
      handler: handleAdminWorkerUserUnrestrictPost,
      url: "http://localhost/api/admin/users/unrestrict",
      body: {
        anonymousUserId: "anon_1234567890abcdef1234567890abcdef1234567890abcdef",
        reason: "테스트 제한 해제",
      },
    },
  ];

  try {
    for (const mutation of mutationCases) {
      await assert.rejects(
        () =>
          mutation.handler(
            new Request(mutation.url, {
              method: "POST",
              headers: {
                cookie: "silsigan_admin=next-admin-token",
                "content-type": "application/json",
                origin: "https://attacker.example",
                "sec-fetch-site": "cross-site",
              },
              body: JSON.stringify(mutation.body),
            }),
          ),
        /교차 출처 관리자 변경 요청을 허용하지 않습니다/,
      );
    }

    assert.equal(fetchCalls, 0);
  } finally {
    restoreEnv("SILSIGAN_ADMIN_TOKEN", previousAdminToken);
    restoreEnv("SILSIGAN_WORKER_API_BASE_URL", previousWorkerBaseUrl);
    restoreEnv("SILSIGAN_WORKER_ADMIN_TOKEN", previousWorkerToken);
    globalThis.fetch = originalFetch;
    clearRateLimitBucketsForTests();
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

test("admin field report route requires Next auth and proxies moderation safely", async () => {
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
    const fieldReport = {
      id: "field_report_12345678",
      placeId: "busan-gwangalli",
      placeName: "광안리해수욕장",
      category: "tourism",
      crowdLevel: "busy",
      lineStatus: null,
      parkingStatus: "limited",
      verifiedRadiusM: 150,
      verificationMethod: "radius",
      accuracyBucket: "high",
      moderationStatus: request.method === "POST" ? "approved" : "pending",
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-14T00:30:00.000Z",
      anonymousUserId: "anon_route_reporter",
      clientLocation: { latitude: 35.1532, longitude: 129.1186 },
    };
    return Response.json({ success: true, data: request.method === "POST" ? fieldReport : [fieldReport] });
  };

  try {
    await assert.rejects(
      () => handleAdminFieldReportsGet(new Request("http://localhost/api/admin/field-reports?status=pending")),
      /관리자 인증이 필요합니다/,
    );

    const authHeaders = { "x-silsigan-admin-token": "next-admin-token" };
    const listPayload = await handleAdminFieldReportsGet(
      new Request("http://localhost/api/admin/field-reports?status=pending&limit=99", { headers: authHeaders }),
    );
    const actionPayload = await handleAdminFieldReportsPost(
      new Request("http://localhost/api/admin/field-reports", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ reportId: "field_report_12345678", status: "approved", reason: "운영자 승인" }),
      }),
    );

    assert.equal(JSON.stringify(listPayload).includes("anon_route_reporter"), false);
    assert.equal(JSON.stringify(listPayload).includes("35.1532"), false);
    assert.equal(JSON.stringify(actionPayload).includes("clientLocation"), false);
    assert.equal(requests[0]?.url, "https://worker.example.test/api/admin/field-reports?limit=50&status=pending");
    assert.equal(requests[0]?.headers.get("x-silsigan-admin-token"), "worker-admin-token");
    assert.equal(requests[1]?.url, "https://worker.example.test/api/admin/field-reports/field_report_12345678/action");
    assert.deepEqual(await requests[1]?.json(), { status: "approved", reason: "운영자 승인" });
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

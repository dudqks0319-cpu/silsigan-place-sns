import {
  type FlagReason,
  type Place,
  type StoredHashtag,
  type StoredPost,
  type StoredQuestion,
  type StoredReport,
  buildShareCard,
  classifyHashtag,
  creditEventForQuestion,
  creditEventsForReport,
  distanceMeters,
  getCategorySafetyWarning,
  getQuestionCost,
  getReportExpiry,
  isReportExpired,
  rankPostsForFeed,
  recommendHashtags,
  shouldHideForFlags,
  uniqueHashtags,
  verifiedRadiusFromDistance,
} from "./domain.ts";
import { ApiError } from "./errors.ts";
import type { CreatePostInput, CreateQuestionInput, CreateReportInput, FlagPostInput, FlagReportInput } from "./validators.ts";

export const mockPlaces: Place[] = [
  {
    id: "ulsan-taehwagang",
    name: "태화강 국가정원",
    address: "울산 중구 태화강국가정원길",
    category: "tourism",
    latitude: 35.5486,
    longitude: 129.3005,
    region: "ulsan",
  },
  {
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    address: "부산 수영구 광안해변로",
    category: "tourism",
    latitude: 35.1532,
    longitude: 129.1186,
    region: "busan",
  },
  {
    id: "gyeongju-hwangridan",
    name: "황리단길",
    address: "경북 경주시 포석로",
    category: "restaurant_cafe",
    latitude: 35.8382,
    longitude: 129.2098,
    region: "gyeongju",
  },
  {
    id: "ulsan-city-hall",
    name: "울산광역시청",
    address: "울산 남구 중앙로 201",
    category: "public_office",
    latitude: 35.5396,
    longitude: 129.3115,
    region: "ulsan",
  },
];

const posts: StoredPost[] = [
  makeSeedPost({
    id: "post_seed_gwangalli_parking",
    placeId: "busan-gwangalli",
    creatorName: "부산 해변러",
    creatorBadge: "광안리 현장 인증 10회",
    caption: "해변 앞 공영주차장 거의 막혔고 민락 쪽으로 우회하는 게 나아요.",
    crowdLevel: "packed",
    parkingStatus: "full",
    lineStatus: "medium",
    weatherFeel: "good",
    photoCount: 2,
    photoLabel: "광안리 주차장 입구",
    helpfulCount: 31,
    commentCount: 8,
    hashtagNames: ["광안리주차살려줘", "광안리주차", "주차만차", "부산", "지금"],
    minutesAgo: 12,
  }),
  makeSeedPost({
    id: "post_seed_hwangridan_waiting",
    placeId: "gyeongju-hwangridan",
    creatorName: "경주 골목러",
    creatorBadge: "웨이팅 답변왕",
    caption: "메인 골목은 붐비지만 인기 카페 줄은 20분 안쪽입니다.",
    crowdLevel: "busy",
    parkingStatus: "limited",
    lineStatus: "medium",
    weatherFeel: "good",
    photoCount: 1,
    photoLabel: "황리단길 카페 대기줄",
    helpfulCount: 18,
    commentCount: 5,
    hashtagNames: ["황리단길웨이팅", "경주", "사람많음", "사진스팟", "지금"],
    minutesAgo: 24,
  }),
  makeSeedPost({
    id: "post_seed_taehwagang_walk",
    placeId: "ulsan-taehwagang",
    creatorName: "울산 현장러",
    creatorBadge: "태화강 제보왕",
    caption: "국가정원 산책로는 여유 있고 노을 쪽 사진 찍기 좋습니다.",
    crowdLevel: "quiet",
    parkingStatus: "available",
    lineStatus: "none",
    weatherFeel: "good",
    photoCount: 3,
    photoLabel: "태화강 국가정원 산책로",
    helpfulCount: 27,
    commentCount: 4,
    hashtagNames: ["태화강산책", "울산", "한산함", "사진스팟", "지금"],
    minutesAgo: 37,
  }),
  makeSeedPost({
    id: "post_seed_cityhall_sensitive",
    placeId: "ulsan-city-hall",
    creatorName: "주차 제보왕",
    creatorBadge: "민감장소 안전 촬영",
    caption: "민원실 내부가 아니라 외부 주차 동선만 확인했습니다. 차량번호는 가려야 해요.",
    crowdLevel: "normal",
    parkingStatus: "limited",
    lineStatus: "short",
    weatherFeel: "rainy",
    photoCount: 1,
    photoLabel: "시청 외부 주차 동선",
    helpfulCount: 9,
    commentCount: 2,
    hashtagNames: ["울산주차", "비오는날", "주의", "지금"],
    minutesAgo: 52,
  }),
];
const reports: StoredReport[] = posts.map(postToReport);
const questions: StoredQuestion[] = [
  {
    id: "question_seed_gwangalli",
    placeId: "busan-gwangalli",
    questionType: "parking",
    body: "센텀 쪽으로 대면 걸어갈 만한가요?",
    creditCost: 1,
    answeredReportId: null,
    createdAt: minutesAgoIso(7),
  },
  {
    id: "question_seed_hwangridan",
    placeId: "gyeongju-hwangridan",
    questionType: "line",
    body: "황리단길 카페 웨이팅 지금도 긴가요?",
    creditCost: 1,
    answeredReportId: null,
    createdAt: minutesAgoIso(18),
  },
];
const flagsByReportId = new Map<string, FlagReason[]>();
const flagsByPostId = new Map<string, FlagReason[]>();
flagsByPostId.set("post_seed_cityhall_sensitive", ["false_content"]);

export function listPlaces() {
  return mockPlaces.map((place) => ({
    ...place,
    safetyWarning: getCategorySafetyWarning(place.category),
  }));
}

export function listReports(filters: { placeId?: string; includeExpired?: boolean } = {}) {
  const now = new Date();

  return reports.filter((report) => {
    if (filters.placeId && report.placeId !== filters.placeId) {
      return false;
    }

    if (report.hiddenAt) {
      return false;
    }

    if (!filters.includeExpired && isReportExpired(new Date(report.expiresAt), now)) {
      return false;
    }

    return true;
  });
}

export function createReport(input: CreateReportInput) {
  const place = findPlace(input.placeId);
  if (input.category !== place.category) {
    throw new ApiError(400, "CATEGORY_MISMATCH", "제보 카테고리가 장소 카테고리와 일치하지 않습니다.");
  }

  const verifiedRadiusM = verifiedRadiusForInput(place, input.clientLocation);

  const now = new Date();
  const report: StoredReport = {
    id: `report_${crypto.randomUUID()}`,
    placeId: input.placeId,
    category: input.category,
    crowdLevel: input.crowdLevel,
    lineStatus: input.lineStatus,
    parkingStatus: input.parkingStatus,
    weatherFeel: input.weatherFeel,
    comment: input.comment || null,
    photoUrl: input.photoUrl || null,
    verifiedRadiusM,
    createdAt: now.toISOString(),
    expiresAt: getReportExpiry(now).toISOString(),
    flagCount: 0,
    hiddenAt: null,
  };

  reports.unshift(report);

  return {
    report,
    credits: creditEventsForReport(Boolean(verifiedRadiusM), Boolean(input.photoUrl)),
    safetyWarning: getCategorySafetyWarning(input.category),
    privacyNotice: "클라이언트 좌표는 반경 검증에만 사용되며 목업 저장소와 DB 모델에 저장하지 않습니다.",
  };
}

export function listPosts(filters: { placeId?: string; hashtagName?: string; includeHidden?: boolean } = {}) {
  const filteredPosts = posts.filter((post) => {
    if (filters.placeId && post.placeId !== filters.placeId) {
      return false;
    }

    if (!filters.includeHidden && post.hiddenAt) {
      return false;
    }

    if (filters.hashtagName && !post.hashtagNames.includes(filters.hashtagName)) {
      return false;
    }

    return true;
  });

  return rankPostsForFeed(filteredPosts).map(publicPost);
}

export function listHashtags(): StoredHashtag[] {
  const counts = new Map<string, number>();

  for (const post of posts) {
    if (post.hiddenAt) {
      continue;
    }

    for (const name of post.hashtagNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, postCount]) => ({
      id: `hashtag_${name}`,
      name,
      tagType: classifyHashtag(name),
      postCount,
      createdAt: posts.find((post) => post.hashtagNames.includes(name))?.createdAt ?? new Date().toISOString(),
    }))
    .sort((left, right) => right.postCount - left.postCount || left.name.localeCompare(right.name, "ko"));
}

export function createPost(input: CreatePostInput) {
  const place = findPlace(input.placeId);
  const verifiedRadiusM = verifiedRadiusForInput(place, input.clientLocation);
  const recommendedHashtags = recommendHashtags({
    place,
    crowdLevel: input.crowdLevel,
    parkingStatus: input.parkingStatus,
    lineStatus: input.lineStatus,
    weatherFeel: input.weatherFeel,
  });
  const hashtagNames = uniqueHashtags([...input.hashtagNames, ...recommendedHashtags]).slice(0, 5);
  const now = new Date();
  const post: StoredPost = {
    id: `post_${crypto.randomUUID()}`,
    userId: "demo-user",
    creatorName: "실시간러버",
    creatorBadge: place.region === "busan" ? "부산 현장러" : place.region === "gyeongju" ? "경주 골목러" : "울산 현장러",
    placeId: input.placeId,
    caption: input.caption || null,
    crowdLevel: input.crowdLevel,
    parkingStatus: input.parkingStatus,
    lineStatus: input.lineStatus,
    weatherFeel: input.weatherFeel,
    locationVerified: Boolean(verifiedRadiusM),
    verifiedRadiusM,
    photoCount: input.photoCount,
    photoLabel: input.photoCount > 0 ? `${place.name} 현장 사진` : "상태 제보",
    helpfulCount: 0,
    commentCount: 0,
    hashtagNames,
    hiddenAt: null,
    createdAt: now.toISOString(),
  };

  posts.unshift(post);
  reports.unshift(postToReport(post));

  return {
    post: publicPost(post),
    credits: creditEventsForReport(Boolean(verifiedRadiusM), input.photoCount > 0),
    recommendedHashtags,
    safetyWarning: getCategorySafetyWarning(place.category),
    privacyNotice: "정확한 좌표와 EXIF는 저장하지 않고 장소 반경 검증과 안전 처리 상태만 남깁니다.",
  };
}

export function listQuestions(placeId?: string) {
  return questions.filter((question) => !placeId || question.placeId === placeId);
}

export function createQuestion(input: CreateQuestionInput) {
  findPlace(input.placeId);

  const creditCost = getQuestionCost(input.questionType);
  if (input.availableCredits < creditCost) {
    throw new ApiError(402, "INSUFFICIENT_CREDITS", "질문권이 부족합니다.", {
      requiredCredits: creditCost,
      availableCredits: input.availableCredits,
    });
  }

  const question: StoredQuestion = {
    id: `question_${crypto.randomUUID()}`,
    placeId: input.placeId,
    questionType: input.questionType,
    body: input.body,
    creditCost,
    answeredReportId: null,
    createdAt: new Date().toISOString(),
  };

  questions.unshift(question);

  return {
    question,
    creditEvent: creditEventForQuestion(input.questionType),
  };
}

export function flagReport(input: FlagReportInput) {
  const report = reports.find((candidate) => candidate.id === input.reportId);
  if (!report) {
    throw new ApiError(404, "REPORT_NOT_FOUND", "제보를 찾을 수 없습니다.");
  }

  const existingFlags = flagsByReportId.get(report.id) ?? [];
  const nextFlags = [...existingFlags, input.reason];
  flagsByReportId.set(report.id, nextFlags);

  report.flagCount = nextFlags.length;
  if (!report.hiddenAt && shouldHideForFlags(nextFlags)) {
    report.hiddenAt = new Date().toISOString();
  }
  const linkedPost = posts.find((post) => post.id === report.id);
  if (linkedPost && report.hiddenAt) {
    linkedPost.hiddenAt = report.hiddenAt;
  }

  return {
    reportId: report.id,
    hidden: Boolean(report.hiddenAt),
    flagCount: report.flagCount,
    hideRule: "privacy/sensitive 1건, 허위 2건, 전체 신고 3건 이상이면 자동 숨김 처리",
  };
}

export function flagPost(input: FlagPostInput) {
  const post = findPost(input.postId);
  const existingFlags = flagsByPostId.get(post.id) ?? [];
  const nextFlags = [...existingFlags, input.reason];
  flagsByPostId.set(post.id, nextFlags);

  if (!post.hiddenAt && shouldHideForFlags(nextFlags)) {
    post.hiddenAt = new Date().toISOString();
  }
  const linkedReport = reports.find((report) => report.id === post.id);
  if (linkedReport && post.hiddenAt) {
    linkedReport.hiddenAt = post.hiddenAt;
  }

  return {
    postId: post.id,
    hidden: Boolean(post.hiddenAt),
    flagCount: nextFlags.length,
    hideRule: "얼굴/차량번호/민감정보 신고 1건, 허위 2건, 전체 신고 3건 이상이면 임시 숨김 처리",
  };
}

export function listPostModerationQueue(filters: { reason?: FlagReason | "hidden" } = {}) {
  return posts
    .map((post) => {
      const flagReasonsForPost = flagsByPostId.get(post.id) ?? [];

      return {
        post: publicPost(post),
        place: findPlace(post.placeId),
        flagReasons: flagReasonsForPost,
        flagCount: flagReasonsForPost.length,
        hidden: Boolean(post.hiddenAt),
        recommendedAction: moderationRecommendation(flagReasonsForPost, Boolean(post.hiddenAt)),
      };
    })
    .filter((item) => {
      if (filters.reason === "hidden") {
        return item.hidden;
      }

      if (filters.reason) {
        return item.flagReasons.includes(filters.reason);
      }

      return item.flagCount > 0 || item.hidden;
    })
    .sort((left, right) => right.flagCount - left.flagCount || new Date(right.post.createdAt).getTime() - new Date(left.post.createdAt).getTime());
}

export function moderatePost(input: { postId: string; action: "keep" | "hide" | "delete" | "restrict_author" }) {
  const post = findPost(input.postId);

  if (input.action === "keep") {
    flagsByPostId.set(post.id, []);
  }

  if ((input.action === "hide" || input.action === "delete") && !post.hiddenAt) {
    post.hiddenAt = new Date().toISOString();
  }

  const linkedReport = reports.find((report) => report.id === post.id);
  if (linkedReport && post.hiddenAt) {
    linkedReport.hiddenAt = post.hiddenAt;
  }

  return {
    postId: post.id,
    action: input.action,
    hidden: Boolean(post.hiddenAt),
    note: "데모 저장소의 운영 액션입니다. 실서비스에서는 처리자, 사유, 처리 로그를 별도 저장해야 합니다.",
  };
}

function findPlace(placeId: string) {
  const place = mockPlaces.find((candidate) => candidate.id === placeId);
  if (!place) {
    throw new ApiError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
  }

  return place;
}

function findPost(postId: string) {
  const post = posts.find((candidate) => candidate.id === postId);
  if (!post) {
    throw new ApiError(404, "POST_NOT_FOUND", "게시물을 찾을 수 없습니다.");
  }

  return post;
}

function verifiedRadiusForInput(place: Place, clientLocation: CreateReportInput["clientLocation"]) {
  if (!clientLocation) {
    return null;
  }

  const distanceM = distanceMeters(clientLocation, {
    latitude: place.latitude,
    longitude: place.longitude,
  });
  const verifiedRadiusM = verifiedRadiusFromDistance(distanceM);

  return verifiedRadiusM;
}

function moderationRecommendation(reasons: FlagReason[], hidden: boolean) {
  if (hidden) {
    return "이미 임시 숨김";
  }

  if (reasons.some((reason) => ["privacy_face", "privacy_plate", "sensitive_info"].includes(reason))) {
    return "즉시 숨김 검토";
  }

  if (reasons.includes("false_content")) {
    return "현장성 재검증";
  }

  if (reasons.includes("spam")) {
    return "작성자 제한 검토";
  }

  return "운영자 확인";
}

function publicPost(post: StoredPost) {
  const place = findPlace(post.placeId);

  return {
    ...post,
    hashtags: post.hashtagNames.map((name) => ({
      id: `hashtag_${name}`,
      name,
      tagType: classifyHashtag(name),
      postCount: posts.filter((candidate) => !candidate.hiddenAt && candidate.hashtagNames.includes(name)).length,
      createdAt: post.createdAt,
    })),
    shareCard: buildShareCard(post, place),
    judgement: buildShareCard(post, place).headline.replace(`${place.name} `, ""),
    safetyWarning: getCategorySafetyWarning(place.category),
  };
}

function postToReport(post: StoredPost): StoredReport {
  const place = findPlace(post.placeId);
  const createdAt = new Date(post.createdAt);

  return {
    id: post.id,
    placeId: post.placeId,
    category: place.category,
    crowdLevel: post.crowdLevel,
    lineStatus: post.lineStatus,
    parkingStatus: post.parkingStatus,
    weatherFeel: post.weatherFeel,
    comment: post.caption,
    photoUrl: post.photoCount > 0 ? `demo://${post.photoLabel}` : null,
    verifiedRadiusM: post.verifiedRadiusM,
    createdAt: post.createdAt,
    expiresAt: getReportExpiry(createdAt).toISOString(),
    flagCount: 0,
    hiddenAt: post.hiddenAt,
  };
}

function makeSeedPost(input: Omit<StoredPost, "userId" | "locationVerified" | "verifiedRadiusM" | "hiddenAt" | "createdAt"> & { minutesAgo: number }): StoredPost {
  const { minutesAgo, ...post } = input;

  return {
    userId: `seed-${input.creatorName}`,
    locationVerified: true,
    verifiedRadiusM: 50,
    hiddenAt: null,
    createdAt: minutesAgoIso(minutesAgo),
    ...post,
  };
}

function minutesAgoIso(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const REPORT_TTL_HOURS = 3;

export const reportCategories = [
  "tourism",
  "festival",
  "restaurant_cafe",
  "hospital",
  "public_office",
  "parking",
] as const;

export type ReportCategory = (typeof reportCategories)[number];

export const sensitiveCategories = ["hospital", "public_office"] as const;

export type SensitiveCategory = (typeof sensitiveCategories)[number];

export const crowdLevels = ["quiet", "normal", "busy", "packed"] as const;
export type CrowdLevel = (typeof crowdLevels)[number];

export const lineStatuses = ["none", "short", "medium", "long"] as const;
export type LineStatus = (typeof lineStatuses)[number];

export const parkingStatuses = ["available", "limited", "full", "unknown"] as const;
export type ParkingStatus = (typeof parkingStatuses)[number];

export const weatherFeels = ["good", "rainy", "windy", "hot", "cold"] as const;
export type WeatherFeel = (typeof weatherFeels)[number];

export const questionTypes = ["crowd", "line", "parking", "weather", "photo_request", "other"] as const;
export type QuestionType = (typeof questionTypes)[number];

export const flagReasons = [
  "false_content",
  "spam",
  "privacy_face",
  "privacy_plate",
  "sensitive_info",
  "other",
] as const;
export type FlagReason = (typeof flagReasons)[number];

export const hashtagTypes = ["place", "status", "purpose", "time", "region"] as const;
export type HashtagType = (typeof hashtagTypes)[number];

export type CreditEventType =
  | "signup_bonus"
  | "verified_report"
  | "photo_report"
  | "answer_question"
  | "ask_question"
  | "ask_photo_request"
  | "confirmed_false_report";

export type CreditEvent = {
  type: CreditEventType;
  amount: number;
};

export type Place = {
  id: string;
  name: string;
  address: string;
  category: ReportCategory;
  latitude: number;
  longitude: number;
  region: "ulsan" | "busan" | "gyeongju";
};

export type StoredReport = {
  id: string;
  placeId: string;
  category: ReportCategory;
  crowdLevel: CrowdLevel;
  lineStatus: LineStatus;
  parkingStatus: ParkingStatus;
  weatherFeel: WeatherFeel;
  comment: string | null;
  photoUrl: string | null;
  verifiedRadiusM: 50 | 150 | 300 | null;
  createdAt: string;
  expiresAt: string;
  flagCount: number;
  hiddenAt: string | null;
};

export type StoredQuestion = {
  id: string;
  placeId: string;
  questionType: QuestionType;
  body: string;
  creditCost: 1 | 2;
  answeredReportId: string | null;
  createdAt: string;
};

export type StoredHashtag = {
  id: string;
  name: string;
  tagType: HashtagType;
  postCount: number;
  createdAt: string;
};

export type StoredPost = {
  id: string;
  userId: string;
  creatorName: string;
  creatorBadge: string;
  placeId: string;
  caption: string | null;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  locationVerified: boolean;
  verifiedRadiusM: 50 | 150 | 300 | null;
  photoCount: number;
  photoLabel: string;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  hiddenAt: string | null;
  createdAt: string;
};

export type ShareCard = {
  headline: string;
  body: string;
  url: string;
  hashtags: string[];
  variant: "avoid" | "good" | "parking_full" | "waiting" | "photo_spot";
};

export function getCategorySafetyWarning(category: ReportCategory): string | null {
  if (category === "hospital") {
    return "병원 제보에는 환자 얼굴, 접수번호, 진료 정보, 의료진 개인정보가 보이지 않게 촬영해 주세요.";
  }

  if (category === "public_office") {
    return "관공서 제보에는 민원인 얼굴, 서류, 차량번호, 창구 개인정보가 보이지 않게 촬영해 주세요.";
  }

  return null;
}

export function getReportExpiry(createdAt: Date = new Date()): Date {
  return new Date(createdAt.getTime() + REPORT_TTL_HOURS * 60 * 60 * 1000);
}

export function isReportExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function getQuestionCost(questionType: QuestionType): 1 | 2 {
  return questionType === "photo_request" ? 2 : 1;
}

export function calculateCreditBalance(events: CreditEvent[]): number {
  return events.reduce((balance, event) => balance + event.amount, 0);
}

export function creditEventForQuestion(questionType: QuestionType): CreditEvent {
  const cost = getQuestionCost(questionType);

  return {
    type: questionType === "photo_request" ? "ask_photo_request" : "ask_question",
    amount: -cost,
  };
}

export function creditEventsForReport(hasVerifiedLocation: boolean, hasPhoto: boolean): CreditEvent[] {
  const events: CreditEvent[] = [];

  if (hasVerifiedLocation) {
    events.push({ type: "verified_report", amount: 1 });
  }

  if (hasPhoto) {
    events.push({ type: "photo_report", amount: 1 });
  }

  return events;
}

export function shouldHideForFlags(flagReasonsToReview: FlagReason[]): boolean {
  const privacyFlags = flagReasonsToReview.filter((reason) =>
    ["privacy_face", "privacy_plate", "sensitive_info"].includes(reason),
  ).length;
  const falseContentFlags = flagReasonsToReview.filter((reason) => reason === "false_content").length;

  return privacyFlags >= 1 || falseContentFlags >= 2 || flagReasonsToReview.length >= 3;
}

export function normalizeHashtagName(input: string): string {
  return input
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 24);
}

export function classifyHashtag(name: string): HashtagType {
  if (/주차|웨이팅|사람|한산|만차|줄/.test(name)) {
    return "status";
  }

  if (/아이랑|데이트|산책|사진|노을|혼자|비오는날/.test(name)) {
    return "purpose";
  }

  if (/지금|오늘|주말|야경|오후/.test(name)) {
    return "time";
  }

  if (/울산|부산|경주/.test(name)) {
    return "region";
  }

  return "place";
}

export function judgementFromStatus(crowdLevel: CrowdLevel, parkingStatus: ParkingStatus): "가도 좋음" | "주의" | "지금은 비추" {
  if (crowdLevel === "packed" || parkingStatus === "full") {
    return "지금은 비추";
  }

  if (crowdLevel === "busy" || parkingStatus === "limited") {
    return "주의";
  }

  return "가도 좋음";
}

export function recommendHashtags(input: {
  place: Pick<Place, "name" | "region">;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
}): string[] {
  const tags = [
    normalizeHashtagName(`${input.place.name}지금`),
    statusHashtag(input.crowdLevel, input.parkingStatus, input.lineStatus),
    purposeHashtag(input.place.name, input.weatherFeel),
    regionHashtag(input.place.region),
    "지금",
  ];

  return uniqueHashtags(tags).slice(0, 5);
}

export function uniqueHashtags(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const normalized = normalizeHashtagName(name);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function buildShareCard(post: Pick<StoredPost, "caption" | "crowdLevel" | "parkingStatus" | "lineStatus" | "weatherFeel" | "photoCount" | "createdAt" | "hashtagNames">, place: Pick<Place, "id" | "name">): ShareCard {
  const judgement = judgementFromStatus(post.crowdLevel, post.parkingStatus);
  const variant = shareCardVariant(post, judgement);
  const statusText = [
    crowdStatusLabel(post.crowdLevel),
    `주차 ${parkingStatusLabel(post.parkingStatus)}`,
    `줄 ${lineStatusLabel(post.lineStatus)}`,
  ].join(" · ");

  return {
    headline: `${place.name} ${judgement}`,
    body: `${statusText}\n${minutesAgoLabel(post.createdAt)} 현장 인증 제보\n${post.caption ?? "지금 현장 상태를 확인해 보세요."}`,
    url: `https://silsigan.vercel.app/place/${place.id}`,
    hashtags: post.hashtagNames.slice(0, 5),
    variant,
  };
}

function shareCardVariant(
  post: Pick<StoredPost, "crowdLevel" | "parkingStatus" | "lineStatus" | "photoCount" | "weatherFeel">,
  judgement: "가도 좋음" | "주의" | "지금은 비추",
): ShareCard["variant"] {
  if (post.parkingStatus === "full") return "parking_full";
  if (post.lineStatus === "medium" || post.lineStatus === "long") return "waiting";
  if (judgement === "지금은 비추") return "avoid";
  if (post.photoCount > 0 && post.weatherFeel === "good") return "photo_spot";
  return "good";
}

export function rankPostsForFeed<TPost extends Pick<StoredPost, "createdAt" | "locationVerified" | "photoCount" | "helpfulCount" | "commentCount" | "hiddenAt">>(postsToRank: TPost[]): TPost[] {
  return [...postsToRank]
    .filter((post) => !post.hiddenAt)
    .sort((left, right) => scorePost(right) - scorePost(left));
}

export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusM * c;
}

export function verifiedRadiusFromDistance(distanceM: number): 50 | 150 | 300 | null {
  if (distanceM <= 50) {
    return 50;
  }

  if (distanceM <= 150) {
    return 150;
  }

  if (distanceM <= 300) {
    return 300;
  }

  return null;
}

function statusHashtag(crowdLevel: CrowdLevel, parkingStatus: ParkingStatus, lineStatus: LineStatus): string {
  if (parkingStatus === "full") return "주차만차";
  if (parkingStatus === "limited") return "광안리주차";
  if (lineStatus === "long" || lineStatus === "medium") return "웨이팅있음";
  if (crowdLevel === "packed" || crowdLevel === "busy") return "사람많음";
  return "한산함";
}

function purposeHashtag(placeName: string, weatherFeel: WeatherFeel): string {
  if (weatherFeel === "rainy") return "비오는날";
  if (placeName.includes("태화강")) return "태화강산책";
  if (placeName.includes("광안리")) return "광안리노을";
  if (placeName.includes("황리단길")) return "황리단길웨이팅";
  return "사진스팟";
}

function regionHashtag(region: Place["region"]): string {
  if (region === "busan") return "부산";
  if (region === "gyeongju") return "경주";
  return "울산";
}

function scorePost(post: Pick<StoredPost, "createdAt" | "locationVerified" | "photoCount" | "helpfulCount" | "commentCount">): number {
  const ageMinutes = Math.max(0, (Date.now() - new Date(post.createdAt).getTime()) / 60_000);
  const recentScore = Math.max(0, 240 - ageMinutes);

  return recentScore + Number(post.locationVerified) * 80 + Math.min(post.photoCount, 3) * 24 + post.helpfulCount * 3 + post.commentCount * 2;
}

function crowdStatusLabel(crowdLevel: CrowdLevel): string {
  if (crowdLevel === "quiet") return "한산";
  if (crowdLevel === "busy") return "사람 많음";
  if (crowdLevel === "packed") return "사람 매우 많음";
  return "보통";
}

function parkingStatusLabel(parkingStatus: ParkingStatus): string {
  if (parkingStatus === "available") return "여유";
  if (parkingStatus === "limited") return "거의 없음";
  if (parkingStatus === "full") return "만차";
  return "정보 없음";
}

function lineStatusLabel(lineStatus: LineStatus): string {
  if (lineStatus === "none") return "없음";
  if (lineStatus === "short") return "짧음";
  if (lineStatus === "medium") return "보통";
  return "김";
}

function minutesAgoLabel(createdAt: string): string {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));

  if (diffMinutes >= 60) {
    return `${Math.round(diffMinutes / 60)}시간 전`;
  }

  return `${diffMinutes}분 전`;
}

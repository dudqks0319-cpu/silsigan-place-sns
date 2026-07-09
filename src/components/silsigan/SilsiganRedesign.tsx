"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bookmark,
  Camera,
  Car,
  CheckCircle2,
  ChevronRight,
  CircleParking,
  Clock,
  CloudSun,
  Filter,
  Flag,
  Hash,
  Heart,
  Home,
  Image as ImageIcon,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MessageCircleQuestion,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Ticket,
  User,
  UserX,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type CSSProperties, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudflareApiUrl, fetchJson, isCloudflareApiConfigured } from "@/lib/api-client";
import { buildScopedApiPath, normalizeRegionScope } from "@/lib/api-scope";
import type { CloudflareRealtimeEvent, CloudflareRealtimeRoom } from "@/lib/cloudflare-api";
import { workerPlacesToAppPlaces, type WorkerPlace } from "@/lib/cloudflare-place-adapter";
import { trackEvent } from "@/lib/analytics";
import { calculateTrustScore, rankPostsForFeed, recommendHashtags } from "@/lib/domain";
import type {
  CrowdLevel,
  FieldQuest,
  FlagReason,
  LineStatus,
  ParkingStatus,
  Place as ApiPlace,
  QuestionType,
  ReportCategory,
  ShareCard,
  UserReputation,
  WeatherFeel,
} from "@/lib/domain";
import { getSiteUrl } from "@/lib/site-url";
import { CurrentLocationButton, type LocationPermissionState, type UiLocation } from "./CurrentLocationButton";
import { EmptyState as SharedEmptyState } from "./EmptyState";
import { crowdLabels, lineLabels, parkingLabels, weatherLabels } from "./labels";
import { NaverMap, type MapBounds } from "./NaverMap";
import { PlaceDetailSheet } from "./PlaceDetailSheet";
import type { PlaceComment } from "./CommentFeed";
import { PhotoUploader, type PlacePhoto, type PreparedPhotoUpload } from "./PhotoUploader";
import { RankingPanel } from "./RankingPanel";
import { RegionTabs, type RegionTabId } from "./RegionTabs";
import styles from "./SilsiganRedesign.module.css";

type View = "home" | "search" | "upload" | "map" | "place" | "ask" | "my";
type StatusTone = "calm" | "normal" | "busy" | "danger";
type Category = ReportCategory;
type DataMode = "live" | "sample";
type ApiPlaceInput = ApiPlace & {
  rankingScore?: number;
};

type Place = {
  id: string;
  name: string;
  category: Category;
  address: string;
  latitude: number;
  longitude: number;
  region: ApiPlace["region"];
  distance: string;
  status: string;
  signal: string;
  summary: string;
  crowd: string;
  parking: string;
  line: string;
  weather: string;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  updated: string;
  score: number;
  x: number;
  y: number;
  tone: StatusTone;
  visitors: string;
};

type Report = {
  id: string;
  placeId: string;
  title: string;
  body: string;
  meta: string;
  tone: StatusTone;
  verified: boolean;
  hasPhoto: boolean;
  photoUrl?: string | null;
  createdAt: string;
  hiddenAt: string | null;
  crowdLevel: CrowdLevel;
  lineStatus: LineStatus;
  parkingStatus: ParkingStatus;
  weatherFeel: WeatherFeel;
};

type Question = {
  id: string;
  placeId: string;
  body: string;
  reward: string;
  time: string;
  questionType: QuestionType;
  answeredReportId: string | null;
};

type PublicReport = {
  id: string;
  placeId: string;
  category: ReportCategory;
  crowdLevel: CrowdLevel;
  lineStatus: LineStatus;
  parkingStatus: ParkingStatus;
  weatherFeel?: WeatherFeel;
  comment?: string | null;
  photoUrl?: string | null;
  verifiedRadiusM: 50 | 150 | 300 | null;
  locationVerified?: boolean;
  createdAt: string;
  expiresAt: string;
  flagCount?: number;
  hiddenAt?: string | null;
};

type PublicQuestion = {
  id: string;
  placeId: string;
  questionType: QuestionType;
  body: string;
  creditCost: 1 | 2;
  answeredReportId: string | null;
  createdAt: string;
};

type MyQuestion = PublicQuestion & {
  status: "pending" | "answered" | "expired";
};

type PublicHashtag = {
  id: string;
  name: string;
  tagType: "place" | "status" | "purpose" | "time" | "region";
  postCount: number;
  createdAt: string;
};

type PublicPost = {
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
  previewUrl?: string | null;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  hashtags: PublicHashtag[];
  shareCard: ShareCard;
  judgement: "가도 좋음" | "주의" | "지금은 비추";
  safetyWarning: string | null;
  hiddenAt: string | null;
  createdAt: string;
};

type PostSubmitResult = {
  post: PublicPost;
  credits: { amount: number }[];
  recommendedHashtags?: string[];
  safetyWarning?: string | null;
  privacyNotice?: string;
};

type NaverLocalSearchResult = {
  title: string;
  category: string;
  roadAddress: string;
  address: string;
  mapx: string;
  mapy: string;
  link: string;
};

type NaverLocalSearchPayload = {
  items: NaverLocalSearchResult[];
  coordinateNote: string;
};

type WorkerPhoto = {
  id: string;
  placeId: string;
  previewUrl?: string | null;
  mimeType: "image/webp" | "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: "pending" | "ready" | "rejected";
  createdAt: string;
  ownedByCurrentSession?: boolean;
};

type PhotoUploadTicket = {
  uploadId: string;
  storageKey: string;
};

type PhotoCompleteResult = {
  photo: WorkerPhoto;
  storageKey: string;
};

type PhotoClickResult = {
  photoId: string;
  clickCount: number;
  created: boolean;
};

type PhotoDeleteResult = {
  photoId: string;
  deleted: boolean;
};

type WorkerComment = {
  id: string;
  placeId: string;
  body: string;
  likeCount: number;
  createdAt: string;
};

type MyMenuTarget = "reports" | "questions" | "saved" | "hashtags" | "badges" | "safety";
type FeedTab = (typeof feedTabLabels)[number];

type PlaceLikeResult = {
  placeId: string;
  likeCount: number;
  created?: boolean;
  deleted?: boolean;
};

type CommentLikeResult = {
  commentId: string;
  likeCount: number;
  created: boolean;
};

type PlaceClickResult = {
  placeId: string;
  clickCount: number;
  created: boolean;
};

type ModerationReportResult = {
  id: string;
  targetType: "place" | "post" | "comment" | "photo";
  targetId: string;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
};

type PendingModerationTarget = {
  targetType: "comment" | "photo";
  targetId: string;
  placeId: string;
  title: string;
  note: string;
};

type LocationVerificationStatus = "idle" | "requesting" | "verified" | "denied" | "unsupported";

type ClientLocation = {
  latitude: number;
  longitude: number;
};

type Challenge = {
  id: string;
  title: string;
  hashtagName: string;
  region: Place["region"];
  description: string;
  rewardBadge: string;
  startsAt: string;
  endsAt: string;
};

type QuickReportPreset = {
  id: string;
  label: string;
  description: string;
  patch: Partial<{
    pickedCrowd: string;
    pickedParking: string;
    pickedLine: string;
    pickedWeather: string;
    photoAttached: boolean;
    reportText: string;
  }>;
};

type PlaceTab = "실시간" | "사진" | "질문" | "해시태그" | "근처";

const presentationByPlaceId: Record<string, Pick<Place, "distance" | "x" | "y">> = {
  "ulsan-taehwagang": { distance: "1.2km", x: 31, y: 47 },
  "busan-gwangalli": { distance: "38km", x: 65, y: 39 },
  "gyeongju-hwangridan": { distance: "29km", x: 52, y: 62 },
  "ulsan-city-hall": { distance: "2.1km", x: 37, y: 74 },
};

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "홈", icon: Home },
  { id: "search", label: "검색", icon: Search },
  { id: "upload", label: "올리기", icon: Plus },
  { id: "map", label: "지도", icon: MapIcon },
  { id: "my", label: "마이", icon: User },
];

const filterLabels = ["전체", "사람 많음", "주차 만차", "줄 있음", "사진/상태 있음"];
const feedTabLabels = ["전체", "내 주변", "관광지", "주차"] as const;
const reportChips = ["사람 없음", "보통", "많음", "매우 많음"];
const parkingChips = ["널널", "여유 있음", "거의 없음", "만차"];
const lineChips = ["없음", "보통", "있음", "매우 김"];
const weatherChips = ["맑음", "흐림", "비", "실내"];
const questionExamples = ["주차 자리 있나요?", "줄 많이 긴가요?", "사진으로 볼 수 있나요?", "아이랑 가도 괜찮나요?"];
const quickReportPresets: QuickReportPreset[] = [
  {
    id: "parking-full",
    label: "주차 만차",
    description: "주차장이 거의 만차예요.",
    patch: { pickedParking: "만차", reportText: "주차장이 거의 만차예요.", photoAttached: false },
  },
  {
    id: "line-long",
    label: "줄 길어요",
    description: "대기줄이 꽤 길어요.",
    patch: { pickedLine: "매우 김", reportText: "대기줄이 꽤 길어요.", photoAttached: false },
  },
  {
    id: "quiet",
    label: "한산해요",
    description: "지금은 가기 좋아요.",
    patch: { pickedCrowd: "사람 없음", pickedParking: "여유 있음", pickedLine: "없음", reportText: "지금은 한산해서 가기 좋아요.", photoAttached: false },
  },
  {
    id: "crowd-busy",
    label: "사람 많아요",
    description: "현장이 꽤 붐벼요.",
    patch: { pickedCrowd: "많음", reportText: "지금 사람이 많아서 출발 전 확인이 필요해요.", photoAttached: false },
  },
    {
      id: "photo-spot",
      label: "사진스팟 상태",
      description: "사진 찍기 좋은 상태예요.",
      patch: { pickedCrowd: "보통", pickedWeather: "맑음", reportText: "사진 찍기 좋은 상태예요.", photoAttached: false },
    },
];
const postFlagReasonOptions: Array<{ id: FlagReason; label: string; body: string }> = [
  { id: "privacy_face", label: "얼굴이 보여요", body: "특정인을 알아볼 수 있는 얼굴이 포함됐습니다." },
  { id: "privacy_plate", label: "차량번호가 보여요", body: "차량번호나 식별 가능한 차량 정보가 포함됐습니다." },
  { id: "sensitive_info", label: "민감정보가 있어요", body: "서류, 병원, 관공서, 어린이 등 민감한 정보가 포함됐습니다." },
  { id: "false_content", label: "허위 정보예요", body: "현장 상황과 다른 제보로 보입니다." },
  { id: "spam", label: "광고/스팸이에요", body: "홍보, 도배, 낚시성 게시물입니다." },
  { id: "other", label: "기타", body: "다른 이유로 운영자 확인이 필요합니다." },
];
const persistedSetKeys = {
  followedPlaceIds: "silsigan.followedPlaceIds.v1",
  followedHashtagNames: "silsigan.followedHashtagNames.v1",
  helpfulPostIds: "silsigan.helpfulPostIds.v1",
  savedPostIds: "silsigan.savedPostIds.v1",
} as const;
const notificationEnabledKey = "silsigan.notificationEnabled.v1";
const firstVisitSeenKey = "silsigan.firstVisitSeen.v1";
const initialDataFetchTimeoutMs = 6_000;
const workerPhotoPlaceScopeLimit = 20;
const workerPhotoLimitPerPlace = 12;
const challenges: Challenge[] = [
  {
    id: "gwangalli-parking-help",
    title: "광안리 주차 살려줘",
    hashtagName: "광안리주차살려줘",
    region: "busan",
    description: "광안리 근처 주차 상황만 알려줘도 출발 전 판단에 큰 도움이 됩니다.",
    rewardBadge: "부산 주차 도우미",
    startsAt: "2026-05-27",
    endsAt: "2026-06-02",
  },
  {
    id: "hwangridan-waiting",
    title: "황리단길 웨이팅 지금컷",
    hashtagName: "황리단길웨이팅",
    region: "gyeongju",
    description: "카페와 골목 대기 상황을 사진이나 한 줄 상태로 알려주세요.",
    rewardBadge: "경주 웨이팅 답변왕",
    startsAt: "2026-05-27",
    endsAt: "2026-06-02",
  },
  {
    id: "taehwagang-walk",
    title: "오늘의 태화강 산책",
    hashtagName: "태화강산책",
    region: "ulsan",
    description: "산책로 혼잡도, 주차 여유, 노을 상태를 공유해 주세요.",
    rewardBadge: "태화강 지금컷",
    startsAt: "2026-05-27",
    endsAt: "2026-06-02",
  },
];
const fieldQuests: FieldQuest[] = [
  {
    id: "quest-gwangalli-parking",
    placeId: "busan-gwangalli",
    questionType: "parking",
    prompt: "지금 광안리 주차 자리 있나요?",
    rewardCredits: 1,
    expiresAt: "2026-06-02T23:59:59.000Z",
  },
  {
    id: "quest-hwangridan-line",
    placeId: "gyeongju-hwangridan",
    questionType: "line",
    prompt: "황리단길 메인 골목 줄이 긴가요?",
    rewardCredits: 1,
    expiresAt: "2026-06-02T23:59:59.000Z",
  },
  {
    id: "quest-taehwagang-photo",
    placeId: "ulsan-taehwagang",
    questionType: "photo_request",
    prompt: "태화강 산책로 지금 사진으로 볼 수 있나요?",
    rewardCredits: 2,
    expiresAt: "2026-06-02T23:59:59.000Z",
  },
  {
    id: "quest-cityhall-crowd",
    placeId: "ulsan-city-hall",
    questionType: "crowd",
    prompt: "울산시청 민원실 주변 대기가 긴가요?",
    rewardCredits: 1,
    expiresAt: "2026-06-02T23:59:59.000Z",
  },
];

type LiveDataset = {
  apiPlaces: ApiPlaceInput[];
  apiReports: PublicReport[];
  apiPosts: PublicPost[];
  apiHashtags: PublicHashtag[];
  apiQuestions: PublicQuestion[];
  apiMyQuestions: MyQuestion[];
};

function createInitialFallbackDataset(): LiveDataset {
  const now = Date.now();
  const timestamp = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const expiresAt = new Date(now + 3 * 60 * 60_000).toISOString();
  const apiPlaces: ApiPlaceInput[] = [
    {
      id: "busan-gwangalli",
      name: "광안리해수욕장",
      address: "부산 수영구 광안해변로",
      category: "tourism",
      latitude: 35.1532,
      longitude: 129.1186,
      region: "busan",
      regionId: "busan",
      launchStage: "beta",
      rankingScore: 92,
    },
    {
      id: "gyeongju-hwangridan",
      name: "황리단길",
      address: "경북 경주시 포석로",
      category: "restaurant_cafe",
      latitude: 35.8381,
      longitude: 129.2107,
      region: "gyeongju",
      regionId: "gyeongju",
      launchStage: "beta",
      rankingScore: 84,
    },
    {
      id: "ulsan-taehwagang",
      name: "태화강 국가정원",
      address: "울산 중구 태화강국가정원길",
      category: "tourism",
      latitude: 35.5481,
      longitude: 129.2985,
      region: "ulsan",
      regionId: "ulsan",
      launchStage: "beta",
      rankingScore: 78,
    },
    {
      id: "ulsan-city-hall",
      name: "울산광역시청",
      address: "울산 남구 중앙로",
      category: "public_office",
      latitude: 35.5384,
      longitude: 129.3114,
      region: "ulsan",
      regionId: "ulsan",
      launchStage: "seed",
      rankingScore: 51,
    },
  ];
  const apiHashtags: PublicHashtag[] = [
    { id: "hashtag_주차만차", name: "주차만차", tagType: "status", postCount: 12, createdAt: timestamp(12) },
    { id: "hashtag_노을좋음", name: "노을좋음", tagType: "time", postCount: 10, createdAt: timestamp(18) },
    { id: "hashtag_웨이팅", name: "웨이팅", tagType: "status", postCount: 8, createdAt: timestamp(24) },
    { id: "hashtag_사진스팟", name: "사진스팟", tagType: "purpose", postCount: 7, createdAt: timestamp(31) },
    { id: "hashtag_한산함", name: "한산함", tagType: "status", postCount: 5, createdAt: timestamp(35) },
  ];
  const hashtag = (name: string) => apiHashtags.find((tag) => tag.name === name) ?? apiHashtags[0];
  const apiReports: PublicReport[] = [
    {
      id: "fallback_report_gwangalli",
      placeId: "busan-gwangalli",
      category: "tourism",
      crowdLevel: "packed",
      lineStatus: "medium",
      parkingStatus: "full",
      weatherFeel: "good",
      comment: "공영주차장 입구부터 막혀요. 민락 쪽이 그나마 나아요.",
      photoUrl: "/silsigan/fallback/gwangalli.png",
      verifiedRadiusM: 150,
      locationVerified: true,
      createdAt: timestamp(12),
      expiresAt,
      flagCount: 0,
      hiddenAt: null,
    },
    {
      id: "fallback_report_hwangridan",
      placeId: "gyeongju-hwangridan",
      category: "restaurant_cafe",
      crowdLevel: "busy",
      lineStatus: "long",
      parkingStatus: "limited",
      weatherFeel: "good",
      comment: "메인 골목 카페 줄이 길어요. 사진 찍기는 괜찮습니다.",
      photoUrl: "/silsigan/fallback/hwangridan.png",
      verifiedRadiusM: 150,
      locationVerified: true,
      createdAt: timestamp(28),
      expiresAt,
      flagCount: 0,
      hiddenAt: null,
    },
    {
      id: "fallback_report_taehwagang",
      placeId: "ulsan-taehwagang",
      category: "tourism",
      crowdLevel: "normal",
      lineStatus: "none",
      parkingStatus: "available",
      weatherFeel: "good",
      comment: "산책로는 여유 있고 노을 보기 좋아요.",
      photoUrl: "/silsigan/fallback/taehwagang.png",
      verifiedRadiusM: 300,
      locationVerified: true,
      createdAt: timestamp(37),
      expiresAt,
      flagCount: 0,
      hiddenAt: null,
    },
  ];
  const apiPosts: PublicPost[] = [
    {
      id: "fallback_post_gwangalli",
      userId: "fallback-user",
      creatorName: "부산 현장러",
      creatorBadge: "광안리 주차 도우미",
      placeId: "busan-gwangalli",
      caption: "공영주차장 입구부터 막혀요. 민락 쪽이 그나마 나아요.",
      crowdLevel: "packed",
      parkingStatus: "full",
      lineStatus: "medium",
      weatherFeel: "good",
      locationVerified: true,
      verifiedRadiusM: 150,
      photoCount: 1,
      photoLabel: "광안리 방금 사진",
      previewUrl: "/silsigan/fallback/gwangalli.png",
      helpfulCount: 24,
      commentCount: 6,
      hashtagNames: ["주차만차", "노을좋음", "사람많음"],
      hashtags: [hashtag("주차만차"), hashtag("노을좋음")],
      shareCard: {
        headline: "광안리 주차 만차래요",
        body: "방금 올라온 사진 기준, 공영주차장 입구부터 막힙니다.",
        url: "/share/post/fallback_post_gwangalli",
        hashtags: ["주차만차", "노을좋음"],
        variant: "parking_full",
      },
      judgement: "지금은 비추",
      safetyWarning: null,
      hiddenAt: null,
      createdAt: timestamp(12),
    },
    {
      id: "fallback_post_hwangridan",
      userId: "fallback-user",
      creatorName: "경주 골목러",
      creatorBadge: "웨이팅 답변왕",
      placeId: "gyeongju-hwangridan",
      caption: "메인 골목 카페 줄이 길어요. 사진 찍기는 괜찮습니다.",
      crowdLevel: "busy",
      parkingStatus: "limited",
      lineStatus: "long",
      weatherFeel: "good",
      locationVerified: true,
      verifiedRadiusM: 150,
      photoCount: 1,
      photoLabel: "황리단길 현장 사진",
      previewUrl: "/silsigan/fallback/hwangridan.png",
      helpfulCount: 18,
      commentCount: 4,
      hashtagNames: ["웨이팅", "사진스팟"],
      hashtags: [hashtag("웨이팅"), hashtag("사진스팟")],
      shareCard: {
        headline: "황리단길 웨이팅 많음",
        body: "메인 골목 카페 줄이 길고, 사진스팟은 아직 괜찮아요.",
        url: "/share/post/fallback_post_hwangridan",
        hashtags: ["웨이팅", "사진스팟"],
        variant: "waiting",
      },
      judgement: "주의",
      safetyWarning: null,
      hiddenAt: null,
      createdAt: timestamp(28),
    },
    {
      id: "fallback_post_taehwagang",
      userId: "fallback-user",
      creatorName: "울산 산책러",
      creatorBadge: "태화강 제보왕",
      placeId: "ulsan-taehwagang",
      caption: "산책로는 여유 있고 노을 보기 좋아요.",
      crowdLevel: "normal",
      parkingStatus: "available",
      lineStatus: "none",
      weatherFeel: "good",
      locationVerified: true,
      verifiedRadiusM: 300,
      photoCount: 1,
      photoLabel: "태화강 노을 사진",
      previewUrl: "/silsigan/fallback/taehwagang.png",
      helpfulCount: 15,
      commentCount: 3,
      hashtagNames: ["한산함", "사진스팟"],
      hashtags: [hashtag("한산함"), hashtag("사진스팟")],
      shareCard: {
        headline: "태화강 지금 한산함",
        body: "산책로가 여유 있고 노을 보기 좋은 상태입니다.",
        url: "/share/post/fallback_post_taehwagang",
        hashtags: ["한산함", "사진스팟"],
        variant: "good",
      },
      judgement: "가도 좋음",
      safetyWarning: null,
      hiddenAt: null,
      createdAt: timestamp(37),
    },
  ];
  const apiQuestions: PublicQuestion[] = [
    {
      id: "fallback_question_gwangalli",
      placeId: "busan-gwangalli",
      questionType: "parking",
      body: "지금 광안리 공영주차장 자리 있나요?",
      creditCost: 1,
      answeredReportId: null,
      createdAt: timestamp(9),
    },
    {
      id: "fallback_question_taehwagang",
      placeId: "ulsan-taehwagang",
      questionType: "photo_request",
      body: "태화강 노을 사진으로 볼 수 있나요?",
      creditCost: 2,
      answeredReportId: null,
      createdAt: timestamp(17),
    },
  ];

  return {
    apiPlaces,
    apiReports,
    apiPosts,
    apiHashtags,
    apiQuestions,
    apiMyQuestions: [],
  };
}

async function fetchJsonWithTimeout<T>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = initialDataFetchTimeoutMs): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort();

  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetchJson<T>(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("실시간 API 응답이 늦습니다.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export default function SilsiganRedesign() {
  const [activeView, setActiveView] = useState<View>("home");
  const phoneBodyRef = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [allPosts, setAllPosts] = useState<PublicPost[]>([]);
  const [workerPhotos, setWorkerPhotos] = useState<WorkerPhoto[]>([]);
  const [workerCommentsByPlaceId, setWorkerCommentsByPlaceId] = useState<Record<string, PlaceComment[]>>({});
  const [hashtags, setHashtags] = useState<PublicHashtag[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [myQuestions, setMyQuestions] = useState<MyQuestion[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [activeFilter, setActiveFilter] = useState(filterLabels[0]);
  const [reportText, setReportText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [toast, setToast] = useState("출발 전, 방금 올라온 사진으로 지금 분위기를 확인하세요.");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickedCrowd, setPickedCrowd] = useState("많음");
  const [pickedParking, setPickedParking] = useState("거의 없음");
  const [pickedLine, setPickedLine] = useState("있음");
  const [pickedWeather, setPickedWeather] = useState("맑음");
  const [photoAttached, setPhotoAttached] = useState(false);
  const [locationVerificationStatus, setLocationVerificationStatus] = useState<LocationVerificationStatus>("idle");
  const [verifiedLocation, setVerifiedLocation] = useState<ClientLocation | null>(null);
  const [selectedHashtagName, setSelectedHashtagName] = useState<string | null>(null);
  const [followedPlaceIds, setFollowedPlaceIds] = useState<Set<string>>(() => new Set());
  const [followedHashtagNames, setFollowedHashtagNames] = useState<Set<string>>(() => new Set());
  const [helpfulPostIds, setHelpfulPostIds] = useState<Set<string>>(() => new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenCreatorNames, setHiddenCreatorNames] = useState<Set<string>>(() => new Set());
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pendingFlagPost, setPendingFlagPost] = useState<PublicPost | null>(null);
  const [pendingModerationTarget, setPendingModerationTarget] = useState<PendingModerationTarget | null>(null);
  const [activeRegion, setActiveRegion] = useState<RegionTabId>("nationwide");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapRequerying, setMapRequerying] = useState(false);
  const mapBoundsRef = useRef<MapBounds | null>(null);
  const lastMapBoundsFetchKeyRef = useRef("");
  const previousMapSearchQueryRef = useRef("");
  const hasLoadedLiveDataRef = useRef(false);
  const [mapPreviewPlaceId, setMapPreviewPlaceId] = useState("");
  const [mapLocationPermission, setMapLocationPermission] = useState<LocationPermissionState>("idle");
  const [mapCurrentLocation, setMapCurrentLocation] = useState<UiLocation | null>(null);
  const [likedPlaceIds, setLikedPlaceIds] = useState<Set<string>>(() => new Set());
  const [liveConnection, setLiveConnection] = useState<"connecting" | "live" | "polling">("polling");
  const [realtimeEventsByPlaceId, setRealtimeEventsByPlaceId] = useState<Record<string, CloudflareRealtimeEvent[]>>({});
  const [dataMode, setDataMode] = useState<DataMode>("live");
  const cloudflareApiConfigured = useMemo(() => isCloudflareApiConfigured(), []);
  const activeDataRegionId = useMemo(() => normalizeRegionScope(activeRegion), [activeRegion]);
  const mapBoundsKey = mapBounds ? mapBoundsToBboxParam(mapBounds) : "";
  const normalizedMapSearchQuery = useMemo(() => normalizePlaceSearchQuery(mapSearchQuery) ?? "", [mapSearchQuery]);

  const rankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        posts
          .filter((post) => !hiddenCreatorNames.has(post.creatorName))
          .map((post) => ({
            ...post,
            helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
          })),
      ),
    [helpfulPostIds, hiddenCreatorNames, posts],
  );

  const allRankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        allPosts
          .filter((post) => !hiddenCreatorNames.has(post.creatorName))
          .map((post) => ({
            ...post,
            helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
          })),
      ),
    [allPosts, helpfulPostIds, hiddenCreatorNames],
  );

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? places[0] ?? null,
    [places, selectedPlaceId],
  );

  const mapPreviewPlace = useMemo(
    () => places.find((place) => place.id === mapPreviewPlaceId) ?? null,
    [mapPreviewPlaceId, places],
  );
  const realtimePlaceId = mapPreviewPlaceId || (activeView === "place" ? selectedPlace?.id ?? "" : "");

  const selectedReports = useMemo(
    () => reports.filter((report) => report.placeId === selectedPlace?.id),
    [reports, selectedPlace?.id],
  );

  const selectedPosts = useMemo(
    () => rankedPosts.filter((post) => post.placeId === selectedPlace?.id),
    [rankedPosts, selectedPlace?.id],
  );

  const userReputation = useMemo<UserReputation>(() => {
    const verifiedReports = allRankedPosts.filter((post) => post.locationVerified).length;
    const helpfulReceived = allRankedPosts.reduce((sum, post) => sum + post.helpfulCount, 0);
    const trustScore = calculateTrustScore({
      verifiedReports,
      helpfulReceived,
      falseReports: 0,
      privacyViolations: 0,
    });

    return {
      userId: "demo-user",
      trustScore,
      verifiedReportCount: verifiedReports,
      helpfulReceivedCount: helpfulReceived,
      falseReportCount: 0,
      privacyViolationCount: 0,
    };
  }, [allRankedPosts]);

  const recommendedTags = useMemo(() => {
    if (!selectedPlace) {
      return [];
    }

    const baseTags = recommendHashtags({
      place: selectedPlace,
      crowdLevel: crowdValueFromLabel(pickedCrowd),
      parkingStatus: parkingValueFromLabel(pickedParking),
      lineStatus: lineValueFromLabel(pickedLine),
      weatherFeel: weatherValueFromLabel(pickedWeather),
    });
    const challengeTag = selectedHashtagName && challenges.some((challenge) => challenge.hashtagName === selectedHashtagName)
      ? selectedHashtagName
      : null;

    return challengeTag ? [challengeTag, ...baseTags.filter((tag) => tag !== challengeTag)].slice(0, 5) : baseTags;
  }, [pickedCrowd, pickedLine, pickedParking, pickedWeather, selectedHashtagName, selectedPlace]);

  const loadData = useCallback(async (options: { silent?: boolean; bounds?: MapBounds | null; query?: string | null } = {}) => {
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const listScope = { regionId: activeDataRegionId, limit: 100 };
      const placesScope = {
        ...listScope,
        bbox: options.bounds ? mapBoundsToBboxParam(options.bounds) : undefined,
        q: normalizePlaceSearchQuery(options.query),
      };
      const placesRequest: Promise<ApiPlaceInput[]> = cloudflareApiConfigured
        ? fetchJsonWithTimeout<WorkerPlace[]>(cloudflareApiUrl(buildScopedApiPath("/api/places", placesScope))).then(workerPlacesToAppPlaces)
        : fetchJsonWithTimeout<ApiPlace[]>(buildScopedApiPath("/api/places", placesScope));
      const reportsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicReport[]>(cloudflareApiUrl(buildScopedApiPath("/api/reports", listScope)))
        : fetchJsonWithTimeout<PublicReport[]>(buildScopedApiPath("/api/reports", listScope));
      const postsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicPost[]>(cloudflareApiUrl(buildScopedApiPath("/api/posts", listScope)))
        : fetchJsonWithTimeout<PublicPost[]>(buildScopedApiPath("/api/posts", listScope));
      const hashtagsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicHashtag[]>(cloudflareApiUrl("/api/hashtags"))
        : fetchJsonWithTimeout<PublicHashtag[]>("/api/hashtags");
      const questionsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicQuestion[]>(cloudflareApiUrl(buildScopedApiPath("/api/questions", listScope)))
        : fetchJsonWithTimeout<PublicQuestion[]>(buildScopedApiPath("/api/questions", listScope));
      const myQuestionsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<MyQuestion[]>(cloudflareApiUrl("/api/my-questions")).catch(() => [])
        : fetchJsonWithTimeout<MyQuestion[]>("/api/my-questions").catch(() => []);
      const [apiPlaces, apiReports, apiPosts, apiHashtags, apiQuestions, apiMyQuestions] = await Promise.all([
        placesRequest,
        reportsRequest,
        postsRequest,
        hashtagsRequest,
        questionsRequest,
        myQuestionsRequest,
      ]);
      const mappedReports = mapReports(apiReports, apiPlaces);
      const mappedQuestions = mapQuestions(apiQuestions);
      const mappedPlaces = mapPlaces(apiPlaces, mappedReports, mappedQuestions);
      const scopedPlaceIds = mappedPlaces.map((place) => place.id);
      const apiWorkerPhotos = cloudflareApiConfigured ? await fetchWorkerPhotosForPlaces(scopedPlaceIds) : [];

      setPlaces(mappedPlaces);
      setReports(mappedReports);
      setPosts(apiPosts);
      setAllPosts(apiPosts);
      setWorkerPhotos((current) => mergeWorkerPhotos(apiWorkerPhotos, filterWorkerPhotosByPlaceIds(current, scopedPlaceIds)).slice(0, 80));
      setHashtags(apiHashtags);
      setQuestions(mappedQuestions);
      setMyQuestions(apiMyQuestions);
      setSelectedPlaceId((current) => mappedPlaces.find((place) => place.id === current)?.id ?? mappedPlaces[0]?.id ?? "");
      hasLoadedLiveDataRef.current = true;
      setDataMode("live");
    } catch (error) {
      if (!options.silent) {
        if (!hasLoadedLiveDataRef.current) {
          const fallback = createInitialFallbackDataset();
          const mappedReports = mapReports(fallback.apiReports, fallback.apiPlaces);
          const mappedQuestions = mapQuestions(fallback.apiQuestions);
          const mappedPlaces = mapPlaces(fallback.apiPlaces, mappedReports, mappedQuestions);

          setPlaces(mappedPlaces);
          setReports(mappedReports);
          setPosts(fallback.apiPosts);
          setAllPosts(fallback.apiPosts);
          setWorkerPhotos([]);
          setHashtags(fallback.apiHashtags);
          setQuestions(mappedQuestions);
          setMyQuestions(fallback.apiMyQuestions);
          setSelectedPlaceId((current) => mappedPlaces.find((place) => place.id === current)?.id ?? mappedPlaces[0]?.id ?? "");
          setDataMode("sample");
          setToast("실시간 API 응답이 늦어 샘플 미리보기로 전환했습니다. 실제 데이터가 연결되면 자동으로 바뀝니다.");
          return;
        }

        setToast(error instanceof Error ? error.message : "실시간 데이터를 불러오지 못했습니다.");
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [activeDataRegionId, cloudflareApiConfigured]);

  useEffect(() => {
    if (phoneBodyRef.current) {
      phoneBodyRef.current.scrollTop = 0;
    }
  }, [activeView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData({
        silent: true,
        bounds: activeView === "map" ? mapBoundsRef.current : null,
        query: activeView === "map" ? normalizedMapSearchQuery : null,
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [activeView, loadData, normalizedMapSearchQuery]);

  const requeryCurrentMap = useCallback(async () => {
    if (mapRequerying) {
      return;
    }

    setMapRequerying(true);
    try {
      lastMapBoundsFetchKeyRef.current = "";
      await loadData({ silent: true, bounds: mapBoundsRef.current, query: normalizedMapSearchQuery });
      setToast(mapBoundsRef.current ? "현재 지도 화면 기준으로 다시 불러왔습니다." : "현재 검색어 기준으로 장소를 다시 불러왔습니다.");
    } finally {
      setMapRequerying(false);
    }
  }, [loadData, mapRequerying, normalizedMapSearchQuery]);

  useEffect(() => {
    mapBoundsRef.current = mapBounds;
  }, [mapBounds]);

  useEffect(() => {
    if (activeView !== "map" || !mapBounds || !mapBoundsKey) {
      return;
    }

    const fetchKey = `${activeDataRegionId ?? "nationwide"}:${mapBoundsKey}:${normalizedMapSearchQuery}`;
    if (lastMapBoundsFetchKeyRef.current === fetchKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      lastMapBoundsFetchKeyRef.current = fetchKey;
      void loadData({ silent: true, bounds: mapBounds, query: normalizedMapSearchQuery });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activeDataRegionId, activeView, loadData, mapBounds, mapBoundsKey, normalizedMapSearchQuery]);

  useEffect(() => {
    if (activeView !== "map") {
      return;
    }

    if (previousMapSearchQueryRef.current === normalizedMapSearchQuery) {
      return;
    }

    previousMapSearchQueryRef.current = normalizedMapSearchQuery;
    lastMapBoundsFetchKeyRef.current = "";
    if (mapBoundsRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadData({ silent: true, bounds: mapBoundsRef.current, query: normalizedMapSearchQuery });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activeView, loadData, normalizedMapSearchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFollowedPlaceIds(readPersistedSet(persistedSetKeys.followedPlaceIds));
      setFollowedHashtagNames(readPersistedSet(persistedSetKeys.followedHashtagNames));
      setHelpfulPostIds(readPersistedSet(persistedSetKeys.helpfulPostIds));
      setSavedPostIds(readPersistedSet(persistedSetKeys.savedPostIds));
      setNotificationEnabled(window.localStorage.getItem(notificationEnabledKey) === "true");
      setShowOnboarding(window.localStorage.getItem(firstVisitSeenKey) !== "true");
      setPersistenceReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;

    persistSet(persistedSetKeys.followedPlaceIds, followedPlaceIds);
  }, [followedPlaceIds, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) return;

    persistSet(persistedSetKeys.followedHashtagNames, followedHashtagNames);
  }, [followedHashtagNames, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) return;

    persistSet(persistedSetKeys.helpfulPostIds, helpfulPostIds);
  }, [helpfulPostIds, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) return;

    persistSet(persistedSetKeys.savedPostIds, savedPostIds);
  }, [persistenceReady, savedPostIds]);

  useEffect(() => {
    if (!persistenceReady) return;

    window.localStorage.setItem(notificationEnabledKey, notificationEnabled ? "true" : "false");
  }, [notificationEnabled, persistenceReady]);

  useEffect(() => {
    if (activeView === "home") {
      trackEvent("view_home");
    }

    if (activeView === "place" && selectedPlace) {
      trackEvent("view_place", { placeId: selectedPlace.id });
    }
  }, [activeView, selectedPlace]);

  useEffect(() => {
    if (!cloudflareApiConfigured || !realtimePlaceId) {
      return;
    }

    let active = true;
    let loadedOnce = false;
    const loadRealtimeRoom = async () => {
      if (!loadedOnce) {
        setLiveConnection("connecting");
      }

      try {
        const room = await fetchJson<CloudflareRealtimeRoom>(cloudflareApiUrl(`/api/realtime/place/${encodeURIComponent(realtimePlaceId)}`));
        if (!active) {
          return;
        }

        loadedOnce = true;
        setRealtimeEventsByPlaceId((current) => ({
          ...current,
          [realtimePlaceId]: room.events,
        }));
        setLiveConnection(room.mode === "polling" ? "polling" : "live");
      } catch {
        if (active) {
          loadedOnce = true;
          setLiveConnection("polling");
        }
      }
    };
    const intervalId = window.setInterval(() => void loadRealtimeRoom(), 10_000);

    void loadRealtimeRoom();

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [cloudflareApiConfigured, realtimePlaceId]);

  const openPlace = (place: Place) => {
    setLocationVerificationStatus("idle");
    setVerifiedLocation(null);
    setToast(`${place.name} 현장 정보를 확인합니다. 현장 인증은 작성 화면에서 다시 선택해 주세요.`);
    setSelectedPlaceId(place.id);
    setActiveView("place");
    void recordPlaceClick(place, "detail");
  };

  const startReportForPlace = (place: Place) => {
    setLocationVerificationStatus("idle");
    setVerifiedLocation(null);
    setSelectedPlaceId(place.id);
    setActiveView("upload");
    setToast(`${place.name} 지금 상태를 올립니다. 위치 인증은 선택 사항입니다.`);
  };

  const previewMapPlace = (place: Place, source: "map_marker" | "ranking" = "map_marker") => {
    setSelectedPlaceId(place.id);
    setMapPreviewPlaceId(place.id);
    if (source === "map_marker") {
      trackEvent("click_map_marker", { placeId: place.id });
    }
    void recordPlaceClick(place, source);
  };

  const closeMapPreview = () => {
    setMapPreviewPlaceId("");
  };

  const changeActiveRegion = (region: RegionTabId) => {
    lastMapBoundsFetchKeyRef.current = "";
    setMapBounds(null);
    setMapPreviewPlaceId("");
    setActiveRegion(region);
  };

  const updateMapBounds = (bounds: MapBounds) => {
    setMapBounds((current) => (areMapBoundsEquivalent(current, bounds) ? current : bounds));
  };

  const recordPlaceClick = async (place: Place, source: "detail" | "map_marker" | "ranking") => {
    trackEvent("click_place", { placeId: place.id, source });

    if (!cloudflareApiConfigured) {
      return;
    }

    try {
      await fetchJson<PlaceClickResult>(cloudflareApiUrl(`/api/places/${encodeURIComponent(place.id)}/click`), {
        method: "POST",
        body: JSON.stringify({ source }),
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "장소 클릭 기록에 실패했습니다.");
    }
  };

  const togglePlaceLike = async (place: Place) => {
    const wasLiked = likedPlaceIds.has(place.id);
    setLikedPlaceIds((current) => toggleSetValue(current, place.id));
    trackEvent("like_place", { placeId: place.id, liked: !wasLiked });
    setToast(wasLiked ? `${place.name} 좋아요를 해제했습니다.` : `${place.name} 좋아요가 반영됐습니다.`);

    if (!cloudflareApiConfigured) {
      if (!wasLiked) {
        appendRealtimeEvent(place.id, "place.liked", new Date().toISOString(), { placeId: place.id, source: "local-preview" });
      }
      return;
    }

    try {
      const result = await fetchJson<PlaceLikeResult>(cloudflareApiUrl(`/api/places/${encodeURIComponent(place.id)}/like`), {
        method: wasLiked ? "DELETE" : "POST",
      });
      if (!wasLiked && result.created) {
        appendRealtimeEvent(place.id, "place.liked", new Date().toISOString(), { placeId: place.id, likeCount: result.likeCount });
      }
      setToast(wasLiked ? `${place.name} 좋아요 해제 완료 · 누적 ${result.likeCount}` : `${place.name} 좋아요 반영 완료 · 누적 ${result.likeCount}`);
    } catch (error) {
      setLikedPlaceIds((current) => toggleSetValue(current, place.id));
      setToast(error instanceof Error ? error.message : "좋아요 반영에 실패했습니다.");
    }
  };

  const reportMapPlace = async (place: Place) => {
    trackEvent("report_abuse", { targetType: "place", targetId: place.id, reason: "other" });

    if (!cloudflareApiConfigured) {
      appendRealtimeEvent(place.id, "report.created", new Date().toISOString(), { placeId: place.id, targetType: "place", source: "local-preview" });
      setToast(`${place.name} 신고가 접수 대기 상태로 기록됐습니다. 운영자 검토 항목에 연결할 수 있습니다.`);
      return;
    }

    try {
      const report = await fetchJson<ModerationReportResult>(cloudflareApiUrl("/api/moderation/reports"), {
        method: "POST",
        body: JSON.stringify({
          targetType: "place",
          targetId: place.id,
          reason: "other",
          note: "지도 상세에서 접수된 장소 신고",
        }),
      });
      appendRealtimeEvent(place.id, "report.created", report.createdAt, { id: report.id, placeId: place.id, targetType: report.targetType });
      setToast(`${place.name} 신고가 운영 검토 큐에 접수됐습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "장소 신고 접수에 실패했습니다.");
    }
  };

  const openCommentReport = (place: Place, comment: PlaceComment) => {
    if (!comment.workerCommentId) {
      return;
    }

    setPendingModerationTarget({
      targetType: "comment",
      targetId: comment.workerCommentId,
      placeId: place.id,
      title: `${place.name} 댓글 신고`,
      note: `댓글 신고: ${comment.body.slice(0, 80)}`,
    });
  };

  const openPhotoReport = (place: Place, photo: PlacePhoto) => {
    if (!photo.workerPhotoId) {
      return;
    }

    setPendingModerationTarget({
      targetType: "photo",
      targetId: photo.workerPhotoId,
      placeId: place.id,
      title: `${place.name} 사진 신고`,
      note: `사진 신고: ${photo.label}`,
    });
  };

  const reportModerationTarget = async (target: PendingModerationTarget, reason: FlagReason) => {
    trackEvent("report_abuse", { targetType: target.targetType, targetId: target.targetId, reason });

    if (!cloudflareApiConfigured) {
      appendRealtimeEvent(target.placeId, "report.created", new Date().toISOString(), {
        placeId: target.placeId,
        targetType: target.targetType,
        targetId: target.targetId,
        source: "local-preview",
      });
      setToast("운영 연결이 준비되면 검토 큐에 접수됩니다.");
      setPendingModerationTarget(null);
      return;
    }

    try {
      const report = await fetchJson<ModerationReportResult>(cloudflareApiUrl("/api/moderation/reports"), {
        method: "POST",
        body: JSON.stringify({
          targetType: target.targetType,
          targetId: target.targetId,
          reason,
          note: target.note,
        }),
      });
      appendRealtimeEvent(target.placeId, "report.created", report.createdAt, {
        id: report.id,
        placeId: target.placeId,
        targetType: report.targetType,
        targetId: report.targetId,
      });
      setToast(`${target.title}가 운영 검토 큐에 접수됐습니다.`);
      setPendingModerationTarget(null);
      await loadData({ silent: true });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "신고 접수에 실패했습니다.");
    }
  };

  const requestFieldVerification = () => {
    trackEvent("request_location", { placeId: selectedPlace?.id ?? null });
    if (!navigator.geolocation) {
      setVerifiedLocation(null);
      setLocationVerificationStatus("unsupported");
      setToast("이 브라우저에서는 위치 인증을 사용할 수 없어 상태 제보로 등록됩니다.");
      return;
    }

    setLocationVerificationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setVerifiedLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationVerificationStatus("verified");
        setToast("실제 GPS 좌표를 확인했습니다. 등록 시 서버에서 장소 반경만 검증합니다.");
      },
      () => {
        setVerifiedLocation(null);
        setLocationVerificationStatus("denied");
        trackEvent("location_denied", { placeId: selectedPlace?.id ?? null });
        setToast("위치 권한 없이 상태 제보로 등록됩니다. 현장 인증 배지는 붙지 않습니다.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 8_000,
      },
    );
  };

  const submitReport = async () => {
    if (!selectedPlace || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        placeId: selectedPlace.id,
        crowdLevel: crowdValueFromLabel(pickedCrowd),
        lineStatus: lineValueFromLabel(pickedLine),
        parkingStatus: parkingValueFromLabel(pickedParking),
        weatherFeel: weatherValueFromLabel(pickedWeather),
        caption: reportText.trim() || undefined,
        photoCount: photoAttached ? 1 : 0,
        hashtagNames: recommendedTags,
        ...(verifiedLocation ? { clientLocation: verifiedLocation } : {}),
      };

      const result = await fetchJson<PostSubmitResult>(cloudflareApiConfigured ? cloudflareApiUrl("/api/posts") : "/api/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const earned = result.credits.reduce((sum, event) => sum + Math.max(event.amount, 0), 0);
      const badge = result.post.locationVerified ? "현장 인증" : result.post.photoCount > 0 ? "지금컷" : "상태 제보";
      const photoNotice = result.post.photoCount > 0 ? "사진과 상태가 함께 등록됐습니다." : "상태가 먼저 등록됐습니다.";
      const safetyNotice = result.safetyWarning ? ` · ${result.safetyWarning}` : "";
      trackEvent("submit_post", {
        placeId: selectedPlace.id,
        locationVerified: result.post.locationVerified,
        photoCount: result.post.photoCount,
      });
      setToast(`${badge} 완료! ${photoNotice} 질문권 +${earned}${safetyNotice}`);
      setReportText("");
      setPhotoAttached(false);
      setLocationVerificationStatus("idle");
      setVerifiedLocation(null);
      setActiveView("place");
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "제보 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadPlacePhoto = async (place: Place, photo: PreparedPhotoUpload) => {
    try {
      if (!cloudflareApiConfigured) {
        throw new Error("사진 서버 설정 후 사용할 수 있습니다.");
      }

      const ticket = await fetchJson<PhotoUploadTicket>(cloudflareApiUrl("/api/photos/upload-url"), {
        method: "POST",
        body: JSON.stringify({
          placeId: place.id,
          mimeType: photo.mimeType,
        }),
      });
      const result = await fetchJson<PhotoCompleteResult>(cloudflareApiUrl("/api/photos/complete"), {
        method: "POST",
        body: JSON.stringify({
          uploadId: ticket.uploadId,
          placeId: place.id,
          byteSize: photo.byteSize,
          mimeType: photo.mimeType,
          width: photo.width,
          height: photo.height,
          clientReencoded: true,
          imageBase64: photo.base64,
        }),
      });

      setWorkerPhotos((current) => mergeWorkerPhotos([{ ...result.photo, ownedByCurrentSession: true }], current).slice(0, 80));
      setPhotoAttached(true);
      appendRealtimeEvent(place.id, "photo.ready", result.photo.createdAt, { id: result.photo.id, placeId: place.id });
      trackEvent("upload_photo", { placeId: place.id, mimeType: photo.mimeType, byteSize: photo.byteSize });
      setToast(`${place.name} 지금 사진이 등록됐습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "사진을 올리지 못했습니다.";
      setToast(message);
      throw error;
    }
  };

  const clickPlacePhoto = async (photo: PlacePhoto) => {
    const workerPhotoId = photo.workerPhotoId;
    if (!workerPhotoId) {
      return;
    }

    if (!cloudflareApiConfigured) {
      const message = "사진 확인은 운영 사진 서버 연결 후 반영됩니다.";
      setToast(message);
      throw new Error(message);
    }

    try {
      const result = await fetchJson<PhotoClickResult>(cloudflareApiUrl(`/api/photos/${encodeURIComponent(workerPhotoId)}/click`), {
        method: "POST",
      });
      setWorkerPhotos((current) =>
        current.map((workerPhoto) =>
          workerPhoto.id === workerPhotoId ? { ...workerPhoto, clickCount: result.clickCount } : workerPhoto,
        ),
      );
      trackEvent("click_photo", { photoId: workerPhotoId, created: result.created });
      setToast(result.created ? "사진 확인이 랭킹 신호에 반영됐습니다." : "이미 확인한 사진입니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "사진 확인 반영에 실패했습니다.";
      setToast(message);
      throw error;
    }
  };

  const deletePlacePhoto = async (place: Place, photo: PlacePhoto) => {
    const workerPhotoId = photo.workerPhotoId;
    if (!workerPhotoId || !photo.ownedByCurrentSession) {
      return;
    }

    trackEvent("delete_photo", { placeId: place.id, photoId: workerPhotoId });

    if (!cloudflareApiConfigured) {
      const message = "사진 삭제는 운영 사진 서버 연결 후 사용할 수 있습니다.";
      setToast(message);
      throw new Error(message);
    }

    try {
      const result = await fetchJson<PhotoDeleteResult>(cloudflareApiUrl(`/api/photos/${encodeURIComponent(workerPhotoId)}`), {
        method: "DELETE",
      });
      if (result.deleted) {
        setWorkerPhotos((current) => current.filter((workerPhoto) => workerPhoto.id !== workerPhotoId));
      }
      setToast(`${place.name}에 올린 내 사진을 삭제했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "사진 삭제에 실패했습니다.";
      setToast(message);
      throw error;
    }
  };

  const prependPlaceComment = (placeId: string, comment: PlaceComment) => {
    setWorkerCommentsByPlaceId((current) => ({
      ...current,
      [placeId]: [comment, ...(current[placeId] ?? [])].slice(0, 12),
    }));
  };

  const appendRealtimeEvent = (
    placeId: string,
    type: CloudflareRealtimeEvent["type"],
    createdAt: string,
    payload: CloudflareRealtimeEvent["payload"],
  ) => {
    setRealtimeEventsByPlaceId((current) => ({
      ...current,
      [placeId]: [
        {
          type,
          scope: "place",
          roomId: `place:${placeId}`,
          createdAt,
          payload,
        } satisfies CloudflareRealtimeEvent,
        ...(current[placeId] ?? []),
      ].slice(0, 8),
    }));
  };

  const submitPlaceComment = async (place: Place, body: string) => {
    const normalizedBody = body.trim();
    if (!normalizedBody) {
      setToast("댓글 내용을 입력해 주세요.");
      return;
    }

    trackEvent("create_comment", { placeId: place.id, bodyLength: normalizedBody.length });

    if (!cloudflareApiConfigured) {
      const createdAt = new Date().toISOString();
      prependPlaceComment(place.id, {
        id: `local-comment:${crypto.randomUUID()}`,
        author: "익명 현장러",
        body: normalizedBody,
        meta: "방금 전 · 로컬 미리보기",
        verified: false,
      });
      appendRealtimeEvent(place.id, "comment.created", createdAt, { placeId: place.id, source: "local-preview" });
      setToast("미리보기 댓글을 추가했습니다. 운영 연결 후에는 서버에 저장됩니다.");
      return;
    }

    try {
      const comment = await fetchJson<WorkerComment>(cloudflareApiUrl("/api/comments"), {
        method: "POST",
        body: JSON.stringify({
          placeId: place.id,
          body: normalizedBody,
        }),
      });
      prependPlaceComment(place.id, workerCommentToPlaceComment(comment));
      appendRealtimeEvent(place.id, "comment.created", comment.createdAt, { id: comment.id, placeId: place.id });
      setToast(`${place.name} 댓글을 등록했습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "댓글 등록에 실패했습니다.");
      throw error;
    }
  };

  const likePlaceComment = async (place: Place, comment: PlaceComment) => {
    const workerCommentId = comment.workerCommentId;
    if (!workerCommentId) {
      return;
    }

    trackEvent("like_comment", { placeId: place.id, commentId: workerCommentId });

    if (!cloudflareApiConfigured) {
      const message = "댓글 도움은 운영 연결 후 반영됩니다.";
      setToast(message);
      throw new Error(message);
    }

    try {
      const result = await fetchJson<CommentLikeResult>(cloudflareApiUrl(`/api/comments/${encodeURIComponent(workerCommentId)}/like`), {
        method: "POST",
      });
      setWorkerCommentsByPlaceId((current) => ({
        ...current,
        [place.id]: (current[place.id] ?? []).map((item) =>
          item.workerCommentId === workerCommentId
            ? {
                ...item,
                likeCount: result.likeCount,
                liked: true,
                meta: updateCommentMetaLikeCount(item.meta, result.likeCount),
              }
            : item,
        ),
      }));
      setToast(result.created ? "댓글 도움이 랭킹 신호에 반영됐습니다." : "이미 도움을 누른 댓글입니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "댓글 도움 반영에 실패했습니다.";
      setToast(message);
      throw error;
    }
  };

  const submitQuestion = async () => {
    if (!selectedPlace || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const questionType = questionTypeFromText(questionText);
      const result = await fetchJson<{ balance?: number; creditEvent?: { amount: number } }>(
        cloudflareApiConfigured ? cloudflareApiUrl("/api/questions") : "/api/questions",
        {
          method: "POST",
          body: JSON.stringify({
            placeId: selectedPlace.id,
            questionType,
            body: questionText.trim(),
          }),
        },
      );
      const balance = typeof result.balance === "number" ? result.balance : Math.max(0, 3 + (result.creditEvent?.amount ?? -1));
      setToast(`질문이 등록됐습니다. 질문권 잔액 ${balance}개입니다.`);
      setQuestionText("");
      setActiveView("place");
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "질문 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hidePostCreatorLocally = (post: PublicPost) => {
    setHiddenCreatorNames((current) => {
      if (current.has(post.creatorName)) {
        return current;
      }

      const next = new Set(current);
      next.add(post.creatorName);
      return next;
    });
  };

  const flagPost = async (post: PublicPost, reason: FlagReason) => {
    try {
      if (cloudflareApiConfigured) {
        await fetchJson<ModerationReportResult>(cloudflareApiUrl("/api/moderation/reports"), {
          method: "POST",
          body: JSON.stringify({
            targetType: "post",
            targetId: post.id,
            reason,
            note: `게시물 신고: ${post.id}; place=${post.placeId}`,
          }),
        });
        trackEvent("flag_post", { postId: post.id, reason });
        hidePostCreatorLocally(post);
        setToast("신고가 접수됐습니다. 이 작성자의 게시물을 내 화면에서 숨겼습니다.");
        setPendingFlagPost(null);
        return;
      }

      const result = await fetchJson<{ hidden: boolean; flagCount: number }>("/api/post-flags", {
        method: "POST",
        body: JSON.stringify({
          postId: post.id,
          reason,
        }),
      });
      trackEvent("flag_post", { postId: post.id, reason });
      hidePostCreatorLocally(post);
      setToast(result.hidden ? "신고가 접수되어 게시물을 임시 숨김 처리했고, 이 작성자의 게시물을 내 화면에서 숨겼습니다." : `신고가 접수됐습니다. 이 작성자의 게시물을 내 화면에서 숨겼습니다. 누적 ${result.flagCount}건`);
      setPendingFlagPost(null);
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "신고 처리에 실패했습니다.");
    }
  };

  const applyQuickReportPreset = (preset: QuickReportPreset) => {
    if (preset.patch.pickedCrowd) setPickedCrowd(preset.patch.pickedCrowd);
    if (preset.patch.pickedParking) setPickedParking(preset.patch.pickedParking);
    if (preset.patch.pickedLine) setPickedLine(preset.patch.pickedLine);
    if (preset.patch.pickedWeather) setPickedWeather(preset.patch.pickedWeather);
    if (typeof preset.patch.photoAttached === "boolean") setPhotoAttached(preset.patch.photoAttached);
    if (preset.patch.reportText) setReportText(preset.patch.reportText);
    trackEvent("submit_quick_report", { presetId: preset.id, placeId: selectedPlace?.id ?? null });
    setToast(`${preset.label} 빠른 제보가 작성 폼에 반영됐습니다.`);
  };

  const answerFieldQuest = (quest: FieldQuest) => {
    if (quest.questionType === "parking") {
      setPickedParking("거의 없음");
    }
    if (quest.questionType === "line") {
      setPickedLine("있음");
    }
    if (quest.questionType === "crowd") {
      setPickedCrowd("많음");
    }
    setPhotoAttached(false);
    setReportText(quest.prompt);
    setSelectedPlaceId(quest.placeId);
    setActiveView("upload");
    trackEvent("answer_field_quest", { questId: quest.id, placeId: quest.placeId });
    setToast("현장 질문을 올리기 화면으로 연결했습니다. 위치 인증은 선택 사항입니다.");
  };

  const selectHashtag = async (hashtagName: string) => {
    try {
      const filteredPosts = await fetchJson<PublicPost[]>(
        cloudflareApiConfigured
          ? cloudflareApiUrl(
              buildScopedApiPath("/api/posts", {
                regionId: activeDataRegionId,
                hashtagName,
                limit: 100,
              }),
            )
          : buildScopedApiPath("/api/posts", {
              regionId: activeDataRegionId,
              hashtagName,
              limit: 100,
            }),
      );
      setPosts(filteredPosts);
      setSelectedHashtagName(hashtagName);
      setActiveView("home");
      trackEvent("click_hashtag", { hashtagName });
      setToast(`#${hashtagName} 피드 ${filteredPosts.length}건을 불러왔습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "해시태그 피드를 불러오지 못했습니다.");
    }
  };

  const clearHashtagFilter = async () => {
    setSelectedHashtagName(null);
    await loadData();
  };

  const selectChallenge = async (challenge: Challenge) => {
    trackEvent("view_challenge", { challengeId: challenge.id, hashtagName: challenge.hashtagName });
    await selectHashtag(challenge.hashtagName);
  };

  const togglePlaceFollow = (place: Place) => {
    setFollowedPlaceIds((current) => toggleSetValue(current, place.id));
    const isFollowing = followedPlaceIds.has(place.id);
    trackEvent("follow_place", { placeId: place.id, following: !isFollowing });
    setToast(isFollowing ? `${place.name} 팔로우를 해제했습니다.` : `${place.name} 새 지금컷을 팔로우합니다.`);
  };

  const toggleHashtagFollow = (hashtagName: string) => {
    setFollowedHashtagNames((current) => toggleSetValue(current, hashtagName));
    const isFollowing = followedHashtagNames.has(hashtagName);
    trackEvent("follow_hashtag", { hashtagName, following: !isFollowing });
    setToast(isFollowing ? `#${hashtagName} 팔로우를 해제했습니다.` : `#${hashtagName} 관심 피드를 팔로우합니다.`);
  };

  const toggleNotifications = () => {
    const nextEnabled = !notificationEnabled;
    const followCount = followedPlaceIds.size + followedHashtagNames.size;

    setNotificationEnabled(nextEnabled);
    trackEvent("toggle_notifications", { enabled: nextEnabled, followCount });

    if (!nextEnabled) {
      setToast("새 현장 알림을 껐습니다.");
      return;
    }

    setToast(
      followCount > 0
        ? `앱 안 새 현장 알림 기준을 켰습니다. 팔로우 ${followCount}개를 마이에 표시합니다.`
        : "앱 안 새 현장 알림 기준을 켰습니다. 장소나 해시태그를 팔로우하면 마이에 표시됩니다.",
    );
  };

  const markHelpful = (post: PublicPost) => {
    if (helpfulPostIds.has(post.id)) {
      setToast("이미 도움돼요를 누른 제보입니다.");
      return;
    }

    setHelpfulPostIds((current) => toggleSetValue(current, post.id));
    trackEvent("helpful_post", { postId: post.id });
    setToast("도움돼요가 반영됐습니다. 피드 랭킹에 즉시 반영됩니다.");
  };

  const toggleSavePost = (post: PublicPost) => {
    setSavedPostIds((current) => toggleSetValue(current, post.id));
    const isSaved = savedPostIds.has(post.id);
    trackEvent("save_post", { postId: post.id, saved: !isSaved });
    setToast(isSaved ? "저장을 해제했습니다." : "마이에 저장했습니다.");
  };

  const sharePost = async (post: PublicPost) => {
    const shareUrl = `${getSiteUrl()}/share/post/${post.id}`;
    const shareText = `${post.shareCard.headline}\n${post.shareCard.body}\n${post.shareCard.hashtags.map((tag) => `#${tag}`).join(" ")}\n${shareUrl}`;
    const browserNavigator = navigator as Navigator & {
      clipboard?: Clipboard;
      share?: (data: ShareData) => Promise<void>;
    };

    try {
      if (browserNavigator.share) {
        await browserNavigator.share({
          title: post.shareCard.headline,
          text: `${post.shareCard.body}\n${post.shareCard.hashtags.map((tag) => `#${tag}`).join(" ")}`,
          url: shareUrl,
        });
        trackEvent("share_post", { postId: post.id, method: "native" });
        setToast("공유 시트를 열었습니다.");
        return;
      }

      if (!browserNavigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }

      await browserNavigator.clipboard.writeText(shareText);
      trackEvent("share_post", { postId: post.id, method: "clipboard" });
      setToast("공유 카드 페이지 링크를 복사했습니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast("공유를 취소했습니다.");
        return;
      }

      try {
        if (!browserNavigator.clipboard) {
          throw new Error("Clipboard API unavailable");
        }

        await browserNavigator.clipboard.writeText(shareText);
        trackEvent("share_post", { postId: post.id, method: "clipboard_fallback" });
        setToast("공유가 어려워 링크를 복사했습니다.");
      } catch {
        setToast("공유 기능을 사용할 수 없습니다. 공유 페이지는 운영 URL 연결 후 다시 확인해 주세요.");
      }
    }
  };

  const closeOnboarding = () => {
    window.localStorage.setItem(firstVisitSeenKey, "true");
    setShowOnboarding(false);
    trackEvent("complete_onboarding");
  };

  return (
    <main className={styles.redesign}>
      <section className={styles.appCanvas} aria-label="#실시간 앱 프론트엔드 디자인">
        <div className={styles.phoneFrame}>
          <StatusBar />
          <TopHeader
            activeView={activeView}
            dataMode={dataMode}
            selectedPlace={selectedPlace}
            toast={toast}
            onBack={() => setActiveView("home")}
            notificationEnabled={notificationEnabled}
            onNotify={toggleNotifications}
            onSafety={() => setToast("정확한 좌표, 원본 파일명, 민감정보는 공개하지 않는 정책입니다.")}
          />

          <div className={styles.phoneBody} ref={phoneBodyRef}>
            {loading && <SharedEmptyState title="실시간 데이터를 불러오는 중입니다" body="최근 제보와 질문을 확인하고 있어요." />}
            {!loading && activeView !== "map" && places.length === 0 && (
              <SharedEmptyState
                title="아직 이 지역 제보가 없습니다"
                body="다른 지역 탭을 선택하거나 첫 제보가 올라오면 최근 3시간 기준으로 랭킹과 지도에 반영됩니다."
                action={(
                  <div className={styles.emptyActionRow}>
                    <button type="button" onClick={() => setActiveView("search")}>검색으로 넓히기</button>
                    <button type="button" onClick={() => setActiveView("map")}>지도에서 다른 지역 보기</button>
                  </div>
                )}
              />
            )}
            {!loading && (
              <>
                {activeView === "home" && selectedPlace && (
                  <HomeScreen
                    dataMode={dataMode}
                    places={places}
                    questions={questions}
                    posts={rankedPosts}
                    hashtags={hashtags}
                    challenges={challenges}
                    selectedHashtagName={selectedHashtagName}
                    followedHashtagNames={followedHashtagNames}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    reports={reports}
                    onFlagPost={setPendingFlagPost}
                    onClearHashtagFilter={clearHashtagFilter}
                    onFollowHashtag={toggleHashtagFollow}
                    onHelpfulPost={markHelpful}
                    onOpenPlace={openPlace}
                    onSavePost={toggleSavePost}
                    onSelectChallenge={selectChallenge}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    onGoMap={() => setActiveView("map")}
                    onGoSearch={(query?: string) => {
                      if (query) setMapSearchQuery(query);
                      setActiveView("search");
                    }}
                    onGoReport={(place?: Place) => {
                      if (place) setSelectedPlaceId(place.id);
                      setActiveView("upload");
                    }}
                  />
                )}
                {activeView === "search" && (
                  <SearchScreen
                    hashtags={hashtags}
                    places={places}
                    posts={rankedPosts}
                    query={mapSearchQuery}
                    reports={reports}
                    onGoMap={(query) => {
                      setMapSearchQuery(query);
                      setActiveView("map");
                      setToast(query ? `${query} 기준으로 지도에서 볼게요.` : "지도에서 주변 장소를 볼게요.");
                    }}
                    onGoUpload={(place) => {
                      setSelectedPlaceId(place.id);
                      setActiveView("upload");
                      setToast(`${place.name} 지금 상태를 올립니다.`);
                    }}
                    onOpenPlace={openPlace}
                    onQueryChange={setMapSearchQuery}
                    onSelectHashtag={selectHashtag}
                  />
                )}
                {activeView === "map" && (
                  <MapScreen
                    activeFilter={activeFilter}
                    dataMode={dataMode}
                    activeRegion={activeRegion}
                    currentLocation={mapCurrentLocation}
                    likedPlaceIds={likedPlaceIds}
                    liveConnection={liveConnection}
                    mapRequerying={mapRequerying}
                    mapBounds={mapBounds}
                    previewPlace={mapPreviewPlace}
                    realtimeEventsByPlaceId={realtimeEventsByPlaceId}
                    searchQuery={mapSearchQuery}
                    onFilterChange={setActiveFilter}
                    onPreviewPlace={previewMapPlace}
                    onClosePreview={closeMapPreview}
                    onCommentSubmit={submitPlaceComment}
                    onLikeComment={likePlaceComment}
                    onLikePlace={togglePlaceLike}
                    onLocation={setMapCurrentLocation}
                    onLocationPermissionChange={setMapLocationPermission}
                    onMapBoundsChange={updateMapBounds}
                    onRequery={requeryCurrentMap}
                    onRegionChange={changeActiveRegion}
                    onReport={startReportForPlace}
                    onReportPlace={reportMapPlace}
                    onSearchQueryChange={setMapSearchQuery}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportComment={openCommentReport}
                    onReportPhoto={openPhotoReport}
                    places={places}
                    posts={rankedPosts}
                    reports={reports}
                    workerCommentsByPlaceId={workerCommentsByPlaceId}
                    workerPhotos={workerPhotos}
                    locationPermission={mapLocationPermission}
                    onToast={setToast}
                  />
                )}
                {activeView === "place" && selectedPlace && (
                  <PlaceScreen
                    key={selectedPlace.id}
                    place={selectedPlace}
                    posts={selectedPosts}
                    questions={questions}
                    reports={selectedReports}
                    nearbyPlaces={places.filter((place) => place.region === selectedPlace.region && place.id !== selectedPlace.id)}
                    fieldQuests={fieldQuests.filter((quest) => quest.placeId === selectedPlace.id)}
                    onAsk={() => setActiveView("ask")}
                    onAnswerQuest={answerFieldQuest}
                    onFlagPost={setPendingFlagPost}
                    onFollowPlace={() => togglePlaceFollow(selectedPlace)}
                    followedPlace={followedPlaceIds.has(selectedPlace.id)}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    onHelpfulPost={markHelpful}
                    onReport={() => setActiveView("upload")}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportPhoto={openPhotoReport}
                    onSavePost={toggleSavePost}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    workerPhotos={workerPhotos}
                  />
                )}
                {activeView === "upload" && selectedPlace && (
                  <ReportScreen
                    isSubmitting={isSubmitting}
                    photoUploadReady={cloudflareApiConfigured}
                    place={selectedPlace}
                    places={places}
                    sensitiveWarning={sensitivePhotoWarningFor(selectedPlace)}
                    pickedCrowd={pickedCrowd}
                    pickedParking={pickedParking}
                    pickedLine={pickedLine}
                    pickedWeather={pickedWeather}
                    photoAttached={photoAttached}
                    locationVerificationStatus={locationVerificationStatus}
                    reportText={reportText}
                    recommendedTags={recommendedTags}
                    quickReportPresets={quickReportPresets}
                    photos={photosForPlace(
                      selectedPosts,
                      selectedReports,
                      workerPhotos.filter((photo) => photo.placeId === selectedPlace.id && photo.status === "ready"),
                    )}
                    setPickedCrowd={setPickedCrowd}
                    setPickedParking={setPickedParking}
                    setPickedLine={setPickedLine}
                    setPickedWeather={setPickedWeather}
                    setReportText={setReportText}
                    onSelectPlace={(place) => setSelectedPlaceId(place.id)}
                    onApplyPreset={applyQuickReportPreset}
                    onOpenPlace={() => setActiveView("place")}
                    onPhotoDelete={(photo) => deletePlacePhoto(selectedPlace, photo)}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={(photo) => uploadPlacePhoto(selectedPlace, photo)}
                    onReportPhoto={(photo) => openPhotoReport(selectedPlace, photo)}
                    onRequestLocation={requestFieldVerification}
                    onSubmit={submitReport}
                  />
                )}
                {activeView === "ask" && selectedPlace && (
                  <AskScreen
                    isSubmitting={isSubmitting}
                    place={selectedPlace}
                    questionText={questionText}
                    setQuestionText={setQuestionText}
                    onSubmit={submitQuestion}
                  />
                )}
                {activeView === "my" && (
                  <MyScreen
                    followedHashtagNames={followedHashtagNames}
                    followedPlaces={places.filter((place) => followedPlaceIds.has(place.id))}
                    hiddenCreatorNames={hiddenCreatorNames}
                    myQuestions={myQuestions}
                    reports={reports}
                    savedPosts={allRankedPosts.filter((post) => savedPostIds.has(post.id))}
                    userReputation={userReputation}
                    onToast={setToast}
                  />
                )}
              </>
            )}
          </div>

          <BottomNav activeView={activeView} onChange={setActiveView} />
          {showOnboarding && activeView === "home" && (
            <OnboardingSheet
              onClose={closeOnboarding}
              onGoMap={() => {
                closeOnboarding();
                setActiveView("map");
              }}
              onGoReport={() => {
                closeOnboarding();
                setActiveView("upload");
              }}
            />
          )}
          {pendingFlagPost && (
            <FlagReasonModal
              title={pendingFlagPost.shareCard.headline}
              onClose={() => setPendingFlagPost(null)}
              onSubmit={(reason) => void flagPost(pendingFlagPost, reason)}
            />
          )}
          {pendingModerationTarget && (
            <FlagReasonModal
              title={pendingModerationTarget.title}
              onClose={() => setPendingModerationTarget(null)}
              onSubmit={(reason) => void reportModerationTarget(pendingModerationTarget, reason)}
            />
          )}
        </div>

        <OperatorPanel hashtags={hashtags} places={places} posts={rankedPosts} questions={questions} />
      </section>
    </main>
  );
}

function StatusBar() {
  return (
    <div className={styles.statusBar}>
      <span>9:41</span>
      <span className={styles.statusDots}>● ● ▰</span>
    </div>
  );
}

function TopHeader({
  activeView,
  dataMode,
  notificationEnabled,
  onNotify,
  onSafety,
  selectedPlace,
  toast,
  onBack,
}: {
  activeView: View;
  dataMode: DataMode;
  notificationEnabled: boolean;
  onNotify: () => void;
  onSafety: () => void;
  selectedPlace: Place | null;
  toast: string;
  onBack: () => void;
}) {
  const isDetail = ["place", "ask"].includes(activeView);
  const titleMap: Record<View, string> = {
    home: "실시간",
    search: "검색",
    upload: "올리기",
    map: "지도",
    place: selectedPlace?.name ?? "장소 상세",
    ask: "물어보기",
    my: "마이",
  };

  return (
    <header className={styles.topHeader}>
      <div className={styles.headerRow}>
        <button className={styles.iconButton} type="button" onClick={isDetail ? onBack : onSafety} aria-label={isDetail ? "뒤로" : "안전 정책"}>
          {isDetail ? <X size={18} /> : <ShieldCheck size={18} />}
        </button>
        <div>
          <p className={styles.eyebrow}>지금 장소 사진</p>
          <h1>{titleMap[activeView]}</h1>
        </div>
        <button
          className={`${styles.iconButton} ${notificationEnabled ? styles.iconButtonActive : ""}`}
          type="button"
          onClick={onNotify}
          aria-label={notificationEnabled ? "새 현장 알림 끄기" : "새 현장 알림 켜기"}
          aria-pressed={notificationEnabled}
        >
          <Bell size={18} />
        </button>
      </div>
      <div className={`${styles.dataModeBanner} ${dataMode === "sample" ? styles.dataModeBannerSample : ""}`}>
        <strong>{dataMode === "sample" ? "샘플 미리보기" : "실시간 데이터"}</strong>
        <span>
          {dataMode === "sample"
            ? "현재 화면은 예시 데이터입니다. 실제 사진/상태는 API 연결 후 표시됩니다."
            : "최근 장소 사진과 상태를 불러오는 중입니다."}
        </span>
      </div>
      <div className={styles.toast}>{toast}</div>
    </header>
  );
}

function HomeScreen({
  dataMode,
  places,
  questions,
  posts,
  hashtags,
  challenges,
  selectedHashtagName,
  followedHashtagNames,
  helpfulPostIds,
  savedPostIds,
  reports,
  onFlagPost,
  onClearHashtagFilter,
  onFollowHashtag,
  onHelpfulPost,
  onOpenPlace,
  onSavePost,
  onSelectChallenge,
  onSharePost,
  onSelectHashtag,
  onGoSearch,
  onGoMap,
  onGoReport,
}: {
  dataMode: DataMode;
  places: Place[];
  questions: Question[];
  posts: PublicPost[];
  hashtags: PublicHashtag[];
  challenges: Challenge[];
  selectedHashtagName: string | null;
  followedHashtagNames: Set<string>;
  helpfulPostIds: Set<string>;
  savedPostIds: Set<string>;
  reports: Report[];
  onFlagPost: (post: PublicPost) => void;
  onClearHashtagFilter: () => void;
  onFollowHashtag: (hashtagName: string) => void;
  onHelpfulPost: (post: PublicPost) => void;
  onOpenPlace: (place: Place) => void;
  onSavePost: (post: PublicPost) => void;
  onSelectChallenge: (challenge: Challenge) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  onGoSearch: (query?: string) => void;
  onGoMap: () => void;
  onGoReport: (place?: Place) => void;
}) {
  const [activeFeedTab, setActiveFeedTab] = useState<FeedTab>("전체");
  const featured = places[0];
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const filteredPosts = useMemo(
    () =>
      posts
        .filter((post) => !post.hiddenAt)
        .filter((post) => postMatchesFeedTab(post, placeById.get(post.placeId), activeFeedTab))
        .slice(0, 3),
    [activeFeedTab, placeById, posts],
  );
  const goodCount = places.filter((place) => place.signal === "가도 좋음").length;
  const cautionCount = places.filter((place) => place.signal === "혼잡 주의" || place.signal === "대기 보통").length;
  const avoidCount = places.filter((place) => place.signal === "출발 전 확인").length;
  const leadPost = filteredPosts.find((post) => post.photoCount > 0) ?? filteredPosts[0] ?? posts.find((post) => !post.hiddenAt) ?? null;
  const leadPlace = leadPost ? placeById.get(leadPost.placeId) ?? featured : featured;
  const leadPhotoUrl = leadPost ? photoUrlForPost(leadPost, reports) : null;
  const leadIsSample = dataMode === "sample" || Boolean(leadPost?.id.startsWith("fallback_"));
  const leadTags = (leadPost?.hashtagNames.length ? leadPost.hashtagNames : hashtags.map((tag) => tag.name)).slice(0, 3);
  const keywordQueries = ["광안리 주차", "황리단길 웨이팅", "태화강 산책"];

  return (
    <div className={styles.screenStack}>
      <section className={styles.photoLeadCard}>
        <button
          className={styles.photoLeadPreview}
          style={photoBackgroundStyle(leadPhotoUrl)}
          type="button"
          onClick={() => leadPlace && onOpenPlace(leadPlace)}
          disabled={!leadPlace}
        >
          <span className={styles.photoLeadMeta}>{leadIsSample ? "예시 사진" : "방금 올라온 사진"} · {leadPost ? minutesAgo(leadPost.createdAt) : "방금 전"}</span>
          <span className={styles.photoLeadKicker}>출발 전 10초 확인</span>
          <strong>{leadPlace?.name ?? "#실시간"}</strong>
          <p>{leadPost?.caption ?? leadPost?.shareCard.headline ?? leadPlace?.summary ?? "지금 올라온 장소 사진을 기다리고 있어요."}</p>
          <div className={styles.photoLeadTags}>
            {leadTags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        </button>
        <div className={styles.photoLeadActions}>
          <button type="button" onClick={() => leadPlace && onOpenPlace(leadPlace)} disabled={!leadPlace}>
            실시간 사진 보기
          </button>
          <button type="button" onClick={() => onGoReport(leadPlace ?? undefined)}>
            지금컷 올리기
          </button>
        </div>
      </section>

      {leadIsSample && (
        <section className={styles.sampleDataNotice} aria-label="오프라인 샘플 안내">
          <strong>현재는 샘플 미리보기입니다</strong>
          <p>실제 운영에서는 이 자리가 사용자 사진, 최근 제보 시간, 신고 처리 상태로 바뀝니다.</p>
        </section>
      )}

      <section className={styles.searchCard}>
        <button className={`${styles.searchBox} ${styles.homeSearchButton}`} type="button" onClick={() => onGoSearch()}>
          <Search size={18} />
          <span>장소, 해시태그, 지역 검색</span>
          <ChevronRight size={16} />
        </button>
        <div className={styles.keywordRow}>
          {keywordQueries.map((keyword) => (
            <button key={keyword} type="button" onClick={() => onGoSearch(keyword)}>{keyword}</button>
          ))}
        </div>
      </section>

      <section className={styles.decisionRail} aria-label="현재 판단 요약">
        <div className={styles.decisionItem}>
          <CheckCircle2 size={17} />
          <span>가도 좋음</span>
          <strong>{goodCount}</strong>
        </div>
        <div className={styles.decisionItem}>
          <AlertTriangle size={17} />
          <span>주의</span>
          <strong>{cautionCount}</strong>
        </div>
        <div className={styles.decisionItem}>
          <ShieldAlert size={17} />
          <span>지금은 비추</span>
          <strong>{avoidCount}</strong>
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title={selectedHashtagName ? `#${selectedHashtagName} 피드` : "실시간 사진 피드"} caption={selectedHashtagName ? `${filteredPosts.length}개 현장 게시물` : `${activeFeedTab} ${filteredPosts.length}건`} />
        {selectedHashtagName && (
          <div className={styles.feedFilterBanner}>
            <span>해시태그 필터 적용 중</span>
            <button type="button" onClick={onClearHashtagFilter}>전체 피드 보기</button>
          </div>
        )}
        <div className={styles.feedTabs}>
          {feedTabLabels.map((tab) => (
            <button key={tab} className={tab === activeFeedTab ? styles.activeFeedTab : ""} type="button" onClick={() => setActiveFeedTab(tab)} aria-pressed={tab === activeFeedTab}>{tab}</button>
          ))}
        </div>
        <div className={styles.feedList}>
          {filteredPosts.map((post) => {
            const place = places.find((item) => item.id === post.placeId) ?? places[0];
            return (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                reports={reports}
                onFlag={() => onFlagPost(post)}
                onHelpful={() => onHelpfulPost(post)}
                onOpenPlace={() => onOpenPlace(place)}
                onSave={() => onSavePost(post)}
                onShare={() => onSharePost(post)}
                onSelectHashtag={onSelectHashtag}
                helpfulActive={helpfulPostIds.has(post.id)}
                saved={savedPostIds.has(post.id)}
              />
            );
          })}
          {filteredPosts.length === 0 && (
            <div className={styles.emptyActionRow}>
              <p className={styles.emptyText}>{activeFeedTab} 조건에 맞는 현장 게시물이 없습니다.</p>
              <button type="button" onClick={() => onGoReport(leadPlace ?? undefined)}>첫 지금컷 올리기</button>
              <button type="button" onClick={onGoMap}>다른 지역 보기</button>
            </div>
          )}
        </div>
      </section>

      <section className={styles.challengeSection}>
        <SectionTitle title="오늘 필요한 지금컷" caption="사진과 해시태그 중심" />
        <div className={styles.challengeList}>
          {challenges.slice(0, 2).map((challenge) => (
            <button key={challenge.id} type="button" onClick={() => onSelectChallenge(challenge)}>
              <span>#{challenge.hashtagName}</span>
              <strong>{challenge.title}</strong>
              <p>{challenge.description}</p>
              <small>{challenge.rewardBadge} 뱃지</small>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption="최대 5개 추천 구조" />
        <div className={styles.hashtagCloud}>
          {hashtags.slice(0, 4).map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)}>
              <Hash size={13} />
              {tag.name}
              <span>{tag.postCount}</span>
            </button>
          ))}
        </div>
        {selectedHashtagName && (
          <button className={styles.followTagButton} type="button" onClick={() => onFollowHashtag(selectedHashtagName)}>
            <Bell size={14} />
            {followedHashtagNames.has(selectedHashtagName) ? "팔로잉 해제" : `#${selectedHashtagName} 팔로우`}
          </button>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="지금 많이 확인하는 곳" caption="사진 · 질문 · 길찾기 기준" />
        <div className={styles.rankingList}>
          {places.slice(0, 3).map((place, index) => (
            <button key={place.id} className={styles.rankingItem} type="button" onClick={() => onOpenPlace(place)}>
              <span className={styles.rank}>{index + 1}</span>
              <div>
                <strong>{place.name}</strong>
                <p>{place.summary}</p>
              </div>
              <span className={styles.visitors}>{place.visitors}</span>
            </button>
          ))}
        </div>
      </section>

      {reports.length > 0 && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="최근 현장 코멘트" caption="최근순" />
          <div className={styles.reportGrid}>
            {reports.slice(0, 2).map((report) => {
              const place = places.find((item) => item.id === report.placeId) ?? places[0];
              return <LiveReportCard key={report.id} report={report} place={place} onOpen={() => onOpenPlace(place)} />;
            })}
          </div>
        </section>
      )}

      <AnswerableQuestions questions={questions} places={places} />
    </div>
  );
}

function SearchScreen({
  hashtags,
  onGoMap,
  onGoUpload,
  onOpenPlace,
  onQueryChange,
  onSelectHashtag,
  places,
  posts,
  query,
  reports,
}: {
  hashtags: PublicHashtag[];
  onGoMap: (query: string) => void;
  onGoUpload: (place: Place) => void;
  onOpenPlace: (place: Place) => void;
  onQueryChange: (query: string) => void;
  onSelectHashtag: (hashtagName: string) => void;
  places: Place[];
  posts: PublicPost[];
  query: string;
  reports: Report[];
}) {
  const trimmedQuery = query.trim();
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const [externalSearchStatus, setExternalSearchStatus] = useState<"idle" | "loading" | "ready" | "unconfigured" | "error">("idle");
  const [externalPlaces, setExternalPlaces] = useState<NaverLocalSearchResult[]>([]);
  const [externalSearchMessage, setExternalSearchMessage] = useState("");
  const matchedPlaces = searchPlaces(places, trimmedQuery).slice(0, 6);
  const matchedHashtags = hashtags
    .filter((tag) => !trimmedQuery || tag.name.toLocaleLowerCase("ko-KR").includes(trimmedQuery.toLocaleLowerCase("ko-KR")))
    .slice(0, 8);
  const matchedPosts = posts
    .filter((post) => !post.hiddenAt)
    .filter((post) => {
      if (!trimmedQuery) return true;
      const place = placeById.get(post.placeId);
      const haystack = [post.shareCard.headline, post.caption, place?.name, place?.address, ...post.hashtagNames].join(" ");
      return haystack.toLocaleLowerCase("ko-KR").includes(trimmedQuery.toLocaleLowerCase("ko-KR"));
    })
    .sort((left, right) => Number(right.photoCount > 0) - Number(left.photoCount > 0) || Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 4);
  const hotRegions = ["광안리", "황리단길", "태화강", "주차", "웨이팅", "사진스팟"];
  const externalSearchEnabled = trimmedQuery.length >= 2;
  const visibleExternalSearchStatus = externalSearchEnabled ? externalSearchStatus : "idle";
  const visibleExternalPlaces = externalSearchEnabled ? externalPlaces : [];
  const fallbackUploadPlace = matchedPlaces[0] ?? places[0];
  const shouldShowExternalFallback =
    visibleExternalSearchStatus === "unconfigured" ||
    visibleExternalSearchStatus === "error" ||
    (visibleExternalSearchStatus === "ready" && visibleExternalPlaces.length === 0);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setExternalSearchStatus("loading");
      setExternalSearchMessage("");
      void fetchJson<NaverLocalSearchPayload>(`/api/external/naver/local-search?query=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
      })
        .then((payload) => {
          if (controller.signal.aborted) return;
          setExternalPlaces(payload.items);
          setExternalSearchStatus("ready");
          setExternalSearchMessage(payload.coordinateNote);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : "네이버 장소 검색에 실패했습니다.";
          setExternalPlaces([]);
          setExternalSearchStatus(message.includes("설정") ? "unconfigured" : "error");
          setExternalSearchMessage(message);
        });
    }, 360);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery]);

  return (
    <div className={styles.screenStack}>
      <section className={styles.searchPanel}>
        <label className={styles.searchBox}>
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="장소, 해시태그, 지역 검색"
            autoComplete="off"
            placeholder="예: 광안리 주차, 성수 웨이팅"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className={styles.searchQuickGrid} aria-label="빠른 지역 검색">
          {hotRegions.map((region) => (
            <button key={region} type="button" onClick={() => onGoMap(region)}>
              {region}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="사진 있는 최근 결과" caption={`${matchedPosts.length}개`} />
        <div className={styles.searchPhotoList}>
          {matchedPosts.map((post) => {
            const place = placeById.get(post.placeId) ?? places[0];
            const photoUrl = photoUrlForPost(post, reports);
            const isSample = post.id.startsWith("fallback_");

            return (
              <article key={post.id} className={styles.searchPhotoItem}>
                <button className={styles.searchPhotoButton} type="button" onClick={() => place && onOpenPlace(place)}>
                  <span className={styles.searchPhotoThumb} style={photoBackgroundStyle(photoUrl)} aria-hidden="true" />
                  <span className={styles.searchPhotoCopy}>
                    <span>{isSample ? "샘플 사진" : post.photoCount > 0 ? "사진 있음" : "상태"}</span>
                    <strong>{place?.name ?? "장소"}</strong>
                    <p>{post.caption ?? post.shareCard.headline}</p>
                  </span>
                </button>
                {place && (
                  <button type="button" onClick={() => onGoUpload(place)}>
                    지금컷 추가
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {matchedPosts.length === 0 && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>아직 검색어와 맞는 최근 사진이 없습니다.</p>
            <button type="button" onClick={() => onGoMap(trimmedQuery)}>지도에서 찾기</button>
            {fallbackUploadPlace && <button type="button" onClick={() => onGoUpload(fallbackUploadPlace)}>지금컷 추가</button>}
          </div>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="앱 안 장소" caption={`${matchedPlaces.length}곳`} />
        <div className={styles.rankingList}>
          {matchedPlaces.map((place, index) => (
            <button key={place.id} className={styles.rankingItem} type="button" onClick={() => onOpenPlace(place)}>
              <span className={styles.rank}>{index + 1}</span>
              <div>
                <strong>{place.name}</strong>
                <p>{place.summary}</p>
              </div>
              <span className={styles.visitors}>{place.visitors}</span>
            </button>
          ))}
        </div>
        {matchedPlaces.length === 0 && <p className={styles.emptyText}>장소 결과가 없습니다. 지도로 넓혀서 볼 수 있어요.</p>}
        <button className={styles.inlineActionButton} type="button" onClick={() => onGoMap(trimmedQuery)}>
          지도에서 보기
        </button>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle
          title="네이버 장소 검색"
          caption={visibleExternalSearchStatus === "loading" ? "검색 중" : visibleExternalPlaces.length ? `${visibleExternalPlaces.length}곳` : "외부 검색"}
        />
        {visibleExternalSearchStatus === "idle" && <p className={styles.emptyText}>두 글자 이상 입력하면 앱 밖 장소도 함께 확인합니다.</p>}
        {visibleExternalSearchStatus === "loading" && <p className={styles.emptyText}>네이버 장소를 확인하는 중입니다.</p>}
        {visibleExternalSearchStatus === "unconfigured" && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>장소 추가 검색은 준비 중입니다. 지금은 사진이 있는 앱 안 장소를 먼저 보여드려요.</p>
          </div>
        )}
        {visibleExternalSearchStatus === "error" && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>{externalSearchMessage}</p>
          </div>
        )}
        {visibleExternalSearchStatus === "ready" && visibleExternalPlaces.length === 0 && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>외부 장소 결과가 없습니다. 검색어를 조금 넓혀보세요.</p>
          </div>
        )}
        {shouldShowExternalFallback && (
          <div className={styles.emptyActionRow}>
            <button type="button" onClick={() => onGoMap(trimmedQuery)}>앱 안 지도에서 보기</button>
            {fallbackUploadPlace ? (
              <button type="button" onClick={() => onGoUpload(fallbackUploadPlace)}>
                {matchedPlaces[0] ? "이 장소 지금컷 추가" : "인기 장소 지금컷 추가"}
              </button>
            ) : (
              <button type="button" onClick={() => onGoMap("")}>인기 지역 보기</button>
            )}
          </div>
        )}
        {visibleExternalPlaces.length > 0 && (
          <div className={styles.searchPhotoList}>
            {visibleExternalPlaces.map((item) => {
              const address = item.roadAddress || item.address || "주소 정보 없음";
              const openExternalPlace = () => {
                onQueryChange(item.title);
                onGoMap(item.title);
              };

              return (
                <article key={`${item.title}:${item.mapx}:${item.mapy}`} className={styles.searchPhotoItem}>
                  <button type="button" onClick={openExternalPlace}>
                    <span>{item.category || "네이버 장소"}</span>
                    <strong>{item.title}</strong>
                    <p>{address}</p>
                  </button>
                  <button type="button" onClick={openExternalPlace}>
                    지도
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption={`${matchedHashtags.length}개`} />
        <div className={styles.hashtagCloud}>
          {matchedHashtags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)}>
              <Hash size={13} />
              {tag.name}
              <span>{tag.postCount}</span>
            </button>
          ))}
        </div>
        {matchedHashtags.length === 0 && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>맞는 해시태그가 아직 없습니다.</p>
            <button type="button" onClick={() => onGoMap(trimmedQuery)}>관련 장소 보기</button>
            {fallbackUploadPlace && <button type="button" onClick={() => onGoUpload(fallbackUploadPlace)}>해시태그로 지금컷 올리기</button>}
          </div>
        )}
      </section>
    </div>
  );
}

function MapScreen({
  activeFilter,
  dataMode,
  activeRegion,
  currentLocation,
  likedPlaceIds,
  liveConnection,
  locationPermission,
  mapBounds,
  mapRequerying,
  onFilterChange,
  onClosePreview,
  onCommentSubmit,
  onLikeComment,
  onLikePlace,
  onLocation,
  onLocationPermissionChange,
  onMapBoundsChange,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  onPreviewPlace,
  onRequery,
  onReport,
  onReportComment,
  onRegionChange,
  onReportPhoto,
  onReportPlace,
  onSearchQueryChange,
  onToast,
  places,
  posts,
  previewPlace,
  realtimeEventsByPlaceId,
  reports,
  searchQuery,
  workerCommentsByPlaceId,
  workerPhotos,
}: {
  activeFilter: string;
  dataMode: DataMode;
  activeRegion: RegionTabId;
  currentLocation: UiLocation | null;
  likedPlaceIds: Set<string>;
  liveConnection: "connecting" | "live" | "polling";
  locationPermission: LocationPermissionState;
  mapBounds: MapBounds | null;
  mapRequerying: boolean;
  onFilterChange: (filter: string) => void;
  onClosePreview: () => void;
  onCommentSubmit: (place: Place, body: string) => Promise<void>;
  onLikeComment: (place: Place, comment: PlaceComment) => Promise<void>;
  onLikePlace: (place: Place) => void;
  onLocation: (location: UiLocation | null) => void;
  onLocationPermissionChange: (permission: LocationPermissionState) => void;
  onMapBoundsChange: (bounds: MapBounds) => void;
  onPhotoDelete: (place: Place, photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (place: Place, photo: PreparedPhotoUpload) => Promise<void>;
  onPreviewPlace: (place: Place, source?: "map_marker" | "ranking") => void;
  onRequery: () => Promise<void>;
  onReport: (place: Place) => void;
  onReportComment: (place: Place, comment: PlaceComment) => void;
  onRegionChange: (region: RegionTabId) => void;
  onReportPhoto: (place: Place, photo: PlacePhoto) => void;
  onReportPlace: (place: Place) => void;
  onSearchQueryChange: (query: string) => void;
  onToast: (message: string) => void;
  places: Place[];
  posts: PublicPost[];
  previewPlace: Place | null;
  realtimeEventsByPlaceId: Record<string, CloudflareRealtimeEvent[]>;
  reports: Report[];
  searchQuery: string;
  workerCommentsByPlaceId: Record<string, PlaceComment[]>;
  workerPhotos: WorkerPhoto[];
}) {
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  const [requeryHintVisible, setRequeryHintVisible] = useState(false);
  const filteredPlaces = searchPlaces(filterPlaces(filterPlacesByRegion(places, activeRegion), activeFilter), searchQuery);
  const mapAreaPlaces = mapBounds ? filteredPlaces.filter((place) => isPlaceInBounds(place, mapBounds)) : filteredPlaces;
  const mapTop = rankPlaces(mapAreaPlaces);
  const detailPlace = previewPlace;
  const detailPosts = detailPlace ? posts.filter((post) => post.placeId === detailPlace.id && !post.hiddenAt) : [];
  const detailReports = detailPlace ? reports.filter((report) => report.placeId === detailPlace.id && !report.hiddenAt) : [];
  const detailPhotos = detailPlace ? workerPhotos.filter((photo) => photo.placeId === detailPlace.id && photo.status === "ready") : [];
  const comments = detailPlace ? [...(workerCommentsByPlaceId[detailPlace.id] ?? []), ...commentsForPlace(detailPosts, detailReports)] : [];
  const photos = photosForPlace(detailPosts, detailReports, detailPhotos);
  const locationMessage = locationPermissionCopy(locationPermission);
  const detailSheetRef = useRef<HTMLDivElement>(null);
  const visibleLiveConnection = detailPlace ? liveConnection : "polling";

  useEffect(() => {
    if (!detailPlace) {
      return;
    }

    window.requestAnimationFrame(() => {
      scrollNearestContainerToChild(detailSheetRef.current);
    });
  }, [detailPlace]);

  const toggleTraffic = () => {
    const next = !trafficEnabled;
    setTrafficEnabled(next);
    trackEvent("toggle_traffic_layer", { enabled: next });
    onToast(next ? "네이버 교통 레이어를 켰습니다." : "네이버 교통 레이어를 껐습니다.");
  };
  const cycleFilter = () => {
    const currentIndex = Math.max(0, filterLabels.indexOf(activeFilter));
    const nextFilter = filterLabels[(currentIndex + 1) % filterLabels.length];
    onFilterChange(nextFilter);
    onToast(`${nextFilter} 필터로 지도를 좁혔습니다.`);
  };
  const selectMapPlace = (place: Place) => {
    onPreviewPlace(place, "map_marker");
  };

  return (
    <div className={styles.mapScreen}>
      <section className={styles.mapHeroControls} aria-label="지도 탐색 컨트롤">
        <div>
          <p className={styles.eyebrow}>사진 올라온 장소</p>
          <h2>지금 사진이 있는 곳을 지도에서 보세요</h2>
        </div>
        <span className={styles.liveBadge}>{visibleLiveConnection === "live" ? "실시간 연결" : "자동 갱신"}</span>
      </section>

      <section className={styles.realMapFrame} aria-label="네이버 지도 기반 현장 지도">
        <NaverMap
          places={filteredPlaces}
          compact
          currentLocation={currentLocation}
          showTraffic={trafficEnabled}
          onBoundsChange={onMapBoundsChange}
          onMapInteraction={() => setRequeryHintVisible(true)}
          onSelectPlace={selectMapPlace}
        />
      </section>
      <p className={styles.mapTruthNote}>
        {dataMode === "sample"
          ? "샘플 미리보기라 지도 핀도 예시입니다. 실제 API 연결 후 최근 사진이 있는 장소만 표시됩니다."
          : "네이버 지도 타일이 불안정하면 대체 지도가 먼저 표시됩니다. 장소 판단은 사진과 최근 상태를 함께 확인하세요."}
      </p>

      {detailPlace && (
        <section className={styles.mapSelectedPlaceBar} aria-live="polite">
          <div>
            <span>
              {photos.length > 0 ? `사진 ${photos.length}장` : "상태 제보"} · {detailReports[0]?.meta ?? (detailPosts[0] ? minutesAgo(detailPosts[0].createdAt) : "방금 전")}
            </span>
            <strong>{detailPlace.name}</strong>
            <p>{detailReports[0]?.body ?? detailPosts[0]?.caption ?? detailPlace.summary}</p>
          </div>
          <div className={styles.mapSelectedActions}>
            <button type="button" onClick={() => detailSheetRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>
              실시간 사진 보기
            </button>
            <button type="button" onClick={() => onReport(detailPlace)}>
              지금컷 올리기
            </button>
          </div>
        </section>
      )}

      <div className={styles.mapSearchRow}>
        <label className={styles.searchBox}>
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="사진 올라온 장소 검색"
            placeholder="사진 올라온 장소 검색"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>
        <button className={styles.filterButton} type="button" onClick={cycleFilter} aria-label={`지도 필터 순환: ${activeFilter}`}>
          <Filter size={16} /> 필터
        </button>
      </div>

      <div className={styles.mapToolRow}>
        <button className={trafficEnabled ? styles.mapToolActive : ""} type="button" onClick={toggleTraffic} aria-pressed={trafficEnabled}>
          {trafficEnabled ? "교통 끄기" : "교통 켜기"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRequeryHintVisible(false);
            void onRequery();
          }}
          disabled={mapRequerying}
        >
          {mapRequerying ? "다시 불러오는 중" : "이 지역 다시 검색"}
        </button>
      </div>
      {requeryHintVisible && <p className={styles.mapRequeryHint}>지도를 움직였습니다. 이 지역 기준으로 다시 검색할 수 있어요.</p>}

      <div className={styles.locationNotice}>
        <div>
          <strong>{locationMessage.title}</strong>
          <p>{locationMessage.body}</p>
        </div>
        <CurrentLocationButton
          permission={locationPermission}
          onLocation={onLocation}
          onPermissionChange={(permission) => {
            onLocationPermissionChange(permission);
            if (permission === "denied" || permission === "unsupported") {
              onToast("위치 권한 없이도 현재 지역과 전국 랭킹을 계속 볼 수 있습니다.");
            }
          }}
        />
      </div>

      <RegionTabs activeRegion={activeRegion} onChange={onRegionChange} />

      <div className={styles.filterChips} aria-label="지도 장소 필터">
        {filterLabels.map((filter) => (
          <button
            key={filter}
            aria-pressed={filter === activeFilter}
            className={filter === activeFilter ? styles.activeFilter : ""}
            type="button"
            onClick={() => onFilterChange(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {detailPlace && (
        <div ref={detailSheetRef}>
          <PlaceDetailSheet
            place={detailPlace}
            comments={comments}
            photos={photos}
            reportCount={detailReports.length + detailPosts.length}
            realtimeEvents={realtimeEventsByPlaceId[detailPlace.id] ?? []}
            realtimeMode={visibleLiveConnection}
            safetyNotice={sensitivePhotoWarningFor(detailPlace)}
            liked={likedPlaceIds.has(detailPlace.id)}
            onClose={onClosePreview}
            onCommentSubmit={(body) => onCommentSubmit(detailPlace, body)}
            onCommentLike={(comment) => onLikeComment(detailPlace, comment)}
            onLike={() => onLikePlace(detailPlace)}
            onPhotoDelete={(photo) => onPhotoDelete(detailPlace, photo)}
            onPhotoClick={onPhotoClick}
            onPhotoUpload={(photo) => onPhotoUpload(detailPlace, photo)}
            onReport={() => onReport(detailPlace)}
            onReportComment={(comment) => onReportComment(detailPlace, comment)}
            onReportPhoto={(photo) => onReportPhoto(detailPlace, photo)}
            onReportPlace={() => onReportPlace(detailPlace)}
          />
        </div>
      )}

      <section className={styles.rankingGrid} aria-label="실시간 장소 랭킹">
        <RankingPanel
          title="지도 화면 안 TOP 10"
          places={mapTop}
          onOpenPlace={(place) => {
            const fullPlace = places.find((candidate) => candidate.id === place.id);
            if (fullPlace) onPreviewPlace(fullPlace, "ranking");
          }}
          emptyBody="지도를 움직이거나 지역 탭을 바꾸면 화면 안 후보가 다시 계산됩니다."
        />
      </section>
    </div>
  );
}

function PlaceScreen({
  place,
  posts,
  questions,
  reports,
  nearbyPlaces,
  fieldQuests,
  onAsk,
  onAnswerQuest,
  onFlagPost,
  onFollowPlace,
  followedPlace,
  helpfulPostIds,
  savedPostIds,
  onHelpfulPost,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  onReport,
  onReportPhoto,
  onSavePost,
  onSharePost,
  onSelectHashtag,
  workerPhotos,
}: {
  place: Place;
  posts: PublicPost[];
  questions: Question[];
  reports: Report[];
  nearbyPlaces: Place[];
  fieldQuests: FieldQuest[];
  onAsk: () => void;
  onAnswerQuest: (quest: FieldQuest) => void;
  onFlagPost: (post: PublicPost) => void;
  onFollowPlace: () => void;
  followedPlace: boolean;
  helpfulPostIds: Set<string>;
  savedPostIds: Set<string>;
  onHelpfulPost: (post: PublicPost) => void;
  onPhotoDelete: (place: Place, photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (place: Place, photo: PreparedPhotoUpload) => Promise<void>;
  onReport: () => void;
  onReportPhoto: (place: Place, photo: PlacePhoto) => void;
  onSavePost: (post: PublicPost) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  workerPhotos: WorkerPhoto[];
}) {
  const [placeActiveTab, setPlaceActiveTab] = useState<PlaceTab>("실시간");
  const sensitiveWarning = sensitivePhotoWarningFor(place);
  const hasSensitivePolicy = Boolean(sensitiveWarning);
  const placeQuestions = questions.filter((question) => question.placeId === place.id);
  const latestQuestion = placeQuestions.find((question) => !question.answeredReportId);
  const placeHashtags = [...new Set(posts.flatMap((post) => post.hashtagNames))].slice(0, 8);
  const photos = photosForPlace(posts, reports, workerPhotos.filter((photo) => photo.placeId === place.id && photo.status === "ready"));
  const photoCount = photos.length;
  const heroPhotoUrl = photos[0]?.previewUrl ?? null;
  const todayReports = posts.length || reports.length;
  const tabPosts = placeActiveTab === "사진" ? posts.filter((post) => post.photoCount > 0) : posts;
  const focusPhotoTab = () => setPlaceActiveTab("사진");

  return (
    <div className={styles.screenStack}>
      <section className={`${styles.placeHero} ${styles[place.tone]}`} style={photoBackgroundStyle(heroPhotoUrl)}>
        <div className={styles.placePhotoOverlay}>
          <span>{place.signal}</span>
        </div>
      </section>

      <section className={styles.placeSummaryCard}>
        <div className={styles.placeTitleRow}>
          <div>
            <p className={styles.eyebrow}>{place.address}</p>
            <h2>{place.name}</h2>
          </div>
          <button className={`${styles.followButton} ${followedPlace ? styles.followButtonActive : ""}`} type="button" onClick={onFollowPlace}>
            {followedPlace ? "팔로잉" : "팔로우"}
          </button>
        </div>
        <p>{place.summary}</p>
        <div className={styles.placeStatsRow}>
          <StatBox label="오늘 제보" value={String(todayReports)} />
          <StatBox label="사진" value={String(photoCount)} />
          <StatBox label="질문" value={String(questions.filter((question) => question.placeId === place.id).length)} />
          <StatBox label="팔로워" value={place.id === "busan-gwangalli" ? "1,240" : "320"} />
        </div>
        <div className={styles.statusGrid}>
          <StatusMetric icon={Users} label="사람" value={place.crowd} />
          <StatusMetric icon={CircleParking} label="주차" value={place.parking} />
          <StatusMetric icon={Clock} label="줄" value={place.line} />
          <StatusMetric icon={CloudSun} label="날씨" value={place.weather} />
        </div>
      </section>

      <section className={styles.trustCard}>
        <div>
          <p className={styles.eyebrow}>현장 신뢰도</p>
          <strong>{place.score}%</strong>
          <span>현장 인증과 최근성 기준</span>
        </div>
        <div className={styles.trustRing} style={{ ['--score' as string]: `${place.score}%` }}>
          <ShieldCheck size={24} />
        </div>
      </section>

      {hasSensitivePolicy && (
        <section className={styles.warningCard}>
          <ShieldAlert size={18} />
          <p>{sensitiveWarning}</p>
        </section>
      )}

      <section className={styles.fieldQuestCard}>
        <SectionTitle title="근처 사람이 궁금해해요" caption={`${fieldQuests.length}개`} />
        <div className={styles.fieldQuestList}>
          {fieldQuests.map((quest) => (
            <button key={quest.id} type="button" onClick={() => onAnswerQuest(quest)}>
              <MessageCircleQuestion size={17} />
              <div>
                <strong>{quest.prompt}</strong>
                <span>답변하면 질문권 +{quest.rewardCredits}</span>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          {fieldQuests.length === 0 && (
            <div className={styles.emptyActionRow}>
              <p className={styles.emptyText}>현재 이 장소에 열린 현장 질문이 없습니다.</p>
              <button type="button" onClick={onAsk}>질문 남기기</button>
              <button type="button" onClick={onReport}>지금컷 올리기</button>
            </div>
          )}
        </div>
      </section>

      <section className={styles.placeTabs} aria-label="장소 프로필 탭">
        {(["실시간", "사진", "질문", "해시태그", "근처"] as PlaceTab[]).map((tab) => (
          <button key={tab} className={tab === placeActiveTab ? styles.placeTabActive : ""} type="button" onClick={() => setPlaceActiveTab(tab)}>{tab}</button>
        ))}
      </section>

      {(placeActiveTab === "실시간" || placeActiveTab === "사진") && (
        <section className={styles.sectionBlock}>
          <SectionTitle title={placeActiveTab === "사진" ? "사진 있는 게시물" : "장소별 타임라인"} caption={`${tabPosts.length}건`} />
          <div className={styles.feedList}>
            {tabPosts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                reports={reports}
                onFlag={() => onFlagPost(post)}
                onHelpful={() => onHelpfulPost(post)}
                onOpenPlace={focusPhotoTab}
                onSave={() => onSavePost(post)}
                onShare={() => onSharePost(post)}
                onSelectHashtag={onSelectHashtag}
                helpfulActive={helpfulPostIds.has(post.id)}
                saved={savedPostIds.has(post.id)}
              />
            ))}
            {tabPosts.length === 0 && (
              <div className={styles.emptyActionRow}>
                <p className={styles.emptyText}>{placeActiveTab === "사진" ? "아직 사진이 있는 게시물이 없습니다." : "아직 장소별 피드가 없습니다."}</p>
                <button type="button" onClick={onReport}>첫 지금컷 올리기</button>
                <button type="button" onClick={onAsk}>질문 남기기</button>
              </div>
            )}
          </div>
        </section>
      )}

      {placeActiveTab === "질문" && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="장소 질문" caption={`${placeQuestions.length}건`} />
          <div className={styles.answerList}>
            {placeQuestions.map((question) => (
              <article key={question.id} className={styles.answerItem}>
                <MessageCircleQuestion size={18} />
                <div>
                  <strong>{question.body}</strong>
                  <p>{question.time} · {question.answeredReportId ? "답변 완료" : "답변 대기"}</p>
                </div>
                <span>{question.reward}</span>
              </article>
            ))}
            {placeQuestions.length === 0 && (
              <div className={styles.emptyActionRow}>
                <p className={styles.emptyText}>아직 이 장소에 올라온 질문이 없습니다.</p>
                <button type="button" onClick={onAsk}>첫 질문 남기기</button>
                <button type="button" onClick={onReport}>지금컷 올리기</button>
              </div>
            )}
          </div>
        </section>
      )}

      {placeActiveTab === "해시태그" && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="장소 해시태그" caption={`${placeHashtags.length}개`} />
          <div className={styles.hashtagCloud}>
            {placeHashtags.map((tag) => (
              <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}><Hash size={13} />{tag}</button>
            ))}
            {placeHashtags.length === 0 && (
              <div className={styles.emptyActionRow}>
                <p className={styles.emptyText}>아직 이 장소에 연결된 해시태그가 없습니다.</p>
                <button type="button" onClick={onReport}>해시태그로 지금컷 올리기</button>
              </div>
            )}
          </div>
        </section>
      )}

      {placeActiveTab === "근처" && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="근처 장소" caption={`${nearbyPlaces.length}곳`} />
          <div className={styles.rankingList}>
            {nearbyPlaces.map((nearbyPlace, index) => (
              <article key={nearbyPlace.id} className={styles.nearbyPlaceItem}>
                <span className={styles.rank}>{index + 1}</span>
                <div>
                  <strong>{nearbyPlace.name}</strong>
                  <p>{nearbyPlace.summary}</p>
                </div>
                <span className={`${styles.statusChip} ${styles[nearbyPlace.tone]}`}>{nearbyPlace.signal}</span>
              </article>
            ))}
            {nearbyPlaces.length === 0 && (
              <div className={styles.emptyActionRow}>
                <p className={styles.emptyText}>같은 지역의 근처 장소가 아직 없습니다.</p>
                <button type="button" onClick={onReport}>이 장소 지금컷 올리기</button>
              </div>
            )}
          </div>
        </section>
      )}

      <section className={styles.sectionBlock}>
        <SectionTitle title="최근 현장 사진" caption={`${photos.length}건`} />
        <PhotoUploader
          photos={photos}
          onDeletePhoto={(photo) => onPhotoDelete(place, photo)}
          onPhotoClick={onPhotoClick}
          onReportPhoto={(photo) => onReportPhoto(place, photo)}
          onUpload={(photo) => onPhotoUpload(place, photo)}
          safetyNotice={sensitivePhotoWarningFor(place)}
        />
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="현장 인증 제보" caption="최근 3시간" />
        {(reports.length ? reports : [reportsFallback(place)]).map((report) => (
          <LiveReportCard key={report.id} report={report} place={place} />
        ))}
      </section>

      <section className={styles.questionCard}>
        <div>
          <p className={styles.eyebrow}>최근 질문</p>
          <h3>{latestQuestion?.body ?? "지금 현장 상황이 궁금한가요?"}</h3>
        </div>
        <button type="button" onClick={onAsk}>물어보기</button>
      </section>

      <div className={styles.stickyActions}>
        <button className={styles.secondaryButton} type="button" onClick={onAsk}>물어보기</button>
        <button className={styles.primaryButton} type="button" onClick={onReport}>지금컷 올리기</button>
      </div>
    </div>
  );
}

function ReportScreen({
  isSubmitting,
  photoUploadReady,
  place,
  places,
  sensitiveWarning,
  pickedCrowd,
  pickedParking,
  pickedLine,
  pickedWeather,
  photoAttached,
  locationVerificationStatus,
  reportText,
  recommendedTags,
  quickReportPresets,
  photos,
  setPickedCrowd,
  setPickedParking,
  setPickedLine,
  setPickedWeather,
  setReportText,
  onSelectPlace,
  onApplyPreset,
  onOpenPlace,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  onReportPhoto,
  onRequestLocation,
  onSubmit,
}: {
  isSubmitting: boolean;
  photoUploadReady: boolean;
  place: Place;
  places: Place[];
  sensitiveWarning: string | null;
  pickedCrowd: string;
  pickedParking: string;
  pickedLine: string;
  pickedWeather: string;
  photoAttached: boolean;
  locationVerificationStatus: LocationVerificationStatus;
  reportText: string;
  recommendedTags: string[];
  quickReportPresets: QuickReportPreset[];
  photos: PlacePhoto[];
  setPickedCrowd: (value: string) => void;
  setPickedParking: (value: string) => void;
  setPickedLine: (value: string) => void;
  setPickedWeather: (value: string) => void;
  setReportText: (value: string) => void;
  onSelectPlace: (place: Place) => void;
  onApplyPreset: (preset: QuickReportPreset) => void;
  onOpenPlace: () => void;
  onPhotoDelete: (photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (photo: PreparedPhotoUpload) => Promise<void>;
  onReportPhoto: (photo: PlacePhoto) => void;
  onRequestLocation: () => void;
  onSubmit: () => void;
}) {
  const verificationCopy = verificationStatusCopy(locationVerificationStatus);
  const toggleRecommendedTag = (tag: string) => {
    const token = `#${tag}`;
    const nextText = reportText.includes(token)
      ? reportText
          .replace(token, "")
          .replace(/\s{2,}/g, " ")
          .trim()
      : `${reportText.trim()} ${token}`.trim();

    setReportText(nextText.slice(0, 120));
  };

  return (
    <div className={styles.screenStack}>
      <section className={styles.formIntroCard}>
        <BadgeCheck size={22} />
        <div>
          <h2>{place.name} 올리기</h2>
          <p>사진 1장을 먼저 고르고, 장소와 해시태그, 한 줄만 남기면 됩니다.</p>
          <ol className={styles.uploadSteps} aria-label="지금컷 올리기 5단계">
            <li>사진</li>
            <li>장소</li>
            <li>태그</li>
            <li>한 줄</li>
            <li>올리기</li>
          </ol>
          <ul className={styles.uploadGuidanceList} aria-label="지금컷 올리기 안내">
            <li>사진 1장을 먼저 올리면 피드 상단 지금컷으로 표시돼요.</li>
            <li>긴급 상황만 사진 없이 상태로 남길 수 있어요.</li>
            <li>얼굴, 차량번호, 서류는 가려주세요.</li>
          </ul>
        </div>
      </section>

      <section className={styles.photoUploadCard} aria-label="사진 선택">
        <div className={`${styles.uploadBox} ${photoAttached ? styles.uploadAttached : ""}`}>
          <Camera size={26} />
          <strong>{photoAttached ? "사진 업로드 완료" : "지금컷 올리기"}</strong>
          <span>얼굴, 차량번호, 서류가 보이면 가린 뒤 올려주세요.</span>
        </div>
        <PhotoUploader
          photos={photos}
          onDeletePhoto={onPhotoDelete}
          onPhotoClick={onPhotoClick}
          onReportPhoto={onReportPhoto}
          onUpload={onPhotoUpload}
          safetyNotice={sensitiveWarning}
        />
        {!photoUploadReady && (
          <p className={styles.uploadReadinessNote}>
            사진 저장 준비 중입니다. 지금은 사진 선택과 미리보기를 확인하고, 긴급한 장소 상태는 먼저 남길 수 있어요.
          </p>
        )}
        <button type="button" onClick={onOpenPlace}>
          <ImageIcon size={16} /> 장소 사진 더 보기
        </button>
      </section>

      <section className={styles.uploadPlaceCard} aria-label="사진을 올릴 장소 선택">
        <div>
          <span>어디인가요?</span>
          <strong>{place.name}</strong>
          <p>{place.address}</p>
        </div>
        <div className={styles.uploadPlaceList}>
          {places.slice(0, 6).map((candidate) => (
            <button
              key={candidate.id}
              className={candidate.id === place.id ? styles.uploadPlaceActive : ""}
              type="button"
              onClick={() => onSelectPlace(candidate)}
              aria-pressed={candidate.id === place.id}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.quickReportCard}>
        <SectionTitle title="사진 보완 상태" caption="버튼으로 10초 입력" />
        <div className={styles.quickReportGrid}>
          {quickReportPresets.map((preset) => (
            <button key={preset.id} type="button" onClick={() => onApplyPreset(preset)}>
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      <ChoiceGroup title="사람 상태" options={reportChips} value={pickedCrowd} onChange={setPickedCrowd} />
      <ChoiceGroup title="주차 상태" options={parkingChips} value={pickedParking} onChange={setPickedParking} />
      <ChoiceGroup title="줄/대기 상태" options={lineChips} value={pickedLine} onChange={setPickedLine} />
      <ChoiceGroup title="날씨/환경" options={weatherChips} value={pickedWeather} onChange={setPickedWeather} />

      <section className={styles.textAreaCard}>
        <label htmlFor="reportText">한 줄 코멘트</label>
        <textarea
          id="reportText"
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          placeholder="예: 주차장은 만차고, 해변 중앙은 사람이 많아요."
          maxLength={120}
        />
        <span>{reportText.length}/120</span>
      </section>

      <section className={styles.hashtagSuggestCard}>
        <div className={styles.sectionTitle}>
          <h2>추천 해시태그</h2>
          <span>{recommendedTags.length}/5</span>
        </div>
        <div className={styles.hashtagCloud}>
          {recommendedTags.map((tag) => (
            <button key={tag} type="button" onClick={() => toggleRecommendedTag(tag)}><Hash size={13} />{tag}</button>
          ))}
        </div>
      </section>

      <section className={`${styles.verifyCard} ${locationVerificationStatus === "verified" ? styles.verifyCardActive : ""}`}>
        <LocateFixed size={18} />
        <div>
          <strong>{verificationCopy.title}</strong>
          <p>{verificationCopy.body}</p>
        </div>
        <button type="button" onClick={onRequestLocation} disabled={locationVerificationStatus === "requesting"}>
          {locationVerificationStatus === "requesting" ? "확인 중" : "현장 인증하기"}
        </button>
      </section>

      <button className={styles.submitButton} type="button" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? "등록 중..." : photoAttached ? "지금컷 올리기" : "사진 없이 상태만 올리기"}
      </button>
    </div>
  );
}

function AskScreen({
  isSubmitting,
  place,
  questionText,
  setQuestionText,
  onSubmit,
}: {
  isSubmitting: boolean;
  place: Place;
  questionText: string;
  setQuestionText: (value: string) => void;
  onSubmit: () => void;
}) {
  const questionTypeOptions = [
    { icon: Users, label: "사람/혼잡", prompt: "지금 사람 많은가요?" },
    { icon: Car, label: "주차", prompt: "지금 주차 자리 있나요?" },
    { icon: Clock, label: "줄/대기", prompt: "줄이 많이 긴가요?" },
    { icon: Camera, label: "사진 요청", prompt: "사진으로 볼 수 있나요?" },
  ] satisfies Array<{ icon: LucideIcon; label: string; prompt: string }>;
  const [activeQuestionType, setActiveQuestionType] = useState(questionTypeOptions[0].label);
  const chooseQuestionType = (label: string, prompt: string) => {
    setActiveQuestionType(label);
    if (!questionText.trim() || questionExamples.includes(questionText)) {
      setQuestionText(prompt);
    }
  };

  return (
    <div className={styles.screenStack}>
      <section className={styles.askHeroCard}>
        <Ticket size={24} />
        <div>
          <p className={styles.eyebrow}>내 질문권 3개</p>
          <h2>{place.name} 근처 사용자에게 물어보세요.</h2>
          <span>사진 요청은 2개, 일반 질문은 1개가 차감됩니다.</span>
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="자주 묻는 예시" caption="바로 선택" />
        <div className={styles.exampleGrid}>
          {questionExamples.map((example) => (
            <button key={example} type="button" onClick={() => setQuestionText(example)}>{example}</button>
          ))}
        </div>
      </section>

      <section className={styles.questionTypeGrid}>
        {questionTypeOptions.map((option) => (
          <QuestionType
            key={option.label}
            icon={option.icon}
            label={option.label}
            active={activeQuestionType === option.label}
            onClick={() => chooseQuestionType(option.label, option.prompt)}
          />
        ))}
      </section>

      <section className={styles.textAreaCard}>
        <label htmlFor="questionText">질문 내용</label>
        <textarea
          id="questionText"
          value={questionText}
          onChange={(event) => setQuestionText(event.target.value)}
          placeholder="궁금한 내용을 구체적으로 작성해 주세요."
          maxLength={120}
        />
        <span>{questionText.length}/120</span>
      </section>

      <section className={styles.warningCard}>
        <AlertTriangle size={18} />
        <p>개인정보, 민원 내용, 환자 정보, 특정인을 알아볼 수 있는 질문은 제한됩니다.</p>
      </section>

      <button className={styles.submitButton} type="button" onClick={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? "등록 중..." : "질문 등록"}
      </button>
    </div>
  );
}

function MyScreen({
  followedHashtagNames,
  followedPlaces,
  hiddenCreatorNames,
  myQuestions,
  onToast,
  reports,
  savedPosts,
  userReputation,
}: {
  followedHashtagNames: Set<string>;
  followedPlaces: Place[];
  hiddenCreatorNames: Set<string>;
  myQuestions: MyQuestion[];
  onToast: (message: string) => void;
  reports: Report[];
  savedPosts: PublicPost[];
  userReputation: UserReputation;
}) {
  const reportsRef = useRef<HTMLElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef<HTMLElement | null>(null);
  const hashtagsRef = useRef<HTMLElement | null>(null);
  const badgesRef = useRef<HTMLElement | null>(null);
  const safetyRef = useRef<HTMLElement | null>(null);
  const [activeMenuTarget, setActiveMenuTarget] = useState<MyMenuTarget | null>(null);
  const answeredCount = myQuestions.filter((question) => question.status === "answered").length;
  const latestReports = [...reports]
    .filter((report) => !report.hiddenAt)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 4);
  const latestQuestions = myQuestions.slice(0, 4);
  const questionStatusMeta = (question: MyQuestion | Question) => {
    const reward = "reward" in question ? question.reward : question.questionType === "photo_request" ? "+2" : "+1";
    return `${question.answeredReportId ? "답변 완료" : "답변 대기"} · ${reward}`;
  };
  const menuItems = [
    { icon: Camera, label: "최근 사진", message: "최근 사진 활동으로 이동했습니다.", target: "reports", ref: reportsRef },
    { icon: MessageCircleQuestion, label: "내 질문", message: "내 질문 현황으로 이동했습니다.", target: "questions", ref: questionsRef },
    { icon: Bookmark, label: "저장한 게시물", message: "저장한 게시물로 이동했습니다.", target: "saved", ref: savedRef },
    { icon: Hash, label: "팔로우한 해시태그", message: "팔로우한 해시태그로 이동했습니다.", target: "hashtags", ref: hashtagsRef },
    { icon: Star, label: "지역 뱃지", message: "지역 뱃지로 이동했습니다.", target: "badges", ref: badgesRef },
    { icon: UserX, label: "숨긴 작성자", message: `${hiddenCreatorNames.size}명 숨김 상태를 확인합니다.`, target: "safety", ref: safetyRef },
    { icon: ShieldCheck, label: "안전 정책 및 이용 안내", message: "안전 정책으로 이동했습니다.", target: "safety", ref: safetyRef },
  ] satisfies Array<{ icon: LucideIcon; label: string; message: string; target: MyMenuTarget; ref: RefObject<HTMLElement | null> }>;
  const handleMenuClick = (item: (typeof menuItems)[number]) => {
    setActiveMenuTarget(item.target);
    onToast(item.message);
    window.requestAnimationFrame(() => {
      scrollNearestContainerToChild(item.ref.current);
      item.ref.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className={styles.screenStack}>
      <section className={styles.profileCard}>
        <div className={styles.avatar}>실</div>
        <div>
          <h2>익명 현장러</h2>
          <p>이 기기 기준 활동 · 신뢰 점수 {userReputation.trustScore}</p>
        </div>
        <Settings size={19} />
      </section>

      <section className={styles.myDataNotice}>
        <ShieldCheck size={17} />
        <p>마이는 이 기기에서 저장한 장소, 게시물, 내 질문, 안전 설정을 보여줍니다. 계정 없이도 현재 기기 기준 활동은 유지됩니다.</p>
      </section>

      <section className={styles.reputationCard}>
        <div>
          <p className={styles.eyebrow}>현장 신뢰 점수</p>
          <h3>현장 인증과 도움돼요가 점수를 올립니다.</h3>
        </div>
        <div className={styles.reputationMeter}>
          <strong>{userReputation.trustScore}</strong>
          <span>100점 만점</span>
        </div>
        <p>
          현장 인증 {userReputation.verifiedReportCount}건 · 도움돼요 {userReputation.helpfulReceivedCount}건 · 허위/민감정보 위반은 감점됩니다.
        </p>
      </section>

      <section className={styles.myStatsGrid}>
        <StatBox label="최근 사진" value={String(reports.length)} />
        <StatBox label="내 질문" value={String(myQuestions.length)} />
        <StatBox label="답변 완료" value={String(answeredCount)} />
        <StatBox label="저장" value={String(savedPosts.length)} />
      </section>

      <section
        ref={badgesRef}
        className={`${styles.badgeShelf} ${activeMenuTarget === "badges" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-label="지역 뱃지"
      >
        {["태화강 지금컷", "부산 주차 도우미", "사진 스팟 헌터"].map((badge) => (
          <span key={badge}><BadgeCheck size={14} />{badge}</span>
        ))}
      </section>

      <section className={styles.walletCard}>
        <div>
          <p className={styles.eyebrow}>질문권</p>
          <h3>기본 질문권 3개로 현장 질문을 보낼 수 있어요.</h3>
        </div>
        <strong>3개</strong>
      </section>

      <section
        ref={reportsRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "reports" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-reports-heading"
      >
        <SectionTitle title="최근 사진 활동" caption={`${latestReports.length}건`} headingId="my-reports-heading" />
        <div className={styles.followList}>
          {latestReports.map((report) => (
            <article key={report.id} className={styles.followListItem}>
              <Camera size={15} />
              <div>
                <strong>{report.title}</strong>
                <span>{report.verified ? "현장 인증" : "상태 제보"} · {report.meta}</span>
              </div>
            </article>
          ))}
          {latestReports.length === 0 && <p className={styles.emptyText}>최근 사진 활동이 없습니다. 지금컷을 올리면 이 기기 활동에 먼저 쌓입니다.</p>}
        </div>
      </section>

      <section
        ref={questionsRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "questions" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-questions-heading"
      >
        <SectionTitle title="내 질문 현황" caption={`${latestQuestions.length}건`} headingId="my-questions-heading" />
        <div className={styles.followList}>
          {latestQuestions.map((question) => (
            <article key={question.id} className={styles.followListItem}>
              <MessageCircleQuestion size={15} />
              <div>
                <strong>{question.body}</strong>
                <span>{questionStatusMeta(question)}</span>
              </div>
            </article>
          ))}
          {latestQuestions.length === 0 && <p className={styles.emptyText}>아직 등록한 질문이 없습니다.</p>}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="팔로우한 장소" caption={`${followedPlaces.length}곳`} />
        <div className={styles.followList}>
          {followedPlaces.map((place) => (
            <article key={place.id} className={styles.followListItem}>
              <MapPin size={15} />
              <div>
                <strong>{place.name}</strong>
                <span>{place.signal} · {place.updated}</span>
              </div>
            </article>
          ))}
          {followedPlaces.length === 0 && <p className={styles.emptyText}>장소 상세에서 팔로우하면 여기에 모입니다.</p>}
        </div>
      </section>

      <section
        ref={hashtagsRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "hashtags" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="followed-tags-heading"
      >
        <SectionTitle title="팔로우한 해시태그" caption={`${followedHashtagNames.size}개`} headingId="followed-tags-heading" />
        <div className={styles.savedTagRow}>
          {[...followedHashtagNames].map((tag) => (
            <span key={tag}><Hash size={13} />#{tag}</span>
          ))}
          {followedHashtagNames.size === 0 && <p className={styles.emptyText}>관심 해시태그를 팔로우하면 재방문 피드가 생깁니다.</p>}
        </div>
      </section>

      <section
        ref={savedRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "saved" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="saved-posts-heading"
      >
        <SectionTitle title="저장한 게시물" caption={`${savedPosts.length}개`} headingId="saved-posts-heading" />
        <div className={styles.savedPostList}>
          {savedPosts.map((post) => (
            <article key={post.id} className={styles.savedPostItem}>
              <Bookmark size={15} />
              <div>
                <strong>{post.shareCard.headline}</strong>
                <span>{post.locationVerified ? "현장 인증" : "상태 제보"} · 도움돼요 {post.helpfulCount}</span>
              </div>
            </article>
          ))}
          {savedPosts.length === 0 && <p className={styles.emptyText}>피드에서 저장한 현장 게시물이 표시됩니다.</p>}
        </div>
      </section>

      <section
        ref={safetyRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "safety" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-safety-heading"
      >
        <SectionTitle title="안전 보호" caption="운영 정책 적용 중" headingId="my-safety-heading" />
        <div className={styles.safetyStatusGrid}>
          <div>
            <ShieldCheck size={17} />
            <strong>정확 좌표 비공개</strong>
            <span>현장 인증은 반경만 저장</span>
          </div>
          <div>
            <ShieldAlert size={17} />
            <strong>민감정보 우선 검토</strong>
            <span>얼굴, 차량번호, 접수번호 차단</span>
          </div>
          <div>
            <UserX size={17} />
            <strong>내 화면 숨김</strong>
            <span>{hiddenCreatorNames.size > 0 ? `${hiddenCreatorNames.size}명 숨김 상태` : "신고한 작성자 없음"}</span>
          </div>
        </div>
      </section>

      <section className={styles.menuList}>
        {menuItems.map((item) => (
          <MenuRow
            key={item.label}
            active={activeMenuTarget === item.target}
            icon={item.icon}
            label={item.label}
            onClick={() => handleMenuClick(item)}
          />
        ))}
      </section>
    </div>
  );
}

function OperatorPanel({
  hashtags,
  places,
  posts,
  questions,
}: {
  hashtags: PublicHashtag[];
  places: Place[];
  posts: PublicPost[];
  questions: Question[];
}) {
  return (
    <aside className={styles.operatorPanel}>
      <div className={styles.operatorHeader}>
        <div>
          <p className={styles.eyebrow}>운영 요약</p>
          <h2>전국 현장 요약</h2>
        </div>
      </div>

      <div className={styles.operatorMetrics}>
        <StatBox label="장소" value={String(places.length)} />
        <StatBox label="게시물" value={String(posts.length)} />
        <StatBox label="질문" value={String(questions.length)} />
      </div>

      <section className={styles.desktopMapCard}>
        <h3>실시간 지역 상태</h3>
        <div className={styles.miniMap}>
          {places.map((place) => (
            <span key={place.id} className={`${styles.desktopPin} ${styles[place.tone]}`} style={{ left: `${place.x}%`, top: `${place.y}%` }} />
          ))}
        </div>
      </section>

      <section className={styles.desktopQueue}>
        <h3>확산 중인 현장 피드</h3>
        {posts.slice(0, 3).map((post) => {
          const place = places.find((candidate) => candidate.id === post.placeId);

          return (
            <div key={post.id} className={styles.queueRow}>
              <span>{place?.name ?? "현장"}</span>
              <strong>{post.locationVerified ? "인증" : "미인증"}</strong>
            </div>
          );
        })}
        {posts.length === 0 && (
          <div className={styles.queueRow}>
            <span>아직 최근 제보가 없습니다</span>
            <strong>대기</strong>
          </div>
        )}
      </section>

      <section className={styles.desktopQueue}>
        <h3>해시태그 품질</h3>
        {hashtags.slice(0, 4).map((tag) => (
          <div key={tag.id} className={styles.queueRow}>
            <span>#{tag.name}</span>
            <strong>{tag.postCount}</strong>
          </div>
        ))}
      </section>
    </aside>
  );
}

function BottomNav({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav className={styles.bottomNav}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeView;
        return (
          <button key={item.id} className={`${styles.navButton} ${isActive ? styles.navActive : ""} ${item.id === "upload" ? styles.reportNav : ""}`} type="button" onClick={() => onChange(item.id)}>
            <Icon size={item.id === "upload" ? 22 : 19} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function OnboardingSheet({
  onClose,
  onGoMap,
  onGoReport,
}: {
  onClose: () => void;
  onGoMap: () => void;
  onGoReport: () => void;
}) {
  return (
    <div className={styles.onboardingOverlay} role="region" aria-label="#실시간 첫 방문 안내">
      <section className={styles.onboardingSheet}>
        <button className={styles.onboardingClose} type="button" onClick={onClose} aria-label="온보딩 닫기">
          <X size={16} />
        </button>
        <div>
          <span>처음 오셨나요?</span>
          <h2>사진으로 지금 장소 분위기를 확인하세요.</h2>
        </div>
        <ol>
          <li>방금 올라온 사진으로 사람, 주차, 줄을 확인합니다.</li>
          <li>해시태그로 웨이팅, 주차, 사진스팟을 빠르게 좁힙니다.</li>
          <li>현장 인증은 선택이고 정확한 좌표는 저장하지 않습니다.</li>
        </ol>
        <div className={styles.onboardingActions}>
          <button type="button" onClick={onClose}>바로 둘러보기</button>
          <button type="button" onClick={onGoMap}>사진 지도 보기</button>
          <button type="button" onClick={onGoReport}>지금컷 올리기</button>
        </div>
      </section>
    </div>
  );
}

function FlagReasonModal({
  onClose,
  onSubmit,
  title,
}: {
  onClose: () => void;
  onSubmit: (reason: FlagReason) => void;
  title: string;
}) {
  return (
    <div className={styles.flagModalOverlay} role="dialog" aria-modal="true" aria-label="신고 이유 선택">
      <section className={styles.flagModal}>
        <div className={styles.flagModalHeader}>
          <div>
            <p className={styles.eyebrow}>신고 사유 선택</p>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="신고 닫기">
            <X size={16} />
          </button>
        </div>
        <p className={styles.flagModalHelp}>개인정보, 차량번호, 민감정보는 1회 신고만으로도 임시 숨김 검토에 들어갑니다.</p>
        <div className={styles.flagReasonList}>
          {postFlagReasonOptions.map((reason) => (
            <button key={reason.id} type="button" onClick={() => onSubmit(reason.id)}>
              <strong>{reason.label}</strong>
              <span>{reason.body}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function LiveReportCard({ report, place, onOpen }: { report: Report; place: Place; onOpen?: () => void }) {
  return (
    <button className={styles.liveReportCard} type="button" onClick={onOpen}>
      <div className={`${styles.reportPhoto} ${styles[report.tone]}`}>
        {report.hasPhoto ? <Camera size={18} /> : <Sparkles size={18} />}
      </div>
      <div>
        <span className={`${styles.statusChip} ${styles[report.tone]}`}>{report.verified ? "현장 인증" : "상태 제보"}</span>
        <strong>{place.name}</strong>
        <p>{report.body}</p>
        <small>{report.meta}</small>
      </div>
    </button>
  );
}

function FeedPostCard({
  post,
  place,
  reports,
  onFlag,
  onHelpful,
  onOpenPlace,
  onSave,
  onShare,
  onSelectHashtag,
  helpfulActive,
  saved,
}: {
  post: PublicPost;
  place: Place;
  reports?: Pick<Report, "photoUrl" | "placeId" | "hasPhoto" | "createdAt">[];
  onFlag: () => void;
  onHelpful: () => void;
  onOpenPlace: () => void;
  onSave: () => void;
  onShare: () => void;
  onSelectHashtag: (hashtagName: string) => void;
  helpfulActive: boolean;
  saved: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const verificationTooltip = post.locationVerified
    ? "현장 인증: 실제 GPS와 장소 반경만 검증하고 정확한 좌표는 저장하지 않습니다."
    : "상태 제보: 위치 인증 없이 작성되어 판단에는 낮은 가중치로 반영됩니다.";
  const photoUrl = photoUrlForPost(post, reports ?? []);

  return (
    <article className={styles.feedPostCard}>
      <button className={styles.feedPhoto} style={photoBackgroundStyle(photoUrl)} type="button" onClick={onOpenPlace}>
        <span>{post.photoLabel}</span>
        <strong>{post.judgement}</strong>
      </button>
      <div className={styles.feedPostBody}>
        <div className={styles.feedPostHeader}>
          <button type="button" onClick={onOpenPlace}>
            <strong>{place.name}</strong>
            <span>{minutesAgo(post.createdAt)}</span>
          </button>
          <div className={styles.feedPostChips}>
            <span className={`${styles.statusChip} ${styles[place.tone]}`}>{postStatusText(post)}</span>
            <span className={`${styles.verificationChip} ${post.locationVerified ? styles.verificationVerified : styles.verificationReport}`} title={verificationTooltip}>
              {post.locationVerified ? <BadgeCheck size={12} /> : <MapPin size={12} />}
              {post.locationVerified ? "현장 인증" : "상태 제보"}
            </span>
          </div>
        </div>
        <p>{post.caption ?? `${place.name}의 현재 상태가 업데이트됐습니다.`}</p>
        <div className={styles.statusInline}>
          <span>사람 {crowdLabels[post.crowdLevel]}</span>
          <span>주차 {parkingLabels[post.parkingStatus]}</span>
          <span>줄 {lineLabels[post.lineStatus]}</span>
        </div>
        <div className={styles.feedHashtags}>
          {post.hashtagNames.slice(0, 3).map((tag) => (
            <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}>#{tag}</button>
          ))}
        </div>
        <div className={styles.feedActions}>
          <button className={helpfulActive ? styles.feedActionActive : ""} type="button" onClick={onHelpful}>
            <Heart size={15} />도움돼요 {post.helpfulCount}
          </button>
          <button
            className={actionsOpen ? styles.feedActionActive : ""}
            type="button"
            onClick={() => setActionsOpen((open) => !open)}
            aria-expanded={actionsOpen}
          >
            <MoreHorizontal size={15} />더보기
          </button>
        </div>
        {actionsOpen && (
          <div className={styles.feedSecondaryMenu}>
            <button className={saved ? styles.feedActionActive : ""} type="button" onClick={onSave}>
              <Bookmark size={15} />{saved ? "저장됨" : "저장"}
            </button>
            <button type="button" onClick={onShare}><Share2 size={15} />공유</button>
            <button type="button" onClick={onFlag}><Flag size={15} />신고</button>
          </div>
        )}
        {post.safetyWarning && (
          <div className={styles.safetyInline}>
            <ShieldAlert size={14} />
            <span>{post.safetyWarning}</span>
          </div>
        )}
      </div>
    </article>
  );
}

function AnswerableQuestions({ places, questions }: { places: Place[]; questions: Question[] }) {
  const pendingQuestions = questions.filter((question) => !question.answeredReportId).slice(0, 3);

  return (
    <section className={styles.sectionBlock}>
      <SectionTitle title="답변 가능한 질문" caption="답하면 +2" />
      <div className={styles.answerList}>
        {pendingQuestions.map((question) => {
          const place = places.find((item) => item.id === question.placeId) ?? places[0];
          return (
            <article key={question.id} className={styles.answerItem}>
              <MessageCircleQuestion size={18} />
              <div>
                <strong>{question.body}</strong>
                <p>{place.name} · {question.time}</p>
              </div>
              <span>{question.reward}</span>
            </article>
          );
        })}
        {pendingQuestions.length === 0 && <p className={styles.emptyText}>아직 답변 가능한 질문이 없습니다.</p>}
      </div>
    </section>
  );
}

function ChoiceGroup({ title, options, value, onChange }: { title: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <section className={styles.choiceGroup}>
      <h3>{title}</h3>
      <div>
        {options.map((option) => (
          <button key={option} className={value === option ? styles.choiceActive : ""} type="button" onClick={() => onChange(option)}>{option}</button>
        ))}
      </div>
    </section>
  );
}

function QuestionType({ icon: Icon, label, active = false, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button className={`${styles.questionType} ${active ? styles.questionTypeActive : ""}`} type="button" onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function StatusMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className={styles.statusMetric}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function verificationStatusCopy(status: LocationVerificationStatus) {
  if (status === "requesting") {
    return {
      title: "실제 위치 확인 중",
      body: "브라우저 위치 권한을 확인하고 있습니다.",
    };
  }

  if (status === "verified") {
    return {
      title: "GPS 좌표 준비됨",
      body: "등록 시 서버가 실제 사용자 좌표와 장소 거리를 계산합니다.",
    };
  }

  if (status === "denied") {
    return {
      title: "상태 제보로 등록",
      body: "위치 권한이 없어 현장 인증 배지는 붙지 않습니다.",
    };
  }

  if (status === "unsupported") {
    return {
      title: "위치 인증 미지원",
      body: "이 브라우저에서는 위치 없이 상태 제보만 등록합니다.",
    };
  }

  return {
    title: "현장 인증 선택",
    body: "누르면 실제 GPS를 요청합니다. 선택 장소 좌표는 쓰지 않습니다.",
  };
}

function SectionTitle({ title, caption, headingId }: { title: string; caption: string; headingId?: string }) {
  return (
    <div className={styles.sectionTitle}>
      <h2 id={headingId}>{title}</h2>
      <span>{caption}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statBox}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MenuRow({ active = false, icon: Icon, label, onClick }: { active?: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button className={`${styles.menuRow} ${active ? styles.menuRowActive : ""}`} type="button" onClick={onClick} aria-pressed={active}>
      <Icon size={18} />
      <span>{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}

function reportsFallback(place: Place): Report {
  return {
    id: `${place.id}-fallback`,
    placeId: place.id,
    title: place.name,
    body: "아직 최근 제보가 부족합니다. 현장에 있다면 첫 제보를 남겨주세요.",
    meta: "대기 중 · 사진 없음",
    tone: place.tone,
    verified: false,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
    hiddenAt: null,
    crowdLevel: place.crowdLevel,
    lineStatus: place.lineStatus,
    parkingStatus: place.parkingStatus,
    weatherFeel: place.weatherFeel,
  };
}

function mapPlaces(apiPlaces: ApiPlaceInput[], reports: Report[], questions: Question[]): Place[] {
  return apiPlaces.map((place, index) => {
    const latestReports = reports.filter((report) => report.placeId === place.id && !report.hiddenAt);
    const latest = latestReports[0];
    const presentation = presentationByPlaceId[place.id] ?? {
      distance: `${index + 1}.0km`,
      x: 30 + index * 12,
      y: 40 + index * 8,
    };
    const crowdLevel = latest?.crowdLevel ?? "normal";
    const lineStatus = latest?.lineStatus ?? "none";
    const parkingStatus = latest?.parkingStatus ?? "unknown";
    const weatherFeel = latest?.weatherFeel ?? "good";
    const reportCount = latestReports.length;
    const questionCount = questions.filter((question) => question.placeId === place.id && !question.answeredReportId).length;
    const tone = toneFromStatus(crowdLevel, parkingStatus);

    return {
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      region: place.region,
      distance: presentation.distance,
      status: crowdLabels[crowdLevel],
      signal: signalFromTone(tone),
      summary: latest?.body ?? `${crowdLabels[crowdLevel]} · 주차 ${parkingLabels[parkingStatus]} · 질문 ${questionCount}건`,
      crowd: crowdLabels[crowdLevel],
      parking: parkingLabels[parkingStatus],
      line: lineLabels[lineStatus],
      weather: weatherLabels[weatherFeel],
      crowdLevel,
      parkingStatus,
      lineStatus,
      weatherFeel,
      updated: latest?.meta.split(" · ")[0] ?? "정보 대기",
      score: Math.max(trustScoreForPlace(latestReports, questionCount), place.rankingScore ?? 0),
      x: presentation.x,
      y: presentation.y,
      tone,
      visitors: `${reportCount + questionCount}건`,
    };
  });
}

function mapReports(reports: PublicReport[], apiPlaces: ApiPlace[]): Report[] {
  return [...reports]
    .filter((report) => !report.hiddenAt)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((report) => {
      const place = apiPlaces.find((candidate) => candidate.id === report.placeId);
      const tone = toneFromStatus(report.crowdLevel, report.parkingStatus);
      const weatherFeel = report.weatherFeel ?? "good";

      return {
        id: report.id,
        placeId: report.placeId,
        title: place?.name ?? "지금컷",
        body: report.comment ?? `${crowdLabels[report.crowdLevel]} · 주차 ${parkingLabels[report.parkingStatus]}`,
        meta: `${minutesAgo(report.createdAt)} · ${report.verifiedRadiusM ? "현장 인증" : "미인증"} · ${report.photoUrl ? "사진 있음" : "사진 없음"}`,
        tone,
        verified: Boolean(report.verifiedRadiusM),
        hasPhoto: Boolean(report.photoUrl),
        photoUrl: report.photoUrl,
        createdAt: report.createdAt,
        hiddenAt: report.hiddenAt ?? null,
        crowdLevel: report.crowdLevel,
        lineStatus: report.lineStatus,
        parkingStatus: report.parkingStatus,
        weatherFeel,
      } satisfies Report & Pick<PublicReport, "crowdLevel" | "lineStatus" | "parkingStatus">;
    });
}

function mapQuestions(questions: PublicQuestion[]): Question[] {
  return [...questions]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((question) => ({
      id: question.id,
      placeId: question.placeId,
      body: question.body,
      reward: question.questionType === "photo_request" ? "+2" : "+1",
      time: minutesAgo(question.createdAt),
      questionType: question.questionType,
      answeredReportId: question.answeredReportId,
    }));
}

function filterPlaces(places: Place[], filter: string) {
  if (filter === "사람 많음") {
    return places.filter((place) => place.crowdLevel === "busy" || place.crowdLevel === "packed");
  }

  if (filter === "주차 만차") {
    return places.filter((place) => place.parkingStatus === "full");
  }

  if (filter === "줄 있음") {
    return places.filter((place) => place.lineStatus === "medium" || place.lineStatus === "long");
  }

  if (filter === "사진/상태 있음") {
    return places.filter((place) => Number.parseInt(place.visitors, 10) > 0 || place.score > 0);
  }

  return places;
}

function searchPlaces(places: Place[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  if (!normalizedQuery) {
    return places;
  }

  return places.filter((place) =>
    [place.name, place.address, place.summary, place.status, place.signal]
      .join(" ")
      .toLocaleLowerCase("ko-KR")
      .includes(normalizedQuery),
  );
}

function normalizePlaceSearchQuery(query: string | null | undefined) {
  const normalizedQuery = query?.trim() ?? "";

  return normalizedQuery.length > 0 ? normalizedQuery : undefined;
}

function filterPlacesByRegion(places: Place[], region: RegionTabId) {
  if (region === "nationwide") {
    return places;
  }

  return places.filter((place) => place.region === region);
}

function rankPlaces(places: Place[]) {
  return [...places].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko")).slice(0, 10);
}

function isPlaceInBounds(place: Place, bounds: MapBounds) {
  return place.latitude <= bounds.north && place.latitude >= bounds.south && place.longitude <= bounds.east && place.longitude >= bounds.west;
}

function mapBoundsToBboxParam(bounds: MapBounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map(formatBoundsCoordinate).join(",");
}

function formatBoundsCoordinate(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function areMapBoundsEquivalent(current: MapBounds | null, next: MapBounds) {
  return current ? mapBoundsToBboxParam(current) === mapBoundsToBboxParam(next) : false;
}

function commentsForPlace(posts: PublicPost[], reports: Report[]): PlaceComment[] {
  const postComments = posts
    .filter((post) => post.caption)
    .map((post) => ({
      id: `post:${post.id}`,
      author: post.creatorName,
      body: post.caption ?? "",
      meta: `${minutesAgo(post.createdAt)} · 도움 ${post.helpfulCount}`,
      verified: post.locationVerified,
    }));
  const reportComments = reports.map((report) => ({
    id: `report:${report.id}`,
    author: report.verified ? "현장 인증 제보자" : "상태 제보자",
    body: report.body,
    meta: report.meta,
    verified: report.verified,
  }));

  return [...postComments, ...reportComments].slice(0, 8);
}

function workerCommentToPlaceComment(comment: WorkerComment): PlaceComment {
  return {
    id: `worker:${comment.id}`,
    author: "익명 현장러",
    body: comment.body,
    meta: `${minutesAgo(comment.createdAt)} · 도움 ${comment.likeCount}`,
    verified: false,
    likeCount: comment.likeCount,
    liked: false,
    workerCommentId: comment.id,
  };
}

function updateCommentMetaLikeCount(meta: string, likeCount: number) {
  const nextLikeMeta = `도움 ${likeCount}`;
  if (/도움 \d+/.test(meta)) {
    return meta.replace(/도움 \d+/, nextLikeMeta);
  }

  return `${meta} · ${nextLikeMeta}`;
}

function photosForPlace(posts: PublicPost[], reports: Report[], workerPhotos: WorkerPhoto[] = []): PlacePhoto[] {
  const uploadedPhotos = workerPhotos
    .filter((photo) => photo.status === "ready")
    .map((photo) => ({
      id: `photo:${photo.id}`,
      label: "방금 올린 현장 사진",
      meta: `${minutesAgo(photo.createdAt)} · 클릭 ${photo.clickCount}`,
      ownedByCurrentSession: photo.ownedByCurrentSession,
      previewUrl: photo.previewUrl ?? undefined,
      workerPhotoId: photo.id,
    }));
  const postPhotos = posts
    .filter((post) => post.photoCount > 0)
    .map((post) => ({
      id: `post:${post.id}`,
      label: post.photoLabel,
      meta: `${minutesAgo(post.createdAt)} · ${post.creatorBadge}`,
      previewUrl: post.previewUrl ?? undefined,
    }));
  const reportPhotos = reports
    .filter((report) => report.hasPhoto)
    .map((report) => ({
      id: `report:${report.id}`,
      label: report.title,
      meta: report.meta,
      previewUrl: report.photoUrl ?? undefined,
    }));

  return [...uploadedPhotos, ...postPhotos, ...reportPhotos].slice(0, 6);
}

type PhotoBackgroundStyle = CSSProperties & {
  "--photo-url"?: string;
};

function photoBackgroundStyle(photoUrl: string | null | undefined): PhotoBackgroundStyle | undefined {
  if (!photoUrl) {
    return undefined;
  }

  return { "--photo-url": `url(${JSON.stringify(photoUrl)})` };
}

function photoUrlForPost(post: PublicPost, reports: Pick<Report, "photoUrl" | "placeId" | "hasPhoto" | "createdAt">[]) {
  if (post.previewUrl) {
    return post.previewUrl;
  }

  return reports.find((report) => report.placeId === post.placeId && report.hasPhoto)?.photoUrl ?? null;
}

function sensitivePhotoWarningFor(place: Pick<Place, "category">): string | null {
  if (place.category === "hospital") {
    return "병원 사진은 환자 얼굴, 이름, 접수번호, 처방전, 진료 정보가 보이면 올릴 수 없습니다.";
  }

  if (place.category === "public_office") {
    return "관공서 사진은 민원 서류, 신분증, 차량번호, 직원 명찰, 민원인 얼굴이 보이면 올릴 수 없습니다.";
  }

  return null;
}

function mergeWorkerPhotos(primary: WorkerPhoto[], secondary: WorkerPhoto[]): WorkerPhoto[] {
  const byId = new Map<string, WorkerPhoto>();
  [...secondary, ...primary].forEach((photo) => {
    byId.set(photo.id, photo);
  });

  return [...byId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function filterWorkerPhotosByPlaceIds(photos: WorkerPhoto[], placeIds: string[]): WorkerPhoto[] {
  const allowedPlaceIds = new Set(placeIds);

  return photos.filter((photo) => allowedPlaceIds.has(photo.placeId));
}

async function fetchWorkerPhotosForPlaces(placeIds: string[]): Promise<WorkerPhoto[]> {
  const scopedPlaceIds = [...new Set(placeIds.filter(Boolean))].slice(0, workerPhotoPlaceScopeLimit);
  if (scopedPlaceIds.length === 0) {
    return [];
  }

  const photoGroups = await Promise.all(
    scopedPlaceIds.map((placeId) =>
      fetchJson<WorkerPhoto[]>(
        cloudflareApiUrl(
          buildScopedApiPath("/api/photos", {
            placeId,
            limit: workerPhotoLimitPerPlace,
          }),
        ),
      ).catch(() => []),
    ),
  );

  return photoGroups.flat();
}

function locationPermissionCopy(permission: LocationPermissionState) {
  if (permission === "requesting") {
    return {
      title: "현재 위치를 확인하고 있어요",
      body: "좌표는 지도 중심과 현재 위치 마커에만 사용하고 서버로 보내지 않습니다.",
    };
  }

  if (permission === "granted") {
    return {
      title: "현재 위치 기준으로 보는 중",
      body: "원본 좌표는 브라우저 안에서만 사용됩니다. 제보 등록은 별도 인증 단계에서 진행됩니다.",
    };
  }

  if (permission === "denied") {
    return {
      title: "위치 권한 없이 전국 랭킹을 계속 보여드려요",
      body: "지역 탭을 직접 바꾸면 해당 지역 후보만 좁혀 볼 수 있습니다.",
    };
  }

  if (permission === "unsupported") {
    return {
      title: "이 브라우저는 위치 확인을 지원하지 않아요",
      body: "지역 탭과 지도 이동으로 실시간 장소를 탐색할 수 있습니다.",
    };
  }

  return {
    title: "현재 위치로 주변 흐름 보기",
    body: "허용해도 원본 좌표는 서버로 보내지 않고 지도 UI에만 사용합니다.",
  };
}

function postStatusText(post: Pick<PublicPost, "crowdLevel" | "parkingStatus">) {
  if (post.crowdLevel === "packed" || post.parkingStatus === "full") {
    return "지금은 비추";
  }

  if (post.crowdLevel === "busy" || post.parkingStatus === "limited") {
    return "주의";
  }

  return "가도 좋음";
}

function postMatchesFeedTab(post: PublicPost, place: Place | undefined, tab: FeedTab) {
  if (tab === "전체") {
    return true;
  }

  if (tab === "내 주변") {
    return distanceKmFromLabel(place?.distance) <= 5;
  }

  if (tab === "관광지") {
    return place?.category === "tourism";
  }

  if (tab === "주차") {
    return post.parkingStatus === "full" || post.parkingStatus === "limited" || post.hashtagNames.some((tag) => tag.includes("주차"));
  }

  return true;
}

function distanceKmFromLabel(distance: string | undefined) {
  if (!distance) {
    return Number.POSITIVE_INFINITY;
  }

  const value = Number.parseFloat(distance.replace(/[^\d.]/g, ""));

  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function minutesAgo(createdAt: string) {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000));

  if (diffMinutes >= 60) {
    return `${Math.round(diffMinutes / 60)}시간 전`;
  }

  return `${diffMinutes}분 전`;
}

function toneFromStatus(crowdLevel: CrowdLevel, parkingStatus: ParkingStatus): StatusTone {
  if (crowdLevel === "packed" || parkingStatus === "full") {
    return "danger";
  }

  if (crowdLevel === "busy" || parkingStatus === "limited") {
    return "busy";
  }

  if (crowdLevel === "quiet") {
    return "calm";
  }

  return "normal";
}

function signalFromTone(tone: StatusTone) {
  if (tone === "calm") return "가도 좋음";
  if (tone === "normal") return "대기 보통";
  if (tone === "busy") return "혼잡 주의";
  return "출발 전 확인";
}

function scrollNearestContainerToChild(child: HTMLElement | null) {
  if (!child) {
    return;
  }

  const scrollParent = findVerticalScrollParent(child);
  if (!scrollParent) {
    child.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }

  const parentRect = scrollParent.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const top = Math.max(0, scrollParent.scrollTop + childRect.top - parentRect.top - 8);

  scrollParent.scrollTo({ top, behavior: "smooth" });
}

function findVerticalScrollParent(element: HTMLElement) {
  let current = element.parentElement;

  while (current) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight;

    if (canScroll) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function trustScoreForPlace(reports: Report[], questionCount: number) {
  const verified = reports.filter((report) => report.verified).length;
  const photos = reports.filter((report) => report.hasPhoto).length;

  return Math.min(60 + verified * 8 + photos * 5 + questionCount * 2, 98);
}

function toggleSetValue<TValue>(set: Set<TValue>, value: TValue) {
  const next = new Set(set);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function readPersistedSet(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return new Set<string>();
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function persistSet(key: string, set: Set<string>) {
  window.localStorage.setItem(key, JSON.stringify([...set]));
}

function crowdValueFromLabel(label: string): CrowdLevel {
  if (label === "사람 없음") return "quiet";
  if (label === "매우 많음") return "packed";
  if (label === "많음") return "busy";
  return "normal";
}

function parkingValueFromLabel(label: string): ParkingStatus {
  if (label === "만차") return "full";
  if (label === "거의 없음") return "limited";
  if (label === "널널" || label === "여유 있음") return "available";
  return "unknown";
}

function lineValueFromLabel(label: string): LineStatus {
  if (label === "매우 김") return "long";
  if (label === "있음" || label === "보통") return "medium";
  return "none";
}

function weatherValueFromLabel(label: string): WeatherFeel {
  if (label === "비") return "rainy";
  return "good";
}

function questionTypeFromText(text: string): QuestionType {
  if (text.includes("사진")) return "photo_request";
  if (text.includes("주차")) return "parking";
  if (text.includes("줄") || text.includes("대기") || text.includes("웨이팅")) return "line";
  if (text.includes("날씨") || text.includes("비")) return "weather";
  if (text.includes("사람") || text.includes("혼잡")) return "crowd";
  return "other";
}

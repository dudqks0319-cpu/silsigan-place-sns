"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bookmark,
  Camera,
  Car,
  ChevronRight,
  CircleParking,
  Clock,
  CloudSun,
  Filter,
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
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudflareApiUrl, fetchJson, isCloudflareApiConfigured, isLocalCloudflareApiConfigured } from "@/lib/api-client";
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
  RegionId,
  ReportCategory,
  ShareCard,
  UserReputation,
  WeatherFeel,
} from "@/lib/domain";
import { getSiteUrl } from "@/lib/site-url";
import { CurrentLocationButton, type LocationPermissionState, type UiLocation } from "./CurrentLocationButton";
import { EmptyState as SharedEmptyState } from "./EmptyState";
import { contentSafetyWarningFor } from "./contentSafety";
import { crowdLabels, lineLabels, parkingLabels, weatherLabels } from "./labels";
import { NaverMap, type MapBounds, type MapFocusTarget } from "./NaverMap";
import { PlaceDetailSheet } from "./PlaceDetailSheet";
import type { PlaceComment } from "./CommentFeed";
import { PhotoUploader, type PlacePhoto, type PreparedPhotoUpload } from "./PhotoUploader";
import { RankingPanel } from "./RankingPanel";
import { RegionTabs, type RegionTabId } from "./RegionTabs";
import styles from "./SilsiganRedesign.module.css";

type View = "home" | "search" | "map" | "place" | "report" | "ask" | "my";
type StatusTone = "calm" | "normal" | "busy" | "danger";
type Category = ReportCategory;
type ApiPlaceInput = ApiPlace & {
  rankingScore?: number;
};

type TourismWorkerPlace = WorkerPlace & {
  source?: "tourapi" | "tourapi-fallback";
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

type FieldReportSubmitResult = {
  report: PublicReport;
  credits: { amount: number }[];
  safetyWarning: string | null;
  privacyNotice: string;
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

type UploadActivity = {
  id: string;
  placeId: string;
  placeName: string;
  caption: string;
  status: "reflected" | "failed";
  message: string;
  createdAt: string;
};

type ModerationActivity = {
  id: string;
  targetType: "place" | "comment" | "photo" | "post";
  targetName: string;
  reason: FlagReason;
  status: "queued" | "hidden" | "local-preview";
  message: string;
  createdAt: string;
};

type WorkerComment = {
  id: string;
  placeId: string;
  body: string;
  likeCount: number;
  createdAt: string;
};

type MyMenuTarget = "reports" | "questions" | "saved" | "hashtags" | "badges" | "moderation" | "safety";
type FeedTab = (typeof feedTabLabels)[number];
type SearchResultTab = "장소" | "해시태그" | "사진";

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
  targetType: "place" | "comment" | "photo";
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

type MapSearchFocusTarget = MapFocusTarget & {
  keywords: string[];
};

const presentationByPlaceId: Record<string, Pick<Place, "distance" | "x" | "y">> = {
  "busan-gwangalli": { distance: "38km", x: 58, y: 44 },
  "busan-haeundae": { distance: "42km", x: 68, y: 42 },
  "busan-jeonpo-cafe": { distance: "39km", x: 54, y: 50 },
  "busan-seomyeon": { distance: "39km", x: 51, y: 53 },
  "busan-nampo-kkangtong": { distance: "45km", x: 47, y: 62 },
  "busan-songjeong": { distance: "47km", x: 74, y: 38 },
  "gyeongju-hwangridan": { distance: "29km", x: 43, y: 33 },
  "gyeongju-cheomseongdae": { distance: "30km", x: 48, y: 35 },
  "gyeongju-donggung-wolji": { distance: "31km", x: 52, y: 37 },
  "ulsan-taehwagang": { distance: "1.2km", x: 32, y: 57 },
  "ulsan-samsan": { distance: "2.4km", x: 37, y: 64 },
  "ulsan-ganjeolgot": { distance: "28km", x: 66, y: 72 },
  "ulsan-city-hall": { distance: "2.1km", x: 35, y: 69 },
};

const navItems: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "홈", icon: Home },
  { id: "search", label: "검색", icon: Search },
  { id: "report", label: "올리기", icon: Plus },
  { id: "map", label: "지도", icon: MapIcon },
  { id: "my", label: "마이", icon: User },
];

const filterLabels = ["전체", "사람 많음", "주차 만차", "줄 있음", "사진 있음"];
const feedTabLabels = ["전체", "서울", "부산", "제주", "내 주변"] as const;
const homeHashtagChips = ["주차만차", "웨이팅", "한산함", "사진스팟", "야경", "비오는날"] as const;
const uploadStepLabels = ["사진 선택", "장소 선택", "해시태그 선택", "한 줄 입력", "올리기"] as const;
const questionExamples = ["주차 자리 있나요?", "줄 많이 긴가요?", "사진으로 볼 수 있나요?", "아이랑 가도 괜찮나요?"];
const launchRegionIds = new Set<RegionId>(["busan", "gyeongju", "ulsan"]);
const launchRegionBounds: Partial<Record<RegionId, MapBounds>> = {
  busan: { north: 35.24, south: 35.05, east: 129.25, west: 128.96 },
  gyeongju: { north: 35.9, south: 35.78, east: 129.29, west: 129.16 },
  ulsan: { north: 35.62, south: 35.3, east: 129.46, west: 129.24 },
};
const launchFocusPlaces = [
  "광안리해수욕장",
  "해운대해수욕장",
  "전포카페거리",
  "서면",
  "남포동/깡통시장",
  "송정",
  "황리단길",
  "첨성대",
  "동궁과 월지",
  "태화강 국가정원",
  "울산 삼산동",
  "간절곶",
] as const;
const launchShareCard = {
  headline: "도착해서 후회하지 말고, 출발 전에 #실시간",
  body: "부산·경주·울산 먼저. 주차, 사람, 줄, 사진 제보를 출발 전 10초 안에 확인하세요.",
  hashtags: ["광안리주차", "황리단길웨이팅", "해운대혼잡", "태화강산책"],
} as const;
const mapSearchFocusTargets: MapSearchFocusTarget[] = [
  {
    id: "ulsan-nam-samsan",
    label: "울산 남구 삼산동",
    latitude: 35.5396,
    longitude: 129.3387,
    zoom: 14,
    keywords: ["울산 남구 삼산동", "울산남구삼산동", "삼산동", "삼산"],
  },
  {
    id: "ulsan-ganjeolgot",
    label: "울산 간절곶",
    latitude: 35.359,
    longitude: 129.36,
    zoom: 14,
    keywords: ["간절곶", "울산 간절곶"],
  },
  {
    id: "ulsan-nam",
    label: "울산 남구",
    latitude: 35.5438,
    longitude: 129.3309,
    zoom: 12,
    keywords: ["울산 남구", "울산남구"],
  },
  {
    id: "ulsan",
    label: "울산",
    latitude: 35.5384,
    longitude: 129.3114,
    zoom: 11,
    keywords: ["울산", "울산광역시"],
  },
  {
    id: "busan-gwangalli",
    label: "부산 광안리",
    latitude: 35.1532,
    longitude: 129.1186,
    zoom: 14,
    keywords: ["부산 광안리", "광안리", "광안리해수욕장"],
  },
  {
    id: "busan-haeundae",
    label: "부산 해운대해수욕장",
    latitude: 35.1587,
    longitude: 129.1604,
    zoom: 14,
    keywords: ["해운대", "해운대해수욕장", "부산 해운대"],
  },
  {
    id: "busan-jeonpo-cafe",
    label: "부산 전포카페거리",
    latitude: 35.1577,
    longitude: 129.064,
    zoom: 15,
    keywords: ["전포", "전포카페거리", "부산 전포"],
  },
  {
    id: "busan-seomyeon",
    label: "부산 서면",
    latitude: 35.1579,
    longitude: 129.0592,
    zoom: 14,
    keywords: ["서면", "부산 서면"],
  },
  {
    id: "busan-nampo",
    label: "부산 남포동/깡통시장",
    latitude: 35.1028,
    longitude: 129.0287,
    zoom: 14,
    keywords: ["남포동", "깡통시장", "부평깡통시장", "부산 남포"],
  },
  {
    id: "busan-songjeong",
    label: "부산 송정",
    latitude: 35.1786,
    longitude: 129.1997,
    zoom: 14,
    keywords: ["송정", "송정해수욕장", "부산 송정"],
  },
  {
    id: "busan",
    label: "부산",
    latitude: 35.1796,
    longitude: 129.0756,
    zoom: 11,
    keywords: ["부산", "부산광역시"],
  },
  {
    id: "gyeongju-hwangridan",
    label: "경주 황리단길",
    latitude: 35.8382,
    longitude: 129.2098,
    zoom: 15,
    keywords: ["황리단길", "경주 황리단길"],
  },
  {
    id: "gyeongju-cheomseongdae",
    label: "경주 첨성대",
    latitude: 35.8347,
    longitude: 129.2189,
    zoom: 15,
    keywords: ["첨성대", "경주 첨성대"],
  },
  {
    id: "gyeongju-donggung-wolji",
    label: "경주 동궁과 월지",
    latitude: 35.8346,
    longitude: 129.2265,
    zoom: 15,
    keywords: ["동궁과월지", "동궁과 월지", "안압지", "경주 동궁"],
  },
  {
    id: "gyeongju",
    label: "경주",
    latitude: 35.8562,
    longitude: 129.2247,
    zoom: 12,
    keywords: ["경주", "경주시"],
  },
];
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
    label: "사진스팟 좋아요",
    description: "사진 찍기 좋은 상태예요.",
    patch: { pickedCrowd: "보통", pickedWeather: "맑음", reportText: "사진 찍기 좋은 상태예요.", photoAttached: true },
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
const uploadActivityKey = "silsigan.uploadActivities.v1";
const moderationActivityKey = "silsigan.moderationActivities.v1";
const notificationEnabledKey = "silsigan.notificationEnabled.v1";
const firstVisitSeenKey = "silsigan.firstVisitSeen.v1";
const workerPhotoPlaceScopeLimit = 20;
const workerPhotoLimitPerPlace = 12;

async function copyTextToClipboard(text: string, clipboard?: Clipboard): Promise<"clipboard" | "exec_command"> {
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return "clipboard";
    } catch {
      return copyTextWithSelection(text);
    }
  }

  return copyTextWithSelection(text);
}

function copyTextWithSelection(text: string): "exec_command" {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Clipboard copy command failed");
    }
    return "exec_command";
  } finally {
    textarea.remove();
  }
}
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
    title: "황리단길 웨이팅 제보",
    hashtagName: "황리단길웨이팅",
    region: "gyeongju",
    description: "카페와 골목 대기 상황을 짧게 제보해 주세요.",
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
    rewardBadge: "태화강 제보왕",
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

export default function SilsiganRedesign() {
  const [activeView, setActiveView] = useState<View>("home");
  const phoneBodyRef = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [tourismPlaces, setTourismPlaces] = useState<Place[]>([]);
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
  const [toast, setToast] = useState("방금 올라온 장소 사진으로 오늘 갈 곳의 분위기를 확인하세요.");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickedCrowd, setPickedCrowd] = useState("많음");
  const [pickedParking, setPickedParking] = useState("거의 없음");
  const [pickedLine, setPickedLine] = useState("있음");
  const [pickedWeather, setPickedWeather] = useState("맑음");
  const [photoAttached, setPhotoAttached] = useState(true);
  const [locationVerificationStatus, setLocationVerificationStatus] = useState<LocationVerificationStatus>("idle");
  const [verifiedLocation, setVerifiedLocation] = useState<ClientLocation | null>(null);
  const [selectedHashtagName, setSelectedHashtagName] = useState<string | null>(null);
  const [followedPlaceIds, setFollowedPlaceIds] = useState<Set<string>>(() => new Set());
  const [followedHashtagNames, setFollowedHashtagNames] = useState<Set<string>>(() => new Set());
  const [helpfulPostIds, setHelpfulPostIds] = useState<Set<string>>(() => new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(() => new Set());
  const [uploadActivities, setUploadActivities] = useState<UploadActivity[]>([]);
  const [moderationActivities, setModerationActivities] = useState<ModerationActivity[]>([]);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pendingFlagPost, setPendingFlagPost] = useState<PublicPost | null>(null);
  const [pendingModerationTarget, setPendingModerationTarget] = useState<PendingModerationTarget | null>(null);
  const [activeRegion, setActiveRegion] = useState<RegionTabId>("nationwide");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const mapBoundsRef = useRef<MapBounds | null>(null);
  const lastMapBoundsFetchKeyRef = useRef("");
  const previousMapSearchQueryRef = useRef("");
  const [mapPreviewPlaceId, setMapPreviewPlaceId] = useState("");
  const [mapLocationPermission, setMapLocationPermission] = useState<LocationPermissionState>("idle");
  const [mapCurrentLocation, setMapCurrentLocation] = useState<UiLocation | null>(null);
  const [likedPlaceIds, setLikedPlaceIds] = useState<Set<string>>(() => new Set());
  const [liveConnection, setLiveConnection] = useState<"connecting" | "live" | "polling">("polling");
  const [realtimeEventsByPlaceId, setRealtimeEventsByPlaceId] = useState<Record<string, CloudflareRealtimeEvent[]>>({});
  const cloudflareApiConfigured = useMemo(() => isCloudflareApiConfigured(), []);
  const localCloudflareApiConfigured = useMemo(() => isLocalCloudflareApiConfigured(), []);
  const activeDataRegionId = useMemo(() => normalizeRegionScope(activeRegion), [activeRegion]);
  const mapBoundsKey = mapBounds ? mapBoundsToBboxParam(mapBounds) : "";
  const normalizedMapSearchQuery = useMemo(() => normalizePlaceSearchQuery(mapSearchQuery) ?? "", [mapSearchQuery]);

  const rankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        posts.map((post) => ({
          ...post,
          helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
        })),
      ),
    [helpfulPostIds, posts],
  );

  const allRankedPosts = useMemo(
    () =>
      rankPostsForFeed(
        allPosts.map((post) => ({
          ...post,
          helpfulCount: post.helpfulCount + (helpfulPostIds.has(post.id) ? 1 : 0),
        })),
      ),
    [allPosts, helpfulPostIds],
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
      const readConfiguredJson = <T,>(path: string) =>
        cloudflareApiConfigured
          ? fetchJson<T>(cloudflareApiUrl(path)).catch((error) => {
              if (!localCloudflareApiConfigured) {
                throw error;
              }

              return fetchJson<T>(path);
            })
          : fetchJson<T>(path);
      const placesPath = buildScopedApiPath("/api/places", placesScope);
      const placesRequest: Promise<ApiPlaceInput[]> = cloudflareApiConfigured
        ? fetchJson<WorkerPlace[]>(cloudflareApiUrl(placesPath))
            .then(workerPlacesToAppPlaces)
            .catch((error) => {
              if (!localCloudflareApiConfigured) {
                throw error;
              }

              return fetchJson<ApiPlace[]>(placesPath);
            })
        : fetchJson<ApiPlace[]>(placesPath);
      const reportsRequest = readConfiguredJson<PublicReport[]>(buildScopedApiPath("/api/reports", listScope));
      const tourismPath = buildScopedApiPath("/api/tourism/attractions", {
        regionId: activeDataRegionId,
        limit: 20,
        bbox: options.bounds ? mapBoundsToBboxParam(options.bounds) : undefined,
      });
      const tourismRequest: Promise<ApiPlaceInput[]> = cloudflareApiConfigured
        ? fetchJson<TourismWorkerPlace[]>(
            cloudflareApiUrl(tourismPath),
          )
            .then(workerPlacesToAppPlaces)
            .catch(() => {
              if (!localCloudflareApiConfigured) {
                return [];
              }

              return fetchJson<ApiPlace[]>(tourismPath).catch(() => []);
            })
        : fetchJson<ApiPlace[]>(tourismPath).catch(() => []);
      const postsRequest = readConfiguredJson<PublicPost[]>(buildScopedApiPath("/api/posts", listScope));
      const hashtagsRequest = readConfiguredJson<PublicHashtag[]>("/api/hashtags");
      const questionsRequest = readConfiguredJson<PublicQuestion[]>(buildScopedApiPath("/api/questions", listScope));
      const myQuestionsRequest = readConfiguredJson<MyQuestion[]>("/api/my-questions").catch(() => []);
      const [apiPlaces, apiReports, apiTourismPlaces, apiPosts, apiHashtags, apiQuestions, apiMyQuestions] = await Promise.all([
        placesRequest,
        reportsRequest,
        tourismRequest,
        postsRequest,
        hashtagsRequest,
        questionsRequest,
        myQuestionsRequest,
      ]);
      const mappedReports = mapReports(apiReports, apiPlaces);
      const mappedQuestions = mapQuestions(apiQuestions);
      const mappedBasePlaces = mapPlaces(apiPlaces, mappedReports, mappedQuestions);
      const mappedTourismPlaces = mapPlaces(uniqueApiPlacesById(apiTourismPlaces, new Set(apiPlaces.map((place) => place.id))), [], []);
      const mappedPlaces = mergePlaceLists(filterPlacesByRegion(mappedBasePlaces, activeRegion), filterPlacesByRegion(mappedTourismPlaces, activeRegion));
      const scopedPlaceIds = mappedPlaces.map((place) => place.id);
      const scopedPlaceIdSet = new Set(scopedPlaceIds);
      const scopedReports = mappedReports.filter((report) => scopedPlaceIdSet.has(report.placeId));
      const scopedPosts = apiPosts.filter((post) => scopedPlaceIdSet.has(post.placeId));
      const scopedQuestions = mappedQuestions.filter((question) => scopedPlaceIdSet.has(question.placeId));
      const apiWorkerPhotos = cloudflareApiConfigured ? await fetchWorkerPhotosForPlaces(scopedPlaceIds) : [];

      setPlaces(mappedPlaces);
      setTourismPlaces(filterPlacesByRegion(mappedTourismPlaces, activeRegion));
      setReports(scopedReports);
      setPosts(scopedPosts);
      setAllPosts(scopedPosts);
      setWorkerPhotos((current) => mergeWorkerPhotos(apiWorkerPhotos, filterWorkerPhotosByPlaceIds(current, scopedPlaceIds)).slice(0, 80));
      setHashtags(filterHashtagsByPosts(apiHashtags, scopedPosts));
      setQuestions(scopedQuestions);
      setMyQuestions(apiMyQuestions);
      setSelectedPlaceId((current) => mappedPlaces.find((place) => place.id === current)?.id ?? mappedPlaces[0]?.id ?? "");
    } catch (error) {
      if (!options.silent) {
        setToast(error instanceof Error ? error.message : "실시간 데이터를 불러오지 못했습니다.");
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [activeDataRegionId, activeRegion, cloudflareApiConfigured, localCloudflareApiConfigured]);

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
      setUploadActivities(readPersistedUploadActivities(uploadActivityKey));
      setModerationActivities(readPersistedModerationActivities(moderationActivityKey));
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

    persistUploadActivities(uploadActivityKey, uploadActivities);
  }, [persistenceReady, uploadActivities]);

  useEffect(() => {
    if (!persistenceReady) return;

    persistModerationActivities(moderationActivityKey, moderationActivities);
  }, [moderationActivities, persistenceReady]);

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
    setActiveView("report");
    setToast(`${place.name} 현장 제보를 작성합니다. 위치 인증은 선택 사항입니다.`);
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
        body: JSON.stringify({ source, place: placeClickPayload(place) }),
      });
    } catch (error) {
      if (localCloudflareApiConfigured) {
        return;
      }

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
      if (localCloudflareApiConfigured) {
        if (!wasLiked) {
          appendRealtimeEvent(place.id, "place.liked", new Date().toISOString(), { placeId: place.id, source: "local-preview" });
        }
        setToast(wasLiked ? `${place.name} 좋아요를 해제했습니다.` : `${place.name} 좋아요가 로컬 미리보기로 반영됐습니다.`);
        return;
      }

      setLikedPlaceIds((current) => toggleSetValue(current, place.id));
      setToast(error instanceof Error ? error.message : "좋아요 반영에 실패했습니다.");
    }
  };

  const reportMapPlace = async (place: Place) => {
    trackEvent("report_abuse", { targetType: "place", targetId: place.id, reason: "other" });

    if (!cloudflareApiConfigured) {
      recordModerationActivity({
        targetType: "place",
        targetName: place.name,
        reason: "other",
        status: "local-preview",
        message: "운영 검토 큐 연결 대기",
      });
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
      recordModerationActivity({
        targetType: "place",
        targetName: place.name,
        reason: "other",
        status: "queued",
        message: "운영 검토 큐 접수",
        createdAt: report.createdAt,
      });
      appendRealtimeEvent(place.id, "report.created", report.createdAt, { id: report.id, placeId: place.id, targetType: report.targetType });
      setToast(`${place.name} 신고가 운영 검토 큐에 접수됐습니다.`);
    } catch (error) {
      if (localCloudflareApiConfigured) {
        recordModerationActivity({
          targetType: "place",
          targetName: place.name,
          reason: "other",
          status: "local-preview",
          message: "staging 검증 전 로컬 기록",
        });
        appendRealtimeEvent(place.id, "report.created", new Date().toISOString(), { placeId: place.id, targetType: "place", source: "local-preview" });
        setToast(`${place.name} 신고가 로컬 미리보기로 기록됐습니다. staging에서는 운영 검토 큐에 연결됩니다.`);
        return;
      }

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
      recordModerationActivity({
        targetType: target.targetType,
        targetName: target.title,
        reason,
        status: "local-preview",
        message: "Worker API base 설정 후 큐 접수",
      });
      appendRealtimeEvent(target.placeId, "report.created", new Date().toISOString(), {
        placeId: target.placeId,
        targetType: target.targetType,
        targetId: target.targetId,
        source: "local-preview",
      });
      setToast("Worker API base 설정 후 운영 검토 큐에 접수됩니다.");
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
      recordModerationActivity({
        targetType: report.targetType,
        targetName: target.title,
        reason,
        status: "queued",
        message: "운영 검토 큐 접수",
        createdAt: report.createdAt,
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

  const recordUploadActivity = (activity: Omit<UploadActivity, "id" | "createdAt">) => {
    setUploadActivities((current) => [
      {
        ...activity,
        id: `upload-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 20));
  };

  const recordModerationActivity = (activity: Omit<ModerationActivity, "id" | "createdAt"> & { createdAt?: string }) => {
    setModerationActivities((current) => [
      {
        ...activity,
        id: `moderation-${Date.now()}`,
        createdAt: activity.createdAt ?? new Date().toISOString(),
      },
      ...current,
    ].slice(0, 20));
  };

  const submitReport = async () => {
    if (!selectedPlace || isSubmitting) {
      return;
    }

    const reportSafetyWarning = contentSafetyWarningFor(reportText);
    if (reportSafetyWarning) {
      setToast(reportSafetyWarning);
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

      const submitLocalPost = async () => {
        const result = await fetchJson<{ post: PublicPost; credits: { amount: number }[] }>("/api/posts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const earned = result.credits.reduce((sum, event) => sum + Math.max(event.amount, 0), 0);
        const badge = result.post.locationVerified ? "현장 인증" : "상태 제보";
        const optimisticReport = reportFromPost(result.post, selectedPlace);

        setPosts((current) => mergePublicPosts([result.post], current));
        setAllPosts((current) => mergePublicPosts([result.post], current));
        setReports((current) => mergeReports([optimisticReport], current));
        trackEvent("submit_post", { placeId: selectedPlace.id, locationVerified: result.post.locationVerified });
        recordUploadActivity({
          placeId: selectedPlace.id,
          placeName: selectedPlace.name,
          caption: result.post.caption ?? "한 줄 입력 없음",
          status: "reflected",
          message: "장소 피드 반영 완료",
        });
        setToast(`${badge} 완료! 방금 올린 사진이 ${selectedPlace.name} 피드에 반영됐습니다. 물어보기권 +${earned}`);
      };

      if (cloudflareApiConfigured) {
        try {
          const result = await fetchJson<FieldReportSubmitResult>(cloudflareApiUrl("/api/reports"), {
            method: "POST",
            body: JSON.stringify({
              placeId: payload.placeId,
              category: selectedPlace.category,
              crowdLevel: payload.crowdLevel,
              lineStatus: payload.lineStatus,
              parkingStatus: payload.parkingStatus,
              weatherFeel: payload.weatherFeel,
              comment: payload.caption,
              ...(verifiedLocation ? { clientLocation: verifiedLocation } : {}),
            }),
          });
          const earned = result.credits.reduce((sum, event) => sum + Math.max(event.amount, 0), 0);
          const badge = result.report.verifiedRadiusM ? "현장 인증" : "상태 제보";
          const safetyNotice = result.safetyWarning ? ` · ${result.safetyWarning}` : "";
          trackEvent("submit_report", { placeId: selectedPlace.id, locationVerified: Boolean(result.report.verifiedRadiusM) });
          recordUploadActivity({
            placeId: selectedPlace.id,
            placeName: selectedPlace.name,
            caption: payload.caption ?? "한 줄 입력 없음",
            status: "reflected",
            message: "현장 제보 저장 완료",
          });
          setToast(`${badge} 완료! 이 제보가 ${selectedPlace.name} 방문자에게 도움이 됩니다. 물어보기권 +${earned}${safetyNotice}`);
        } catch (error) {
          if (!localCloudflareApiConfigured) {
            throw error;
          }

          await submitLocalPost();
        }
      } else {
        await submitLocalPost();
      }
      setReportText("");
      setLocationVerificationStatus("idle");
      setVerifiedLocation(null);
      setActiveView("place");
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "제보 등록에 실패했습니다.";
      recordUploadActivity({
        placeId: selectedPlace.id,
        placeName: selectedPlace.name,
        caption: reportText.trim() || "한 줄 입력 없음",
        status: "failed",
        message,
      });
      setToast(message);
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
      appendRealtimeEvent(place.id, "photo.ready", result.photo.createdAt, { id: result.photo.id, placeId: place.id });
      trackEvent("upload_photo", { placeId: place.id, mimeType: photo.mimeType, byteSize: photo.byteSize });
      setToast(`${place.name} 사진 제보가 등록됐습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "사진 제보에 실패했습니다.";
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
      const message = "사진 확인은 Worker API base 설정 후 반영됩니다.";
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
      const message = "사진 삭제는 Worker API base 설정 후 사용할 수 있습니다.";
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

    const commentSafetyWarning = contentSafetyWarningFor(normalizedBody);
    if (commentSafetyWarning) {
      setToast(commentSafetyWarning);
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
      setToast("로컬 미리보기 댓글을 추가했습니다. Worker API base를 설정하면 D1에 저장됩니다.");
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
      const message = "댓글 도움은 Worker API base 설정 후 반영됩니다.";
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
      setToast(`질문이 등록됐습니다. 물어보기권 잔액 ${balance}개입니다.`);
      setQuestionText("");
      setActiveView("place");
      await loadData();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "질문 등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const flagPost = async (post: PublicPost, reason: FlagReason) => {
    try {
      if (cloudflareApiConfigured) {
        await fetchJson<ModerationReportResult>(cloudflareApiUrl("/api/moderation/reports"), {
          method: "POST",
          body: JSON.stringify({
            targetType: "place",
            targetId: post.placeId,
            reason,
            note: `게시물 신고: ${post.id}`,
          }),
        });
        trackEvent("flag_post", { postId: post.id, reason });
        recordModerationActivity({
          targetType: "post",
          targetName: post.shareCard.headline,
          reason,
          status: "queued",
          message: "운영 검토 대기열 접수",
        });
        setToast("신고가 접수되어 운영 검토 대기열에 등록했습니다.");
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
      recordModerationActivity({
        targetType: "post",
        targetName: post.shareCard.headline,
        reason,
        status: result.hidden ? "hidden" : "queued",
        message: result.hidden ? "임시 숨김 처리" : `누적 ${result.flagCount}건`,
      });
      setToast(result.hidden ? "신고가 접수되어 게시물을 임시 숨김 처리했습니다." : `신고가 접수됐습니다. 누적 ${result.flagCount}건`);
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
    if (quest.questionType === "photo_request") {
      setPhotoAttached(true);
    }
    setReportText(quest.prompt);
    setSelectedPlaceId(quest.placeId);
    setActiveView("report");
    trackEvent("answer_field_quest", { questId: quest.id, placeId: quest.placeId });
    setToast("현장 질문을 제보 작성으로 연결했습니다. 위치 인증은 선택 사항입니다.");
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
    setToast(isFollowing ? `${place.name} 팔로우를 해제했습니다.` : `${place.name} 새 현장 제보를 팔로우합니다.`);
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
        ? `새 현장 알림을 켰습니다. 팔로우 ${followCount}개 기준으로 알려드립니다.`
        : "새 현장 알림을 켰습니다. 장소나 해시태그를 팔로우하면 알림 기준에 추가됩니다.",
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

      const copyMethod = await copyTextToClipboard(shareText, browserNavigator.clipboard);
      trackEvent("share_post", { postId: post.id, method: copyMethod });
      setToast("공유 카드 페이지 링크를 복사했습니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast("공유를 취소했습니다.");
        return;
      }

      try {
        await copyTextToClipboard(shareText, browserNavigator.clipboard);
        trackEvent("share_post", { postId: post.id, method: "clipboard_fallback" });
        setToast("공유가 어려워 링크를 복사했습니다.");
      } catch {
        setToast("브라우저가 공유와 복사를 모두 막았습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    }
  };

  const shareLaunchCard = async () => {
    const shareUrl = getSiteUrl();
    const shareText = `${launchShareCard.headline}\n${launchShareCard.body}\n${launchShareCard.hashtags.map((tag) => `#${tag}`).join(" ")}\n${shareUrl}`;
    const browserNavigator = navigator as Navigator & {
      clipboard?: Clipboard;
      share?: (data: ShareData) => Promise<void>;
    };

    try {
      if (browserNavigator.share) {
        await browserNavigator.share({
          title: launchShareCard.headline,
          text: `${launchShareCard.body}\n${launchShareCard.hashtags.map((tag) => `#${tag}`).join(" ")}`,
          url: shareUrl,
        });
        trackEvent("share_launch_card", { method: "native" });
        setToast("부산·경주·울산 공유 카드를 열었습니다.");
        return;
      }

      const copyMethod = await copyTextToClipboard(shareText, browserNavigator.clipboard);
      trackEvent("share_launch_card", { method: copyMethod });
      setToast("출발 전 10초 공유 문구를 복사했습니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast("공유를 취소했습니다.");
        return;
      }

      try {
        await copyTextToClipboard(shareText, browserNavigator.clipboard);
        trackEvent("share_launch_card", { method: "clipboard_fallback" });
        setToast("공유 시트 대신 문구를 복사했습니다.");
      } catch {
        setToast("브라우저가 공유와 복사를 모두 막았습니다. 잠시 뒤 다시 시도해 주세요.");
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
                title="부산·경주·울산 첫 제보를 기다리는 중입니다"
                body="광안리 주차, 황리단길 웨이팅, 태화강 산책처럼 출발 전 판단에 필요한 제보가 올라오면 바로 랭킹과 지도에 반영됩니다."
                action={
                  <div className={styles.emptyActionRow}>
                    <button type="button" onClick={() => setActiveView("report")}>첫 제보 남기기</button>
                    <button type="button" onClick={shareLaunchCard}>공유 카드 복사</button>
                  </div>
                }
              />
            )}
            {!loading && (
              <>
                {activeView === "home" && selectedPlace && (
                  <HomeScreen
                    places={places}
                    questions={questions}
                    posts={rankedPosts}
                    hashtags={hashtags}
                    challenges={challenges}
                    selectedHashtagName={selectedHashtagName}
                    followedHashtagNames={followedHashtagNames}
                    helpfulPostIds={helpfulPostIds}
                    reports={reports}
                    onFlagPost={setPendingFlagPost}
                    onClearHashtagFilter={clearHashtagFilter}
                    onFollowHashtag={toggleHashtagFollow}
                    onHelpfulPost={markHelpful}
                    onOpenPlace={openPlace}
                    onSelectChallenge={selectChallenge}
                    onShareLaunchCard={shareLaunchCard}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    onGoSearch={() => setActiveView("search")}
                    onGoMap={() => setActiveView("map")}
                    onGoReport={() => setActiveView("report")}
                  />
                )}
                {activeView === "search" && (
                  <SearchScreen
                    hashtags={hashtags}
                    places={places}
                    posts={rankedPosts}
                    onGoMap={() => setActiveView("map")}
                    onOpenPlace={openPlace}
                    onSelectHashtag={selectHashtag}
                  />
                )}
                {activeView === "map" && (
                  <MapScreen
                    activeFilter={activeFilter}
                    activeRegion={activeRegion}
                    currentLocation={mapCurrentLocation}
                    likedPlaceIds={likedPlaceIds}
                    liveConnection={liveConnection}
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
                    onRegionChange={changeActiveRegion}
                    onReport={startReportForPlace}
                    onReportPlace={reportMapPlace}
                    onSearchQueryChange={setMapSearchQuery}
                    onGoSearch={() => setActiveView("search")}
                    onGoReport={() => setActiveView("report")}
                    onRetryMapData={() => {
                      setMapBounds(null);
                      setMapSearchQuery("");
                      setActiveFilter("전체");
                      lastMapBoundsFetchKeyRef.current = "";
                      setToast("지도 데이터를 다시 불러옵니다.");
                      void loadData({ bounds: null, query: null });
                    }}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportComment={openCommentReport}
                    onReportPhoto={openPhotoReport}
                    onShareLaunchCard={shareLaunchCard}
                    places={places}
                    posts={rankedPosts}
                    reports={reports}
                    workerCommentsByPlaceId={workerCommentsByPlaceId}
                    workerPhotos={workerPhotos}
                    locationPermission={mapLocationPermission}
                    onToast={setToast}
                    tourismPlaces={tourismPlaces}
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
                    onHelpfulPost={markHelpful}
                    onReport={() => setActiveView("report")}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportPhoto={openPhotoReport}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    workerPhotos={workerPhotos}
                  />
                )}
                {activeView === "report" && selectedPlace && (
                  <ReportScreen
                    isSubmitting={isSubmitting}
                    place={selectedPlace}
                    sensitiveWarning={sensitivePhotoWarningFor(selectedPlace)}
                    photoAttached={photoAttached}
                    locationVerificationStatus={locationVerificationStatus}
                    reportText={reportText}
                    recommendedTags={recommendedTags}
                    quickReportPresets={quickReportPresets}
                    setPhotoAttached={setPhotoAttached}
                    setReportText={setReportText}
                    onApplyPreset={applyQuickReportPreset}
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
                    myQuestions={myQuestions}
                    questions={questions}
                    reports={reports}
                    savedPosts={allRankedPosts.filter((post) => savedPostIds.has(post.id))}
                    uploadActivities={uploadActivities}
                    moderationActivities={moderationActivities}
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
                setActiveView("report");
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
  notificationEnabled,
  onNotify,
  onSafety,
  selectedPlace,
  toast,
  onBack,
}: {
  activeView: View;
  notificationEnabled: boolean;
  onNotify: () => void;
  onSafety: () => void;
  selectedPlace: Place | null;
  toast: string;
  onBack: () => void;
}) {
  const isDetail = ["place", "ask"].includes(activeView);
  const titleMap: Record<View, string> = {
    home: "#실시간",
    search: "검색",
    map: "지도",
    place: selectedPlace?.name ?? "장소 상세",
    report: "사진 올리기",
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
          <p className={styles.eyebrow}>부산·경주·울산 베타</p>
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
      <div className={styles.toast}>{toast}</div>
    </header>
  );
}

function HomeScreen({
  places,
  questions,
  posts,
  hashtags,
  challenges,
  selectedHashtagName,
  followedHashtagNames,
  helpfulPostIds,
  reports,
  onFlagPost,
  onClearHashtagFilter,
  onFollowHashtag,
  onHelpfulPost,
  onOpenPlace,
  onSelectChallenge,
  onShareLaunchCard,
  onSharePost,
  onSelectHashtag,
  onGoSearch,
  onGoMap,
  onGoReport,
}: {
  places: Place[];
  questions: Question[];
  posts: PublicPost[];
  hashtags: PublicHashtag[];
  challenges: Challenge[];
  selectedHashtagName: string | null;
  followedHashtagNames: Set<string>;
  helpfulPostIds: Set<string>;
  reports: Report[];
  onFlagPost: (post: PublicPost) => void;
  onClearHashtagFilter: () => void;
  onFollowHashtag: (hashtagName: string) => void;
  onHelpfulPost: (post: PublicPost) => void;
  onOpenPlace: (place: Place) => void;
  onSelectChallenge: (challenge: Challenge) => void;
  onShareLaunchCard: () => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  onGoSearch: () => void;
  onGoMap: () => void;
  onGoReport: () => void;
}) {
  const [activeFeedTab, setActiveFeedTab] = useState<FeedTab>("전체");
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const filteredPosts = useMemo(
    () =>
      posts
        .filter((post) => !post.hiddenAt)
        .filter((post) => postMatchesFeedTab(post, placeById.get(post.placeId), activeFeedTab, followedHashtagNames))
        .slice(0, 8),
    [activeFeedTab, followedHashtagNames, placeById, posts],
  );
  const trendingPlaces = useMemo(
    () =>
      [...places]
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko"))
        .slice(0, 5),
    [places],
  );

  return (
    <div className={styles.screenStack}>
      <section className={styles.homeHeaderCard}>
        <div>
          <p className={styles.eyebrow}>방금 올라온 장소 사진</p>
          <h2>#실시간</h2>
          <span>지금 사람들이 올린 장소 사진으로, 오늘 갈 곳의 분위기를 확인하세요.</span>
        </div>
        <div className={styles.homeHeaderActions}>
          <button type="button" onClick={onGoSearch} aria-label="검색">
            <Search size={17} />
          </button>
          <button type="button" onClick={onGoMap} aria-label="현재 위치 지도">
            <LocateFixed size={17} />
          </button>
        </div>
      </section>

      <section className={styles.feedControlSection} aria-label="지역과 해시태그 필터">
        <div className={styles.feedTabs}>
          {feedTabLabels.map((tab) => (
            <button key={tab} className={tab === activeFeedTab ? styles.activeFeedTab : ""} type="button" onClick={() => setActiveFeedTab(tab)} aria-pressed={tab === activeFeedTab}>{tab}</button>
          ))}
        </div>
        <div className={styles.homeHashtagRow}>
          {homeHashtagChips.map((tag) => (
            <button key={tag} className={selectedHashtagName === tag ? styles.homeHashtagActive : ""} type="button" onClick={() => onSelectHashtag(tag)}>
              #{tag}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.photoFeedSection}>
        <SectionTitle title={selectedHashtagName ? `#${selectedHashtagName}` : "지금 올라온 장소 사진"} caption={selectedHashtagName ? `${filteredPosts.length}장` : `${activeFeedTab} 사진 ${filteredPosts.length}장`} />
        {selectedHashtagName && (
          <div className={styles.feedFilterBanner}>
            <span>해시태그 필터 적용 중</span>
            <button type="button" onClick={onClearHashtagFilter}>전체 피드 보기</button>
          </div>
        )}
        <div className={styles.feedList}>
          {filteredPosts.map((post) => {
            const place = places.find((item) => item.id === post.placeId) ?? places[0];
            return (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                onFlag={() => onFlagPost(post)}
                onHelpful={() => onHelpfulPost(post)}
                onOpenPlace={() => onOpenPlace(place)}
                onShare={() => onSharePost(post)}
                onSelectHashtag={onSelectHashtag}
                helpfulActive={helpfulPostIds.has(post.id)}
              />
            );
          })}
          {filteredPosts.length === 0 && (
            <LaunchInlineEmptyState
              title={`${activeFeedTab} 조건에 맞는 사진이 없습니다`}
              body="장소 사진을 올리면 이 피드와 해시태그 탐색에 바로 반영됩니다."
              onGoReport={onGoReport}
              onShare={onShareLaunchCard}
            />
          )}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="지금 뜨는 곳 TOP 5" caption="최근 사진과 반응 기준" />
        <div className={styles.trendingPlaceList}>
          {trendingPlaces.map((place, index) => {
            const postCount = posts.filter((post) => post.placeId === place.id && !post.hiddenAt).length;
            const tags = posts.find((post) => post.placeId === place.id)?.hashtagNames.slice(0, 2) ?? [];

            return (
              <button key={place.id} type="button" onClick={() => onOpenPlace(place)}>
                <span>{index + 1}</span>
                <div>
                  <strong>{place.name}</strong>
                  <small>{postCount}장 · {tags.map((tag) => `#${tag}`).join(" ") || place.signal}</small>
                </div>
                <em>{index < 2 ? "상승" : "신규"}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption="탐색과 검색에 사용" />
        <div className={styles.hashtagCloud}>
          {hashtags.slice(0, 10).map((tag) => (
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

      <section className={styles.ctaGrid}>
        <button className={styles.ctaCard} type="button" onClick={onGoReport}>
          <Camera size={20} />
          <strong>사진 올리기</strong>
          <span>5단계 안에 끝내기</span>
        </button>
        <button className={styles.ctaCard} type="button" onClick={onGoMap}>
          <MapPin size={20} />
          <strong>지도에서 보기</strong>
          <span>작은 핀으로 보조 탐색</span>
        </button>
      </section>

      <LaunchShareCard onGoMap={onGoMap} onGoReport={onGoReport} onShare={onShareLaunchCard} />

      <section className={styles.challengeSection}>
        <SectionTitle title="이번 주 해시태그" caption="사진 올릴 때 추천" />
        <div className={styles.challengeList}>
          {challenges.map((challenge) => (
            <button key={challenge.id} type="button" onClick={() => onSelectChallenge(challenge)}>
              <span>#{challenge.hashtagName}</span>
              <strong>{challenge.title}</strong>
              <p>{challenge.description}</p>
              <small>{challenge.rewardBadge} 뱃지</small>
            </button>
          ))}
        </div>
      </section>

      {reports.length > 0 && <AnswerableQuestions questions={questions} places={places} />}
    </div>
  );
}

function LaunchShareCard({
  onGoMap,
  onGoReport,
  onShare,
}: {
  onGoMap: () => void;
  onGoReport: () => void;
  onShare: () => void;
}) {
  return (
    <section className={styles.launchShareCard} aria-label="첫 출시 지역 공유 카드">
      <div className={styles.launchShareHeader}>
        <span>출발 전 10초 공유 카드</span>
        <strong>부산·경주·울산</strong>
      </div>
      <h2>{launchShareCard.headline}</h2>
      <p>{launchShareCard.body}</p>
      <div className={styles.launchMessageList} aria-label="핵심 확인 메시지">
        <span>광안리 지금 주차 만차인지</span>
        <span>황리단길 웨이팅 얼마나 긴지</span>
        <span>해운대 사람 터졌는지 사진으로</span>
      </div>
      <div className={styles.launchPlaceGrid} aria-label="1차 집중 장소">
        {launchFocusPlaces.map((placeName) => (
          <span key={placeName}>{placeName}</span>
        ))}
      </div>
      <div className={styles.launchShareActions}>
        <button type="button" onClick={onShare}>
          <Share2 size={15} />
          공유 카드 복사
        </button>
        <button type="button" onClick={onGoMap}>
          <MapPin size={15} />
          지도에서 보기
        </button>
        <button type="button" onClick={onGoReport}>
          <Camera size={15} />
          사진 올리기
        </button>
      </div>
    </section>
  );
}

function LaunchInlineEmptyState({
  body,
  onGoReport,
  onShare,
  title,
}: {
  body: string;
  onGoReport: () => void;
  onShare: () => void;
  title: string;
}) {
  return (
    <div className={styles.launchInlineEmptyState}>
      <Sparkles size={17} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      <div>
        <button type="button" onClick={onGoReport}>사진 올리기</button>
        <button type="button" onClick={onShare}>공유하기</button>
      </div>
    </div>
  );
}

function SearchScreen({
  hashtags,
  onGoMap,
  onOpenPlace,
  onSelectHashtag,
  places,
  posts,
}: {
  hashtags: PublicHashtag[];
  onGoMap: () => void;
  onOpenPlace: (place: Place) => void;
  onSelectHashtag: (hashtagName: string) => void;
  places: Place[];
  posts: PublicPost[];
}) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchResultTab>("장소");
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const matchingPlaces = useMemo(
    () =>
      places
        .filter((place) => {
          if (!normalizedQuery) {
            return true;
          }

          return `${place.name} ${place.address} ${place.summary}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
        })
        .slice(0, 8),
    [normalizedQuery, places],
  );
  const matchingHashtags = useMemo(
    () =>
      hashtags
        .filter((tag) => !normalizedQuery || tag.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
        .slice(0, 12),
    [hashtags, normalizedQuery],
  );
  const matchingPosts = useMemo(
    () =>
      posts
        .filter((post) => {
          const place = placeById.get(post.placeId);
          const source = `${place?.name ?? ""} ${place?.address ?? ""} ${post.caption ?? ""} ${post.hashtagNames.join(" ")}`.toLocaleLowerCase("ko-KR");

          return !post.hiddenAt && (!normalizedQuery || source.includes(normalizedQuery));
        })
        .slice(0, 8),
    [normalizedQuery, placeById, posts],
  );
  const popularHashtags = hashtags.slice(0, 8);
  const hotRegions = ["성수", "광안리", "황리단길", "해운대", "제주", "부산"];
  const recommendedSearches = ["광안리", "해운대", "황리단길"];
  const recommendedTags = ["주차만차", "웨이팅", "사진스팟"];

  return (
    <div className={styles.screenStack}>
      <section className={styles.searchHeroCard}>
        <div className={styles.searchBox}>
          <Search size={18} />
          <input
            aria-label="장소 해시태그 지역 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="장소, 해시태그, 지역 검색"
          />
        </div>
        <p>장소 이름, #주차만차, 광안리처럼 입력해 보세요.</p>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption="추천 선택 중심" />
        <div className={styles.hashtagCloud}>
          {popularHashtags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)}>
              <Hash size={13} />
              {tag.name}
              <span>{tag.postCount}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="지금 뜨는 지역" caption="바로 지도 확인" />
        <div className={styles.hotRegionGrid}>
          {hotRegions.map((region) => (
            <button key={region} type="button" onClick={onGoMap}>#{region}</button>
          ))}
        </div>
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="검색 결과" caption={query ? query : "최근 많이 본 장소"} />
        <div className={styles.searchResultTabs} role="tablist" aria-label="검색 결과 종류">
          {(["장소", "해시태그", "사진"] as SearchResultTab[]).map((tab) => (
            <button key={tab} className={activeTab === tab ? styles.activeFeedTab : ""} type="button" onClick={() => setActiveTab(tab)} aria-pressed={activeTab === tab}>
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "장소" && (
          <div className={styles.searchResultList}>
            {matchingPlaces.map((place) => (
              <button key={place.id} type="button" onClick={() => onOpenPlace(place)}>
                <MapPin size={16} />
                <div>
                  <strong>{place.name}</strong>
                  <span>{place.address} · {place.signal}</span>
                </div>
              </button>
            ))}
            {matchingPlaces.length === 0 && (
              <SearchEmptyRecommendations
                query={query}
                recommendedSearches={recommendedSearches}
                recommendedTags={recommendedTags}
                onGoMap={onGoMap}
                onSearch={setQuery}
                onSelectHashtag={onSelectHashtag}
              />
            )}
          </div>
        )}

        {activeTab === "해시태그" && (
          <div className={styles.searchResultList}>
            {matchingHashtags.map((tag) => (
              <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)}>
                <Hash size={16} />
                <div>
                  <strong>#{tag.name}</strong>
                  <span>{tag.postCount}개 사진 · {tag.tagType}</span>
                </div>
              </button>
            ))}
            {matchingHashtags.length === 0 && (
              <SearchEmptyRecommendations
                query={query}
                recommendedSearches={recommendedSearches}
                recommendedTags={recommendedTags}
                onGoMap={onGoMap}
                onSearch={setQuery}
                onSelectHashtag={onSelectHashtag}
              />
            )}
          </div>
        )}

        {activeTab === "사진" && (
          <div className={styles.searchPhotoGrid}>
            {matchingPosts.map((post) => {
              const place = placeById.get(post.placeId) ?? places[0];

              return (
                <button key={post.id} className={`${styles.searchPhotoTile} ${styles[place.tone]}`} type="button" onClick={() => onOpenPlace(place)}>
                  <span>{place.name}</span>
                  <strong>{post.photoLabel}</strong>
                </button>
              );
            })}
            {matchingPosts.length === 0 && (
              <SearchEmptyRecommendations
                query={query}
                recommendedSearches={recommendedSearches}
                recommendedTags={recommendedTags}
                onGoMap={onGoMap}
                onSearch={setQuery}
                onSelectHashtag={onSelectHashtag}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SearchEmptyRecommendations({
  onGoMap,
  onSearch,
  onSelectHashtag,
  query,
  recommendedSearches,
  recommendedTags,
}: {
  onGoMap: () => void;
  onSearch: (query: string) => void;
  onSelectHashtag: (hashtagName: string) => void;
  query: string;
  recommendedSearches: string[];
  recommendedTags: string[];
}) {
  return (
    <div className={styles.searchEmptyRecommendations}>
      <Search size={17} aria-hidden="true" />
      <div>
        <strong>{query.trim() ? `"${query.trim()}" 결과가 아직 없습니다` : "검색어를 입력해 주세요"}</strong>
        <p>추천 지역이나 해시태그로 바로 다시 찾아볼 수 있어요.</p>
      </div>
      <div className={styles.searchRecommendationGroup} aria-label="추천 지역">
        {recommendedSearches.map((item) => (
          <button key={item} type="button" onClick={() => onSearch(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className={styles.searchRecommendationGroup} aria-label="추천 해시태그">
        {recommendedTags.map((tag) => (
          <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}>
            #{tag}
          </button>
        ))}
        <button type="button" onClick={onGoMap}>지도에서 보기</button>
      </div>
    </div>
  );
}

function MapScreen({
  activeFilter,
  activeRegion,
  currentLocation,
  likedPlaceIds,
  liveConnection,
  locationPermission,
  mapBounds,
  onFilterChange,
  onGoReport,
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
  onReport,
  onReportComment,
  onRegionChange,
  onReportPhoto,
  onReportPlace,
  onSearchQueryChange,
  onGoSearch,
  onShareLaunchCard,
  onToast,
  onRetryMapData,
  places,
  posts,
  previewPlace,
  realtimeEventsByPlaceId,
  reports,
  searchQuery,
  tourismPlaces,
  workerCommentsByPlaceId,
  workerPhotos,
}: {
  activeFilter: string;
  activeRegion: RegionTabId;
  currentLocation: UiLocation | null;
  likedPlaceIds: Set<string>;
  liveConnection: "connecting" | "live" | "polling";
  locationPermission: LocationPermissionState;
  mapBounds: MapBounds | null;
  onFilterChange: (filter: string) => void;
  onGoReport: () => void;
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
  onReport: (place: Place) => void;
  onReportComment: (place: Place, comment: PlaceComment) => void;
  onRegionChange: (region: RegionTabId) => void;
  onReportPhoto: (place: Place, photo: PlacePhoto) => void;
  onReportPlace: (place: Place) => void;
  onSearchQueryChange: (query: string) => void;
  onGoSearch: () => void;
  onShareLaunchCard: () => void;
  onToast: (message: string) => void;
  onRetryMapData: () => void;
  places: Place[];
  posts: PublicPost[];
  previewPlace: Place | null;
  realtimeEventsByPlaceId: Record<string, CloudflareRealtimeEvent[]>;
  reports: Report[];
  searchQuery: string;
  tourismPlaces: Place[];
  workerCommentsByPlaceId: Record<string, PlaceComment[]>;
  workerPhotos: WorkerPhoto[];
}) {
  const [trafficEnabled, setTrafficEnabled] = useState(false);
  const [requeryHintVisible, setRequeryHintVisible] = useState(false);
  const searchFocus = useMemo(() => mapSearchFocusForQuery(searchQuery), [searchQuery]);
  const baseFilteredPlaces = searchPlaces(filterPlaces(filterPlacesByRegion(places, activeRegion), activeFilter), searchQuery);
  const nearbySearchPlaces = useMemo(() => (searchFocus ? placesNearSearchFocus(places, searchFocus) : []), [places, searchFocus]);
  const filteredPlaces = searchFocus && baseFilteredPlaces.length === 0 ? nearbySearchPlaces : baseFilteredPlaces;
  const mapAreaPlaces = mapBounds ? filteredPlaces.filter((place) => isPlaceInBounds(place, mapBounds)) : filteredPlaces;
  const nationwideTop = rankPlaces(searchFocus && searchPlaces(places, searchQuery).length === 0 ? nearbySearchPlaces : searchPlaces(places, searchQuery));
  const regionTop = rankPlaces(filteredPlaces);
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
  const rankingEmptyAction = (
    <div className={styles.emptyActionRow}>
      <button type="button" onClick={onGoReport}>현장 리포터 되기</button>
      <button type="button" onClick={onShareLaunchCard}>공유 카드 복사</button>
    </div>
  );
  const showMapRecovery = filteredPlaces.length === 0;

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
          <p className={styles.eyebrow}>부산·경주·울산 실시간 장소</p>
          <h2>첫 출시 지역을 지도에서 보고, 바로 랭킹으로 좁히세요</h2>
        </div>
        <span className={styles.liveBadge}>{visibleLiveConnection === "live" ? "실시간 연결" : "Polling 갱신"}</span>
      </section>

      <section className={styles.realMapFrame} aria-label="네이버 지도 기반 현장 지도">
        <NaverMap
          places={filteredPlaces}
          compact
          currentLocation={currentLocation}
          searchFocus={searchFocus}
          showTraffic={trafficEnabled}
          onBoundsChange={onMapBoundsChange}
          onMapInteraction={() => setRequeryHintVisible(true)}
          onSelectPlace={selectMapPlace}
        />
      </section>
      {showMapRecovery && (
        <section className={styles.mapRecoveryCard} aria-label="지도 데이터 복구">
          <MapIcon size={18} aria-hidden="true" />
          <div>
            <strong>지도 데이터를 불러오지 못했어요</strong>
            <p>필터나 검색 조건을 바꾸거나, 첫 현장 사진을 올려 이 지역 후보를 만들 수 있어요.</p>
          </div>
          <div className={styles.mapRecoveryActions}>
            <button type="button" onClick={onRetryMapData}>재시도</button>
            <button type="button" onClick={onGoSearch}>검색으로 이동</button>
            <button type="button" onClick={onGoReport}>사진 올리기</button>
          </div>
        </section>
      )}

      <div className={styles.mapSearchRow}>
        <label className={styles.searchBox}>
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="장소 검색"
            placeholder="장소명 검색"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>
        <button className={styles.filterButton} type="button" onClick={cycleFilter} aria-label={`지도 필터 순환: ${activeFilter}`}>
          <Filter size={16} /> 필터
        </button>
      </div>
      {searchFocus && <p className={styles.mapSearchFocus}>{searchFocus.label} 중심으로 지도를 표시합니다.</p>}

      <div className={styles.mapToolRow}>
        <button className={trafficEnabled ? styles.mapToolActive : ""} type="button" onClick={toggleTraffic} aria-pressed={trafficEnabled}>
          {trafficEnabled ? "교통 끄기" : "교통 켜기"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRequeryHintVisible(false);
            onFilterChange("전체");
            onToast("현재 지도 화면 안 TOP 10을 다시 정렬했습니다.");
          }}
        >
          이 지역 다시 검색
        </button>
      </div>
      {requeryHintVisible && <p className={styles.mapRequeryHint}>지도를 움직였습니다. 이 지역 기준으로 다시 검색할 수 있어요.</p>}

      <section className={styles.tourismApiPanel} aria-label="관광 API 장소">
        <div>
          <p className={styles.eyebrow}>관광 API</p>
          <strong>{tourismPlaces.length > 0 ? `${regionLabel(activeRegion)} 관광지 ${tourismPlaces.length}곳` : "첫 지역 추천 장소"}</strong>
        </div>
        <div className={styles.tourismApiList}>
          {(tourismPlaces.length > 0 ? tourismPlaces.slice(0, 3) : mapTop.slice(0, 3)).map((place) => (
            <button key={`tourism-${place.id}`} type="button" onClick={() => onPreviewPlace(place, "map_marker")}>
              <MapPin size={14} aria-hidden="true" />
              <span>{place.name}</span>
            </button>
          ))}
        </div>
      </section>

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
          title="첫 출시 TOP 10"
          places={nationwideTop}
          onOpenPlace={(place) => {
            const fullPlace = places.find((candidate) => candidate.id === place.id);
            if (fullPlace) onPreviewPlace(fullPlace, "ranking");
          }}
          emptyBody="부산·경주·울산 후보 장소를 불러오는 중입니다. 데이터가 도착하면 즉시 순위가 채워집니다."
          emptyAction={rankingEmptyAction}
        />
        <RankingPanel
          title={`${regionLabel(activeRegion)} TOP 10`}
          places={regionTop}
          onOpenPlace={(place) => {
            const fullPlace = places.find((candidate) => candidate.id === place.id);
            if (fullPlace) onPreviewPlace(fullPlace, "ranking");
          }}
          emptyBody="이 지역은 첫 현장 리포터 20명 모집 중입니다. 광안리·황리단길·태화강처럼 방문 전 판단에 필요한 제보를 먼저 모읍니다."
          emptyAction={rankingEmptyAction}
        />
        <RankingPanel
          title="지도 화면 안 TOP 10"
          places={mapTop}
          onOpenPlace={(place) => {
            const fullPlace = places.find((candidate) => candidate.id === place.id);
            if (fullPlace) onPreviewPlace(fullPlace, "ranking");
          }}
          emptyBody="검색 결과가 없으면 장소 이름을 바꾸거나, 현장 리포터로 첫 제보를 남겨 주세요."
          emptyAction={rankingEmptyAction}
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
  onHelpfulPost,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  onReport,
  onReportPhoto,
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
  onHelpfulPost: (post: PublicPost) => void;
  onPhotoDelete: (place: Place, photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (place: Place, photo: PreparedPhotoUpload) => Promise<void>;
  onReport: () => void;
  onReportPhoto: (place: Place, photo: PlacePhoto) => void;
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
  const todayReports = posts.length || reports.length;
  const tabPosts = placeActiveTab === "사진" ? posts.filter((post) => post.photoCount > 0) : posts;

  return (
    <div className={styles.screenStack}>
      <section className={`${styles.placeHero} ${styles[place.tone]}`}>
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
          <StatBox label="최근 사진" value={String(photoCount)} />
          <StatBox label="댓글" value={String(posts.reduce((sum, post) => sum + post.commentCount, 0))} />
          <StatBox label="좋아요" value={String(posts.reduce((sum, post) => sum + post.helpfulCount, 0))} />
          <StatBox label="3시간" value={String(todayReports)} />
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
                <span>답변하면 +{quest.rewardCredits} 물어보기권</span>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          {fieldQuests.length === 0 && <p className={styles.emptyText}>현재 이 장소에 열린 현장 질문이 없습니다.</p>}
        </div>
      </section>

      <section className={styles.placeTabs} aria-label="장소 프로필 탭">
        {(["실시간", "사진", "질문", "해시태그", "근처"] as PlaceTab[]).map((tab) => (
          <button key={tab} className={tab === placeActiveTab ? styles.placeTabActive : ""} type="button" onClick={() => setPlaceActiveTab(tab)}>{tab}</button>
        ))}
      </section>

      {(placeActiveTab === "실시간" || placeActiveTab === "사진") && (
        <section className={styles.sectionBlock}>
        <SectionTitle title={placeActiveTab === "사진" ? "최근 사진" : "실시간 장소 피드"} caption={`${tabPosts.length}장`} />
          <div className={styles.feedList}>
            {tabPosts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                onFlag={() => onFlagPost(post)}
                onHelpful={() => onHelpfulPost(post)}
                onOpenPlace={() => undefined}
                onShare={() => onSharePost(post)}
                onSelectHashtag={onSelectHashtag}
                helpfulActive={helpfulPostIds.has(post.id)}
              />
            ))}
            {tabPosts.length === 0 && <p className={styles.emptyText}>{placeActiveTab === "사진" ? "아직 사진이 없습니다." : "아직 장소 피드가 없습니다. 첫 사진을 올려주세요."}</p>}
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
            {placeQuestions.length === 0 && <p className={styles.emptyText}>아직 이 장소에 올라온 질문이 없습니다.</p>}
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
            {placeHashtags.length === 0 && <p className={styles.emptyText}>아직 이 장소에 연결된 해시태그가 없습니다.</p>}
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
            {nearbyPlaces.length === 0 && <p className={styles.emptyText}>같은 지역의 근처 장소가 아직 없습니다.</p>}
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
        <SectionTitle title="최근 3시간 요약" caption="사진과 상태 신호" />
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
        <button className={styles.primaryButton} type="button" onClick={onReport}>사진 올리기</button>
      </div>
    </div>
  );
}

function ReportScreen({
  isSubmitting,
  place,
  sensitiveWarning,
  photoAttached,
  locationVerificationStatus,
  reportText,
  recommendedTags,
  quickReportPresets,
  setPhotoAttached,
  setReportText,
  onApplyPreset,
  onRequestLocation,
  onSubmit,
}: {
  isSubmitting: boolean;
  place: Place;
  sensitiveWarning: string | null;
  photoAttached: boolean;
  locationVerificationStatus: LocationVerificationStatus;
  reportText: string;
  recommendedTags: string[];
  quickReportPresets: QuickReportPreset[];
  setPhotoAttached: (value: boolean) => void;
  setReportText: (value: string) => void;
  onApplyPreset: (preset: QuickReportPreset) => void;
  onRequestLocation: () => void;
  onSubmit: () => void;
}) {
  const verificationCopy = verificationStatusCopy(locationVerificationStatus);
  const reportSafetyWarning = contentSafetyWarningFor(reportText);
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
        <Camera size={22} />
        <div>
          <h2>사진 올리기</h2>
          <p>{place.name} 분위기를 사진, 해시태그, 한 줄로 남깁니다.</p>
        </div>
      </section>

      <section className={styles.uploadStepCard} aria-label="사진 올리기 단계">
        {uploadStepLabels.map((label, index) => (
          <span key={label}>
            <strong>{index + 1}</strong>
            {label}
          </span>
        ))}
      </section>

      <section className={styles.photoUploadCard}>
        <div className={`${styles.uploadBox} ${photoAttached ? styles.uploadAttached : ""}`}>
          <Camera size={26} />
          <strong>{photoAttached ? "사진 미리보기 준비됨" : "사진 선택"}</strong>
          <span>업로드 전 EXIF를 제거합니다.</span>
        </div>
        <button type="button" onClick={() => setPhotoAttached(!photoAttached)}>
          <ImageIcon size={16} /> {photoAttached ? "사진 바꾸기" : "사진 선택"}
        </button>
        {sensitiveWarning && <p className={styles.photoSafetyNotice}>{sensitiveWarning}</p>}
      </section>

      <section className={styles.selectedPlaceCard}>
        <MapPin size={18} />
        <div>
          <span>어디인가요?</span>
          <strong>{place.name}</strong>
          <p>{place.address}</p>
        </div>
      </section>

      <section className={styles.hashtagSuggestCard}>
        <div className={styles.sectionTitle}>
          <h2>지금 어떤가요?</h2>
          <span>최대 5개</span>
        </div>
        <div className={styles.hashtagCloud}>
          {recommendedTags.map((tag) => (
            <button key={tag} type="button" onClick={() => toggleRecommendedTag(tag)}><Hash size={13} />{tag}</button>
          ))}
          {quickReportPresets.slice(0, 5).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onApplyPreset(preset);
                toggleRecommendedTag(preset.label);
              }}
            >
              <Hash size={13} />
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.textAreaCard}>
        <label htmlFor="reportText">한 줄 남기기</label>
        <textarea
          id="reportText"
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          placeholder="예: 공영주차장 거의 찼어요."
          maxLength={120}
          aria-describedby={reportSafetyWarning ? "reportTextSafety" : undefined}
          aria-invalid={Boolean(reportSafetyWarning)}
        />
        {reportSafetyWarning && <p id="reportTextSafety" className={styles.inputSafetyNotice} role="alert">{reportSafetyWarning}</p>}
        <span>{reportText.length}/120</span>
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

      <button className={styles.submitButton} type="button" onClick={onSubmit} disabled={isSubmitting || Boolean(reportSafetyWarning)}>
        {isSubmitting ? "올리는 중..." : "올리기"}
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
          <p className={styles.eyebrow}>내 물어보기권 3개</p>
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
  myQuestions,
  moderationActivities,
  onToast,
  questions,
  reports,
  savedPosts,
  uploadActivities,
  userReputation,
}: {
  followedHashtagNames: Set<string>;
  followedPlaces: Place[];
  myQuestions: MyQuestion[];
  moderationActivities: ModerationActivity[];
  onToast: (message: string) => void;
  questions: Question[];
  reports: Report[];
  savedPosts: PublicPost[];
  uploadActivities: UploadActivity[];
  userReputation: UserReputation;
}) {
  const reportsRef = useRef<HTMLElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef<HTMLElement | null>(null);
  const hashtagsRef = useRef<HTMLElement | null>(null);
  const badgesRef = useRef<HTMLElement | null>(null);
  const moderationRef = useRef<HTMLElement | null>(null);
  const safetyRef = useRef<HTMLElement | null>(null);
  const [activeMenuTarget, setActiveMenuTarget] = useState<MyMenuTarget | null>(null);
  const answeredCount = myQuestions.filter((question) => question.status === "answered").length;
  const visibleReports = reports.filter((report) => !report.hiddenAt);
  const hiddenReportCount = reports.length - visibleReports.length;
  const reflectedUploadCount = uploadActivities.filter((activity) => activity.status === "reflected").length;
  const failedUploadCount = uploadActivities.filter((activity) => activity.status === "failed").length;
  const reviewAttentionCount = hiddenReportCount + failedUploadCount + moderationActivities.length;
  const latestModerationActivities = moderationActivities.slice(0, 4);
  const savedAndFollowedCount = savedPosts.length + followedPlaces.length + followedHashtagNames.size;
  const latestReports = [...reports]
    .filter((report) => !report.hiddenAt)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 4);
  const latestQuestions = (myQuestions.length ? myQuestions : questions).slice(0, 4);
  const questionStatusMeta = (question: MyQuestion | Question) => {
    const reward = "reward" in question ? question.reward : question.questionType === "photo_request" ? "+2" : "+1";
    return `${question.answeredReportId ? "답변 완료" : "답변 대기"} · ${reward}`;
  };
  const menuItems = [
    { icon: Camera, label: "내 제보", message: "내 최근 제보로 이동했습니다.", target: "reports", ref: reportsRef },
    { icon: MessageCircleQuestion, label: "내 질문", message: "내 질문 현황으로 이동했습니다.", target: "questions", ref: questionsRef },
    { icon: Bookmark, label: "저장한 게시물", message: "저장한 게시물로 이동했습니다.", target: "saved", ref: savedRef },
    { icon: Hash, label: "팔로우한 해시태그", message: "팔로우한 해시태그로 이동했습니다.", target: "hashtags", ref: hashtagsRef },
    { icon: Star, label: "지역 뱃지", message: "지역 뱃지로 이동했습니다.", target: "badges", ref: badgesRef },
    { icon: ShieldAlert, label: "신고/차단 관리", message: "신고/차단 관리로 이동했습니다.", target: "moderation", ref: moderationRef },
    { icon: UserX, label: "차단한 사용자", message: "차단/제한 보호 상태로 이동했습니다.", target: "safety", ref: safetyRef },
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
          <h2>실시간러버</h2>
          <p>지역 제보자 · 신뢰 점수 {userReputation.trustScore}</p>
        </div>
        <Settings size={19} />
      </section>

      <section className={styles.reputationCard}>
        <div>
          <p className={styles.eyebrow}>당근식 로컬 신뢰</p>
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
        <StatBox label="공개 제보" value={String(reports.length)} />
        <StatBox label="내 질문" value={String(myQuestions.length || questions.length)} />
        <StatBox label="답변 완료" value={String(answeredCount)} />
        <StatBox label="저장" value={String(savedPosts.length)} />
      </section>

      <section className={styles.contributionTracker} aria-labelledby="contribution-tracker-heading">
        <SectionTitle title="기여 트래커" caption="피드 반영과 재시도 상태" headingId="contribution-tracker-heading" />
        <div className={styles.trackerGrid}>
          <article>
            <Camera size={17} />
            <strong>{reflectedUploadCount || visibleReports.length}건</strong>
            <span>피드 반영</span>
          </article>
          <article>
            <AlertTriangle size={17} />
            <strong>{failedUploadCount}건</strong>
            <span>재시도 필요</span>
          </article>
          <article>
            <Bookmark size={17} />
            <strong>{savedAndFollowedCount}개</strong>
            <span>저장/팔로우</span>
          </article>
        </div>
        <div className={styles.uploadActivityList}>
          {uploadActivities.slice(0, 3).map((activity) => (
            <article key={activity.id} className={styles.uploadActivityItem}>
              {activity.status === "reflected" ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
              <div>
                <strong>{activity.placeName}</strong>
                <span>{activity.status === "reflected" ? "피드 반영" : "업로드 실패"} · {activity.message} · {minutesAgo(activity.createdAt)}</span>
                <small>{activity.caption}</small>
              </div>
            </article>
          ))}
          {uploadActivities.length === 0 && <p className={styles.emptyText}>사진 올리기를 완료하면 피드 반영 상태가 여기에 쌓입니다.</p>}
        </div>
      </section>

      <section
        ref={badgesRef}
        className={`${styles.badgeShelf} ${activeMenuTarget === "badges" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-label="지역 뱃지"
      >
        {["태화강 제보왕", "부산 주차 도우미", "사진 스팟 헌터"].map((badge) => (
          <span key={badge}><BadgeCheck size={14} />{badge}</span>
        ))}
      </section>

      <section className={styles.walletCard}>
        <div>
          <p className={styles.eyebrow}>보유 현황</p>
          <h3>물어보기권은 서버 잔액 기준</h3>
        </div>
        <strong>{questions.length}Q</strong>
      </section>

      <section
        ref={reportsRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "reports" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-reports-heading"
      >
        <SectionTitle title="내 최근 제보" caption={`${latestReports.length}건`} headingId="my-reports-heading" />
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
          {latestReports.length === 0 && <p className={styles.emptyText}>최근 공개 제보가 없습니다.</p>}
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
        ref={moderationRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "moderation" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-moderation-heading"
      >
        <SectionTitle title="신고/차단 관리" caption={`${reviewAttentionCount}건 확인 필요`} headingId="my-moderation-heading" />
        <div className={styles.safetyStatusGrid}>
          <div>
            <ShieldAlert size={17} />
            <strong>신고 접수 {reports.length}건</strong>
            <span>장소, 사진, 댓글 신고는 운영 검토 큐와 연결됩니다.</span>
          </div>
          <div>
            <AlertTriangle size={17} />
            <strong>숨김 처리 {hiddenReportCount}건</strong>
            <span>민감정보 또는 반복 신고는 먼저 숨기고 확인합니다.</span>
          </div>
          <div>
            <UserX size={17} />
            <strong>차단/제한 0명</strong>
            <span>반복 악용 사용자는 운영자 제한 후 여기에 표시됩니다.</span>
          </div>
          <div>
            <Settings size={17} />
            <strong>문의/삭제 요청</strong>
            <span>지원 페이지와 TestFlight 피드백으로 처리 경로를 남깁니다.</span>
          </div>
        </div>
        <SectionTitle title="내 신고 내역" caption={`${latestModerationActivities.length}건`} />
        <div className={styles.followList} aria-label="내 신고 내역">
          {latestModerationActivities.map((activity) => (
            <article key={activity.id} className={styles.followListItem}>
              <ShieldAlert size={15} />
              <div>
                <strong>{activity.targetName}</strong>
                <span>
                  {moderationActivityTargetLabel(activity.targetType)} 신고 · {moderationActivityStatusLabel(activity.status)} · {reasonLabelForFlag(activity.reason)} · {minutesAgo(activity.createdAt)}
                </span>
                <span>{activity.message}</span>
              </div>
            </article>
          ))}
          {latestModerationActivities.length === 0 && <p className={styles.emptyText}>아직 접수한 신고가 없습니다. 장소, 사진, 댓글에서 신고하면 여기에 남습니다.</p>}
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
            <strong>반복 악용 제한</strong>
            <span>운영자 승인 후 write 제한</span>
          </div>
          <div>
            <ShieldAlert size={17} />
            <strong>숨김 처리 {hiddenReportCount}건</strong>
            <span>신고/숨김 내역은 운영 증거와 함께 확인</span>
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
          <p className={styles.eyebrow}>Desktop Preview</p>
          <h2>부산·경주·울산 현장 요약</h2>
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
          <button
            key={item.id}
            className={`${styles.navButton} ${isActive ? styles.navActive : ""} ${item.id === "report" ? styles.reportNav : ""}`}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={isActive}
          >
            <Icon size={item.id === "report" ? 22 : 19} />
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
          <h2>방금 올라온 장소 사진부터 보세요.</h2>
        </div>
        <ol>
          <li>사진으로 오늘 갈 곳의 분위기를 확인합니다.</li>
          <li>해시태그로 주차, 웨이팅, 한산함을 탐색합니다.</li>
          <li>올리기는 사진, 장소, 해시태그, 한 줄로 끝납니다.</li>
        </ol>
        <div className={styles.onboardingActions}>
          <button type="button" onClick={onClose}>바로 둘러보기</button>
          <button type="button" onClick={onGoReport}>사진 올리기</button>
          <button type="button" onClick={onGoMap}>지도 보기</button>
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
  onFlag,
  onHelpful,
  onOpenPlace,
  onShare,
  onSelectHashtag,
  helpfulActive,
}: {
  post: PublicPost;
  place: Place;
  onFlag: () => void;
  onHelpful: () => void;
  onOpenPlace: () => void;
  onShare: () => void;
  onSelectHashtag: (hashtagName: string) => void;
  helpfulActive: boolean;
}) {
  const verificationTooltip = post.locationVerified
    ? "현장 인증: 실제 GPS와 장소 반경만 검증하고 정확한 좌표는 저장하지 않습니다."
    : "상태 제보: 위치 인증 없이 작성되어 판단에는 낮은 가중치로 반영됩니다.";

  return (
    <article className={styles.feedPostCard}>
      <button className={`${styles.feedPhoto} ${styles[place.tone]}`} type="button" onClick={onOpenPlace}>
        <span>{post.photoLabel}</span>
        <strong>{post.judgement}</strong>
      </button>
      <div className={styles.feedPostBody}>
        <div className={styles.feedPostHeader}>
          <button type="button" onClick={onOpenPlace}>
            <strong>{place.name}</strong>
            <span>{minutesAgo(post.createdAt)} · {place.address}</span>
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
          {post.hashtagNames.slice(0, 5).map((tag) => (
            <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}>#{tag}</button>
          ))}
        </div>
        <div className={styles.feedActions}>
          <button className={helpfulActive ? styles.feedActionActive : ""} type="button" onClick={onHelpful}>
            <Heart size={15} />좋아요 {post.helpfulCount}
          </button>
          <button type="button" onClick={onOpenPlace}>
            <MessageCircleQuestion size={15} />댓글 {post.commentCount}
          </button>
          <button type="button" onClick={onShare}><Share2 size={15} />공유</button>
          <button type="button" onClick={onFlag}><MoreHorizontal size={15} />더보기</button>
        </div>
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

function uniqueApiPlacesById(places: ApiPlaceInput[], excludedIds = new Set<string>()): ApiPlaceInput[] {
  const seen = new Set(excludedIds);
  const unique: ApiPlaceInput[] = [];

  places.forEach((place) => {
    if (seen.has(place.id)) {
      return;
    }

    seen.add(place.id);
    unique.push(place);
  });

  return unique;
}

function mergePlaceLists(primary: Place[], secondary: Place[]): Place[] {
  const seen = new Set(primary.map((place) => place.id));

  return [...primary, ...secondary.filter((place) => !seen.has(place.id))];
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
        title: place?.name ?? "현장 제보",
        body: report.comment ?? `${crowdLabels[report.crowdLevel]} · 주차 ${parkingLabels[report.parkingStatus]}`,
        meta: `${minutesAgo(report.createdAt)} · ${report.verifiedRadiusM ? "현장 인증" : "미인증"} · ${report.photoUrl ? "사진 있음" : "사진 없음"}`,
        tone,
        verified: Boolean(report.verifiedRadiusM),
        hasPhoto: Boolean(report.photoUrl),
        createdAt: report.createdAt,
        hiddenAt: report.hiddenAt ?? null,
        crowdLevel: report.crowdLevel,
        lineStatus: report.lineStatus,
        parkingStatus: report.parkingStatus,
        weatherFeel,
      } satisfies Report & Pick<PublicReport, "crowdLevel" | "lineStatus" | "parkingStatus">;
    });
}

function reportFromPost(post: PublicPost, place: Place): Report {
  const tone = toneFromStatus(post.crowdLevel, post.parkingStatus);

  return {
    id: `post-report:${post.id}`,
    placeId: post.placeId,
    title: place.name,
    body: post.caption ?? `${crowdLabels[post.crowdLevel]} · 주차 ${parkingLabels[post.parkingStatus]}`,
    meta: `${minutesAgo(post.createdAt)} · ${post.locationVerified ? "현장 인증" : "상태 제보"} · ${post.photoCount > 0 ? "사진 있음" : "사진 없음"}`,
    tone,
    verified: post.locationVerified,
    hasPhoto: post.photoCount > 0,
    createdAt: post.createdAt,
    hiddenAt: post.hiddenAt,
    crowdLevel: post.crowdLevel,
    lineStatus: post.lineStatus,
    parkingStatus: post.parkingStatus,
    weatherFeel: post.weatherFeel,
  };
}

function mergePublicPosts(incoming: PublicPost[], current: PublicPost[]) {
  const seen = new Set<string>();

  return [...incoming, ...current]
    .filter((post) => {
      if (seen.has(post.id)) {
        return false;
      }

      seen.add(post.id);
      return true;
    })
    .slice(0, 100);
}

function mergeReports(incoming: Report[], current: Report[]) {
  const seen = new Set<string>();

  return [...incoming, ...current]
    .filter((report) => {
      if (seen.has(report.id)) {
        return false;
      }

      seen.add(report.id);
      return true;
    })
    .slice(0, 100);
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

  if (filter === "사진 있음") {
    return places;
  }

  return places;
}

function mapSearchFocusForQuery(query: string): MapFocusTarget | null {
  const normalizedQuery = normalizeMapSearchText(query);

  if (!normalizedQuery) {
    return null;
  }

  return mapSearchFocusTargets.find((target) => target.keywords.some((keyword) => normalizedQuery.includes(normalizeMapSearchText(keyword)))) ?? null;
}

function placesNearSearchFocus(places: Place[], searchFocus: MapFocusTarget) {
  return [...places]
    .sort((left, right) => distanceScore(left, searchFocus) - distanceScore(right, searchFocus))
    .slice(0, 10);
}

function distanceScore(place: Pick<Place, "latitude" | "longitude">, target: Pick<MapFocusTarget, "latitude" | "longitude">) {
  const latitudeDelta = place.latitude - target.latitude;
  const longitudeDelta = place.longitude - target.longitude;

  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
}

function normalizeMapSearchText(query: string) {
  return query.trim().toLocaleLowerCase("ko-KR").replace(/[\s·,._-]/g, "");
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
    return places.filter((place) => launchRegionIds.has(place.region) && isPlaceInLaunchRegionScope(place, place.region));
  }

  return places.filter((place) => place.region === region && isPlaceInLaunchRegionScope(place, region));
}

function filterHashtagsByPosts(hashtags: PublicHashtag[], posts: PublicPost[]) {
  const visibleHashtagNames = new Set(posts.flatMap((post) => post.hashtagNames));

  return hashtags.filter((hashtag) => visibleHashtagNames.has(hashtag.name));
}

function rankPlaces(places: Place[]) {
  return [...places].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko")).slice(0, 10);
}

function isPlaceInLaunchRegionScope(place: Place, region: RegionId) {
  const bounds = launchRegionBounds[region];

  return bounds ? isPlaceInBounds(place, bounds) : true;
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
      label: `${Math.max(1, Math.round(photo.byteSize / 1024))}KB 현장 사진`,
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
    }));
  const reportPhotos = reports
    .filter((report) => report.hasPhoto)
    .map((report) => ({
      id: `report:${report.id}`,
      label: report.title,
      meta: report.meta,
    }));

  return [...uploadedPhotos, ...postPhotos, ...reportPhotos].slice(0, 6);
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

function regionLabel(region: RegionTabId) {
  if (region === "busan") return "부산";
  if (region === "gyeongju") return "경주";
  if (region === "ulsan") return "울산";
  return "첫 지역";
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

function postMatchesFeedTab(post: PublicPost, place: Place | undefined, tab: FeedTab, followedHashtagNames: ReadonlySet<string>) {
  if (tab === "전체") {
    return true;
  }

  if (tab === "서울") {
    return place?.address.includes("서울") ?? false;
  }

  if (tab === "부산") {
    return place?.region === "busan" || Boolean(place?.address.includes("부산"));
  }

  if (tab === "제주") {
    return place?.address.includes("제주") ?? false;
  }

  if (tab === "내 주변") {
    return distanceKmFromLabel(place?.distance) <= 5;
  }

  return post.hashtagNames.some((tag) => followedHashtagNames.has(tag));
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

function placeClickPayload(place: Place) {
  return {
    id: place.id,
    name: place.name,
    categoryId: place.category,
    areaId: `${place.region}-tourapi`,
    regionId: place.region,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    score: place.score,
  };
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

function readPersistedUploadActivities(key: string): UploadActivity[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is UploadActivity => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;

      return (
        typeof candidate.id === "string" &&
        typeof candidate.placeId === "string" &&
        typeof candidate.placeName === "string" &&
        typeof candidate.caption === "string" &&
        (candidate.status === "reflected" || candidate.status === "failed") &&
        typeof candidate.message === "string" &&
        typeof candidate.createdAt === "string"
      );
    }).slice(0, 20);
  } catch {
    return [];
  }
}

function persistUploadActivities(key: string, activities: UploadActivity[]) {
  window.localStorage.setItem(key, JSON.stringify(activities.slice(0, 20)));
}

function readPersistedModerationActivities(key: string): ModerationActivity[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ModerationActivity => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;

      return (
        typeof candidate.id === "string" &&
        (candidate.targetType === "place" || candidate.targetType === "comment" || candidate.targetType === "photo" || candidate.targetType === "post") &&
        typeof candidate.targetName === "string" &&
        isFlagReason(candidate.reason) &&
        (candidate.status === "queued" || candidate.status === "hidden" || candidate.status === "local-preview") &&
        typeof candidate.message === "string" &&
        typeof candidate.createdAt === "string"
      );
    }).slice(0, 20);
  } catch {
    return [];
  }
}

function persistModerationActivities(key: string, activities: ModerationActivity[]) {
  window.localStorage.setItem(key, JSON.stringify(activities.slice(0, 20)));
}

function isFlagReason(value: unknown): value is FlagReason {
  return typeof value === "string" && postFlagReasonOptions.some((option) => option.id === value);
}

function reasonLabelForFlag(reason: FlagReason) {
  return postFlagReasonOptions.find((option) => option.id === reason)?.label ?? "기타";
}

function moderationActivityTargetLabel(targetType: ModerationActivity["targetType"]) {
  if (targetType === "comment") return "댓글";
  if (targetType === "photo") return "사진";
  if (targetType === "post") return "게시물";
  return "장소";
}

function moderationActivityStatusLabel(status: ModerationActivity["status"]) {
  if (status === "hidden") return "임시 숨김";
  if (status === "local-preview") return "로컬 기록";
  return "검토 대기";
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

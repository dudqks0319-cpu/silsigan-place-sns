"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bookmark,
  Camera,
  Car,
  CheckCircle2,
  ChevronLeft,
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
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudflareApiUrl, fetchJson, isCloudflareApiConfigured } from "@/lib/api-client";
import { buildScopedApiPath, normalizeRegionScope } from "@/lib/api-scope";
import {
  FAIL_CLOSED_PHOTO_UPLOAD_PROTECTION,
  normalizeCloudflareRuntimeConfig,
  type CloudflarePlaceStatus,
  type CloudflareRealtimeEvent,
  type CloudflareRealtimeRoom,
  type CloudflareRuntimeConfig,
} from "@/lib/cloudflare-api";
import { workerPlaceToAppPlace, workerPlacesToAppPlaces, type WorkerPlace } from "@/lib/cloudflare-place-adapter";
import { setAnalyticsTransportEnabled, trackEvent } from "@/lib/analytics";
import { rankPostsForFeed } from "@/lib/domain";
import { formatDistanceMeters, haversineDistanceMeters } from "@/lib/geo";
import { isRuntimeDataModeAllowed, shouldClearTruthBearingDataOnLoadFailure } from "@/lib/runtime-data-mode";
import { mergeReportCollections } from "@/lib/report-exploration";
import { fetchStaticPlaceDirectory } from "@/lib/static-place-snapshot";
import { acquirePhotoUploadTurnstileToken, type PhotoUploadProtection } from "@/lib/turnstile-client";
import {
  REALTIME_CONNECT_TIMEOUT_MS,
  REALTIME_POLL_INTERVAL_MS,
  mergeRealtimeEvents,
  parseRealtimeEventMessage,
  realtimeReconnectDelayMs,
  realtimeWebSocketUrl,
} from "@/lib/realtime-client";
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
import {
  DEFAULT_FEATURE_FLAGS,
  PHOTO_RIGHTS_TERMS_VERSION,
  locationAccuracyBucketForMeters,
  type FeatureFlagKey,
  type LocationAccuracyBucket,
} from "../../../packages/contracts/src/index.ts";

type View = "home" | "search" | "upload" | "map" | "place" | "ask" | "my";
type StatusTone = "calm" | "normal" | "busy" | "danger" | "unknown";
type Category = ReportCategory;
type DataMode = "live" | "sample" | "directory" | "unavailable";
type PublicDataSource = {
  sourceKey: string;
  sourceName: string;
  sourceType: string;
  enabled: boolean;
  healthStatus: "healthy" | "degraded" | "down" | "unknown";
  activationStatus: string;
};
type CloudflarePreferences = {
  savedPlaceIds: string[];
  savedPostIds: string[];
  followedTopicNames: string[];
  notificationEnabled: boolean;
  notificationPlatform: string;
};
type PreferenceMutation =
  | { kind: "saved_place" | "saved_post" | "followed_topic"; key: string; enabled: boolean }
  | {
      kind: "notifications";
      enabled: boolean;
      platform?: "webview" | "ios" | "android" | "web";
      pushTokenHash?: string | null;
    };
type PushTokenEventDetail = { platform: "ios" | "android"; token: string };
type ApiPlaceInput = ApiPlace & {
  rankingScore?: number;
};

const liveWriteUnavailableMessage = "실시간 API 보호 중에는 장소 위치만 볼 수 있습니다. 연결 복구 후 다시 시도해 주세요.";

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
  isSample: boolean;
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
  photoAttribution?: string | null;
  photoSourceUrl?: string | null;
  isSample?: boolean;
  createdAt: string;
  hiddenAt: string | null;
  moderationStatus: "pending" | "approved" | "rejected" | "hidden";
  crowdLevel?: CrowdLevel;
  lineStatus?: LineStatus;
  parkingStatus?: ParkingStatus;
  weatherFeel?: WeatherFeel;
  photoIds: string[];
  hashtagNames: string[];
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
  crowdLevel?: CrowdLevel;
  lineStatus?: LineStatus;
  parkingStatus?: ParkingStatus;
  weatherFeel?: WeatherFeel;
  localConditions?: string[];
  observations?: Array<{ dimension: string; valueCode: string; expiresAt: string }>;
  comment?: string | null;
  photoUrl?: string | null;
  photoAttribution?: string | null;
  photoSourceUrl?: string | null;
  isSample?: boolean;
  verifiedRadiusM: 50 | 150 | 300 | null;
  accuracyBucket?: LocationAccuracyBucket;
  locationVerified?: boolean;
  createdAt: string;
  expiresAt: string;
  flagCount?: number;
  hiddenAt?: string | null;
  moderationStatus?: "pending" | "approved" | "rejected" | "hidden";
  photoIds?: string[];
  hashtagNames?: string[];
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
  latestObservedAt: string | null;
  activePlaceCount: number;
  recentPhotoCount: number;
  recentMedia: Array<{
    id: string;
    placeId: string;
    category: ReportCategory;
    moderationStatus: "approved";
    photoIds: string[];
    hashtagNames: string[];
    createdAt: string;
    expiresAt: string;
  }>;
  nextCursor: string | null;
};

function buildHashtagApiPath(options: {
  name?: string;
  regionId?: string | null;
  placeId?: string | null;
  hasPhoto: boolean;
  activeOnly: boolean;
  sort: "recent";
  cursor?: string | null;
  limit?: number;
}) {
  const scopedPath = buildScopedApiPath("/api/hashtags", {
    regionId: options.regionId,
    placeId: options.placeId,
    limit: options.limit,
  });
  const [path, queryString = ""] = scopedPath.split("?");
  const params = new URLSearchParams(queryString);
  if (options.name) params.set("name", options.name);
  params.set("hasPhoto", String(options.hasPhoto));
  params.set("activeOnly", String(options.activeOnly));
  params.set("sort", options.sort);
  if (options.cursor) params.set("cursor", options.cursor);
  return `${path}?${params.toString()}`;
}

function hashtagMediaToReports(
  mediaItems: PublicHashtag["recentMedia"],
  hashtagName: string,
  places: Place[],
): Report[] {
  const placeNames = new Map(places.map((place) => [place.id, place.name]));
  return mediaItems.map((media) => ({
    id: media.id,
    placeId: media.placeId,
    title: placeNames.get(media.placeId) ?? "지금컷",
    body: `#${hashtagName} 현장 사진 제보`,
    meta: `${minutesAgo(media.createdAt)} · 사용자 제보 · 사진 있음`,
    tone: "unknown",
    verified: false,
    hasPhoto: media.photoIds.length > 0,
    createdAt: media.createdAt,
    hiddenAt: null,
    moderationStatus: media.moderationStatus,
    photoIds: media.photoIds,
    hashtagNames: media.hashtagNames,
  }));
}

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
  isSample?: boolean;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  hashtags: PublicHashtag[];
  shareCard: ShareCard;
  safetyWarning: string | null;
  hiddenAt: string | null;
  createdAt: string;
};

type FieldReportSubmitResult = {
  report: PublicReport & {
    localConditions: string[];
    observations: Array<{ dimension: string; valueCode: string; expiresAt: string }>;
  };
  credits: { amount: number }[];
  safetyWarning?: string | null;
  privacyNotice?: string;
  publication?: {
    clientRequestId: string | null;
    photoIds: string[];
    hashtagNames: string[];
  };
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

type PlaceAdditionRequestStatus = "needs_verification" | "ready_for_manual_import" | "duplicate" | "rejected";

type PlaceAdditionRequest = {
  id: string;
  clientRequestId: string;
  name: string;
  address: string;
  category: string;
  status: PlaceAdditionRequestStatus;
  matchedPlaceId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

type PlaceAdditionRequestDraft = {
  name: string;
  address: string;
  category: string;
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
  rightsPolicyVersion: typeof PHOTO_RIGHTS_TERMS_VERSION;
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
  ownedByCurrentSession: boolean;
};

type UserBlock = {
  id: string;
  createdAt: string;
  label: string;
};

type MyMenuTarget = "reports" | "placeRequests" | "questions" | "saved" | "hashtags" | "badges" | "safety" | "account";
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

type LocationVerificationStatus = "idle" | "requesting" | "verified" | "low_accuracy" | "denied" | "unsupported";

type ClientLocation = {
  latitude: number;
  longitude: number;
  accuracyM: number;
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
    pickedLocalConditions: string[];
    photoAttached: boolean;
    reportText: string;
  }>;
};

type PlaceTab = "실시간" | "사진" | "질문" | "해시태그" | "근처";

const presentationByPlaceId: Record<string, Pick<Place, "x" | "y">> = {
  "ulsan-taehwagang": { x: 31, y: 47 },
  "busan-gwangalli": { x: 65, y: 39 },
  "gyeongju-hwangridan": { x: 52, y: 62 },
  "ulsan-city-hall": { x: 37, y: 74 },
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
const reportChips = ["여유", "보통", "혼잡", "매우 혼잡", "확인하지 못함"];
const parkingChips = ["여유", "일부 남음", "거의 만차", "만차", "폐쇄", "확인하지 못함"];
const lineChips = ["없음", "10분 이하", "10~30분", "30~60분", "60분 이상", "확인하지 못함"];
const localConditionChips = ["비", "눈", "강풍", "노면 미끄러움", "입장 제한", "행사 진행", "임시 휴무로 보임", "확인하지 못함"];
const questionExamples = ["주차 자리 있나요?", "줄 많이 긴가요?", "사진으로 볼 수 있나요?", "아이랑 가도 괜찮나요?"];
const quickReportPresets: QuickReportPreset[] = [
  {
    id: "parking-full",
    label: "주차 만차",
    description: "주차장이 거의 만차예요.",
    patch: { pickedParking: "만차", reportText: "주차장이 만차예요.", photoAttached: false },
  },
  {
    id: "line-long",
    label: "줄 길어요",
    description: "대기줄이 꽤 길어요.",
    patch: { pickedLine: "30~60분", reportText: "대기줄이 꽤 길어요.", photoAttached: false },
  },
  {
    id: "quiet",
    label: "한산해요",
    description: "지금은 가기 좋아요.",
    patch: { pickedCrowd: "여유", reportText: "지금은 사람이 많지 않아요.", photoAttached: false },
  },
  {
    id: "crowd-busy",
    label: "사람 많아요",
    description: "현장이 꽤 붐벼요.",
    patch: { pickedCrowd: "혼잡", reportText: "지금 사람이 많아서 출발 전 확인이 필요해요.", photoAttached: false },
  },
    {
      id: "photo-spot",
      label: "사진스팟 상태",
      description: "사진 찍기 좋은 상태예요.",
      patch: { pickedCrowd: "보통", reportText: "사진으로 확인한 현재 상태예요.", photoAttached: false },
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
const FUTURE_TIMESTAMP_TOLERANCE_MS = 2 * 60_000;
const initialDataFetchTimeoutMs = 6_000;
const workerPhotoPlaceScopeLimit = 20;
const workerPhotoLimitPerPlace = 12;
// 운영 캠페인과 현장 질문은 서버의 기간·지역·승인 상태가 연결될 때까지 공개하지 않습니다.
// 오래된 정적 fixture를 남겨 두면 기능 flag를 실수로 켰을 때 과거 이벤트가 재노출될 수 있습니다.
const challenges: Challenge[] = [];
const fieldQuests: FieldQuest[] = [];

function isChallengeActive(challenge: Pick<Challenge, "startsAt" | "endsAt">, now = new Date()) {
  return isDateRangeActive(challenge.startsAt, challenge.endsAt, now);
}

function isFieldQuestActive(quest: Pick<FieldQuest, "expiresAt">, now = new Date()) {
  const expiresAt = Date.parse(quest.expiresAt);
  return Number.isFinite(expiresAt) && now.getTime() < expiresAt;
}

function isDateRangeActive(startsAtValue: string, endsAtValue: string, now: Date) {
  const startsAt = Date.parse(startsAtValue);
  const endsAt = Date.parse(
    endsAtValue.includes("T") ? endsAtValue : `${endsAtValue}T23:59:59.999Z`,
  );

  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now.getTime() && now.getTime() <= endsAt;
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
  const placeReturnTargetRef = useRef<{ view: View; scrollTop: number }>({ view: "home", scrollTop: 0 });
  const askReturnScrollRef = useRef(0);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const consumedPlaceDeepLinkRef = useRef("");
  const [focusedReportId, setFocusedReportId] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [hashtagMediaReports, setHashtagMediaReports] = useState<Report[]>([]);
  const [hashtagMediaNextCursor, setHashtagMediaNextCursor] = useState<string | null>(null);
  const [hashtagMediaLoadingMore, setHashtagMediaLoadingMore] = useState(false);
  const [myReports, setMyReports] = useState<Report[]>([]);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [allPosts, setAllPosts] = useState<PublicPost[]>([]);
  const [workerPhotos, setWorkerPhotos] = useState<WorkerPhoto[]>([]);
  const [workerCommentsByPlaceId, setWorkerCommentsByPlaceId] = useState<Record<string, PlaceComment[]>>({});
  const [userBlocks, setUserBlocks] = useState<UserBlock[]>([]);
  const [hashtags, setHashtags] = useState<PublicHashtag[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [myQuestions, setMyQuestions] = useState<MyQuestion[]>([]);
  const [placeAdditionRequests, setPlaceAdditionRequests] = useState<PlaceAdditionRequest[]>([]);
  const [placeAdditionRequestSubmitting, setPlaceAdditionRequestSubmitting] = useState(false);
  const placeAdditionRequestIdsRef = useRef<Map<string, string>>(new Map());
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [reportPlaceId, setReportPlaceId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState(filterLabels[0]);
  const [reportText, setReportText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickedCrowd, setPickedCrowd] = useState("");
  const [pickedParking, setPickedParking] = useState("");
  const [pickedLine, setPickedLine] = useState("");
  const [pickedLocalConditions, setPickedLocalConditions] = useState<Set<string>>(() => new Set());
  const [photoAttached, setPhotoAttached] = useState(false);
  const [attachedPhotoIds, setAttachedPhotoIds] = useState<string[]>([]);
  const reportRequestIdRef = useRef<string | null>(null);
  const reportStartedAtRef = useRef<number | null>(null);
  const [locationVerificationStatus, setLocationVerificationStatus] = useState<LocationVerificationStatus>("idle");
  const [verifiedLocation, setVerifiedLocation] = useState<ClientLocation | null>(null);
  const [selectedHashtagName, setSelectedHashtagName] = useState<string | null>(null);
  const [followedPlaceIds, setFollowedPlaceIds] = useState<Set<string>>(() => new Set());
  const [followedHashtagNames, setFollowedHashtagNames] = useState<Set<string>>(() => new Set());
  const [helpfulPostIds, setHelpfulPostIds] = useState<Set<string>>(() => new Set());
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenCreatorNames, setHiddenCreatorNames] = useState<Set<string>>(() => new Set());
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const notificationEnabledRef = useRef(false);
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
  const hasLoadedDirectoryRef = useRef(false);
  const preferencesSyncLoadedRef = useRef(false);
  const [mapPreviewPlaceId, setMapPreviewPlaceId] = useState("");
  const [mapLocationPermission, setMapLocationPermission] = useState<LocationPermissionState>("idle");
  const [mapCurrentLocation, setMapCurrentLocation] = useState<UiLocation | null>(null);
  const [likedPlaceIds, setLikedPlaceIds] = useState<Set<string>>(() => new Set());
  const [liveConnection, setLiveConnection] = useState<"connecting" | "live" | "polling">("polling");

  useEffect(() => {
    setAnalyticsTransportEnabled(false);
    return () => setAnalyticsTransportEnabled(true);
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setToast(""), 3_500);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);
  const [realtimeEventsByPlaceId, setRealtimeEventsByPlaceId] = useState<Record<string, CloudflareRealtimeEvent[]>>({});
  const [dataMode, setDataMode] = useState<DataMode>("unavailable");
  const [featureFlags, setFeatureFlags] = useState<Record<FeatureFlagKey, boolean>>({ ...DEFAULT_FEATURE_FLAGS });
  const [photoUploadProtection, setPhotoUploadProtection] = useState<PhotoUploadProtection>({
    ...FAIL_CLOSED_PHOTO_UPLOAD_PROTECTION,
  });
  const [placeStatuses, setPlaceStatuses] = useState<Record<string, CloudflarePlaceStatus>>({});
  const [publicDataSources, setPublicDataSources] = useState<PublicDataSource[]>([]);
  const [placeStatusLoading, setPlaceStatusLoading] = useState(false);
  const cloudflareApiConfigured = useMemo(() => isCloudflareApiConfigured(), []);
  const photoUploadReady = dataMode === "live" && cloudflareApiConfigured && (
    !photoUploadProtection.turnstileRequired || Boolean(photoUploadProtection.turnstileSiteKey)
  );
  const activeDataRegionId = useMemo(() => normalizeRegionScope(activeRegion), [activeRegion]);
  const mapBoundsKey = mapBounds ? mapBoundsToBboxParam(mapBounds) : "";
  const normalizedMapSearchQuery = useMemo(() => normalizePlaceSearchQuery(mapSearchQuery) ?? "", [mapSearchQuery]);
  const syncPreference = useCallback(async (mutation: PreferenceMutation) => {
    if (!cloudflareApiConfigured || dataMode !== "live") {
      return;
    }

    try {
      await fetchJson<CloudflarePreferences>(cloudflareApiUrl("/api/preferences"), {
        method: "POST",
        body: JSON.stringify(mutation),
      });
    } catch {
      setToast("설정을 서버에 동기화하지 못했습니다. 이 기기에 저장된 내용은 유지됩니다.");
    }
  }, [cloudflareApiConfigured, dataMode]);
  const loadMyPlaceAdditionRequests = useCallback(async () => {
    if (!cloudflareApiConfigured || dataMode !== "live") {
      return;
    }

    try {
      const requests = await fetchJson<PlaceAdditionRequest[]>(cloudflareApiUrl("/api/place-requests?mine=1"));
      setPlaceAdditionRequests(requests);
    } catch {
      setToast("장소 추가 요청 상태를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.");
    }
  }, [cloudflareApiConfigured, dataMode]);
  const displayPlaces = useMemo(
    () => sortPlacesByLocation(
      places.map((place) => placeWithV2Status(place, placeStatuses[place.id], dataMode)),
      mapCurrentLocation,
    ),
    [dataMode, mapCurrentLocation, placeStatuses, places],
  );

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
    () => displayPlaces.find((place) => place.id === selectedPlaceId) ?? displayPlaces[0] ?? null,
    [displayPlaces, selectedPlaceId],
  );
  const reportPlace = useMemo(
    () => displayPlaces.find((place) => place.id === reportPlaceId) ?? null,
    [displayPlaces, reportPlaceId],
  );
  const selectedPlaceStatus = selectedPlace ? placeStatuses[selectedPlace.id] ?? null : null;

  const mapPreviewPlace = useMemo(
    () => displayPlaces.find((place) => place.id === mapPreviewPlaceId) ?? null,
    [displayPlaces, mapPreviewPlaceId],
  );
  const realtimePlaceId = mapPreviewPlaceId || (activeView === "place" ? selectedPlace?.id ?? "" : "");

  const visibleReports = useMemo(
    () => mergeReportCollections(reports, hashtagMediaReports),
    [hashtagMediaReports, reports],
  );

  const selectedReports = useMemo(
    () => visibleReports.filter((report) => report.placeId === selectedPlace?.id),
    [selectedPlace?.id, visibleReports],
  );

  const selectedPosts = useMemo(
    () => rankedPosts.filter((post) => post.placeId === selectedPlace?.id),
    [rankedPosts, selectedPlace?.id],
  );

  const activeChallenges = useMemo(
    () => featureFlags.REWARDS_ENABLED ? challenges.filter((challenge) => isChallengeActive(challenge)) : [],
    [featureFlags.REWARDS_ENABLED],
  );
  const activeFieldQuests = useMemo(
    () => featureFlags.QNA_ENABLED ? fieldQuests.filter((quest) => isFieldQuestActive(quest)) : [],
    [featureFlags.QNA_ENABLED],
  );

  const recommendedTags = useMemo(() => {
    if (!selectedPlace) {
      return [];
    }

    const baseTags = [`${selectedPlace.name}지금`, "지금"];
    const challengeTag = selectedHashtagName && activeChallenges.some((challenge) => challenge.hashtagName === selectedHashtagName)
      ? selectedHashtagName
      : null;

    return challengeTag ? [challengeTag, ...baseTags.filter((tag) => tag !== challengeTag)].slice(0, 5) : baseTags;
  }, [activeChallenges, selectedHashtagName, selectedPlace]);

  const loadData = useCallback(async (options: {
    silent?: boolean;
    bounds?: MapBounds | null;
    query?: string | null;
    allowLiveRecovery?: boolean;
  } = {}) => {
    if (options.silent && hasLoadedDirectoryRef.current && !options.allowLiveRecovery) {
      return "directory" as const;
    }
    if (!options.silent) {
      setLoading(true);
    }
    const clearTruthBearingData = () => {
      setPlaces([]);
      setReports([]);
      setHashtagMediaReports([]);
      setHashtagMediaNextCursor(null);
      setSelectedHashtagName(null);
      setMyReports([]);
      setPosts([]);
      setAllPosts([]);
      setWorkerPhotos([]);
      setWorkerCommentsByPlaceId({});
      setRealtimeEventsByPlaceId({});
      setLiveConnection("polling");
      setUserBlocks([]);
      setPlaceStatuses({});
      setPublicDataSources([]);
      setHashtags([]);
      setQuestions([]);
      setMyQuestions([]);
      setPlaceAdditionRequests([]);
      setSelectedPlaceId("");
      setReportPlaceId(null);
      setMapPreviewPlaceId("");
      setFocusedReportId(null);
      setFeatureFlags({ ...DEFAULT_FEATURE_FLAGS });
      setPhotoUploadProtection({ ...FAIL_CLOSED_PHOTO_UPLOAD_PROTECTION });
      hasLoadedLiveDataRef.current = false;
      hasLoadedDirectoryRef.current = false;
    };
    try {
      if (!cloudflareApiConfigured && process.env.NODE_ENV === "production") {
        throw new Error("실시간 API가 설정되지 않아 운영 데이터를 표시할 수 없습니다.");
      }
      const runtimeConfig: CloudflareRuntimeConfig = cloudflareApiConfigured
        ? normalizeCloudflareRuntimeConfig(
            await fetchJsonWithTimeout<unknown>(
              cloudflareApiUrl(activeDataRegionId ? `/api/config?regionCode=${encodeURIComponent(activeDataRegionId)}` : "/api/config"),
            ),
          )
        : {
            contractVersion: 2,
            dataMode: "demo",
            featureFlags: { ...DEFAULT_FEATURE_FLAGS },
            dimensionSettings: [],
            photoUploadProtection: { turnstileRequired: false, turnstileSiteKey: null },
          };
      if (!isRuntimeDataModeAllowed(process.env.NODE_ENV, runtimeConfig.dataMode)) {
        clearTruthBearingData();
        setDataMode("unavailable");
        throw new Error("운영 환경에서는 확인된 실시간 데이터만 표시할 수 있습니다.");
      }
      setFeatureFlags(runtimeConfig.featureFlags);
      setPhotoUploadProtection(runtimeConfig.photoUploadProtection);
      const listScope = { regionId: activeDataRegionId, limit: 100 };
      const placesScope = {
        ...listScope,
        bbox: options.bounds ? mapBoundsToBboxParam(options.bounds) : undefined,
        q: normalizePlaceSearchQuery(options.query),
      };
      const socialFeedEnabled = runtimeConfig.featureFlags.SOCIAL_FEED_ENABLED;
      const placesRequest: Promise<ApiPlaceInput[]> = cloudflareApiConfigured
        ? fetchJsonWithTimeout<WorkerPlace[]>(cloudflareApiUrl(buildScopedApiPath("/api/places", placesScope))).then(workerPlacesToAppPlaces)
        : fetchJsonWithTimeout<ApiPlace[]>(buildScopedApiPath("/api/places", placesScope));
      const reportsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicReport[]>(cloudflareApiUrl(buildScopedApiPath("/api/reports", listScope)))
        : fetchJsonWithTimeout<PublicReport[]>(buildScopedApiPath("/api/reports", listScope));
      const myReportsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicReport[]>(cloudflareApiUrl(buildScopedApiPath("/api/reports", { ...listScope, mine: true }))).catch(() => [])
        : fetchJsonWithTimeout<PublicReport[]>(buildScopedApiPath("/api/reports", { ...listScope, mine: true })).catch(() => []);
      const postsRequest = socialFeedEnabled
        ? cloudflareApiConfigured
          ? fetchJsonWithTimeout<PublicPost[]>(cloudflareApiUrl(buildScopedApiPath("/api/posts", listScope)))
          : fetchJsonWithTimeout<PublicPost[]>(buildScopedApiPath("/api/posts", listScope))
        : Promise.resolve<PublicPost[]>([]);
      const hashtagsRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicHashtag[]>(cloudflareApiUrl(buildHashtagApiPath({
            regionId: activeDataRegionId,
            hasPhoto: true,
            activeOnly: true,
            sort: "recent",
          }))).catch(() => [])
        : fetchJsonWithTimeout<PublicHashtag[]>(buildHashtagApiPath({
            regionId: activeDataRegionId,
            hasPhoto: true,
            activeOnly: true,
            sort: "recent",
          })).catch(() => []);
      const questionsRequest = runtimeConfig.featureFlags.QNA_ENABLED
        ? cloudflareApiConfigured
          ? fetchJsonWithTimeout<PublicQuestion[]>(cloudflareApiUrl(buildScopedApiPath("/api/questions", listScope)))
          : fetchJsonWithTimeout<PublicQuestion[]>(buildScopedApiPath("/api/questions", listScope))
        : Promise.resolve<PublicQuestion[]>([]);
      const myQuestionsRequest = runtimeConfig.featureFlags.QNA_ENABLED
        ? cloudflareApiConfigured
          ? fetchJsonWithTimeout<MyQuestion[]>(cloudflareApiUrl("/api/my-questions")).catch(() => [])
          : fetchJsonWithTimeout<MyQuestion[]>("/api/my-questions").catch(() => [])
        : Promise.resolve<MyQuestion[]>([]);
      const publicDataSourcesRequest = cloudflareApiConfigured
        ? fetchJsonWithTimeout<PublicDataSource[]>(cloudflareApiUrl("/api/sources")).catch(() => [])
        : Promise.resolve<PublicDataSource[]>([]);
      const [apiPlaces, apiReports, apiMyReports, apiPosts, apiHashtags, apiQuestions, apiMyQuestions, apiPublicDataSources] = await Promise.all([
        placesRequest,
        reportsRequest,
        myReportsRequest,
        postsRequest,
        hashtagsRequest,
        questionsRequest,
        myQuestionsRequest,
        publicDataSourcesRequest,
      ]);
      const mappedReports = mapReports(apiReports, apiPlaces);
      const mappedMyReports = mapReports(apiMyReports, apiPlaces);
      const mappedQuestions = mapQuestions(apiQuestions);
      const mappedPlaces = mapPlaces(apiPlaces, mappedReports);
      const scopedPlaceIds = mappedPlaces.map((place) => place.id);
      const [apiWorkerPhotos, apiWorkerComments, apiUserBlocks, apiPlaceStatuses] = cloudflareApiConfigured
        ? await Promise.all([
            fetchWorkerPhotosForPlaces(scopedPlaceIds),
            fetchWorkerCommentsForPlaces(scopedPlaceIds),
            fetchJsonWithTimeout<UserBlock[]>(cloudflareApiUrl("/api/blocks")).catch(() => []),
            fetchWorkerStatusesForPlaces(scopedPlaceIds),
          ])
        : [[], {}, [], {}] as [WorkerPhoto[], Record<string, PlaceComment[]>, UserBlock[], Record<string, CloudflarePlaceStatus>];

      setPlaces(mappedPlaces);
      setReports(mappedReports);
      setMyReports(mappedMyReports);
      setPosts(apiPosts);
      setAllPosts(apiPosts);
      setWorkerPhotos((current) => mergeWorkerPhotos(apiWorkerPhotos, filterWorkerPhotosByPlaceIds(current, scopedPlaceIds)).slice(0, 80));
      setWorkerCommentsByPlaceId(apiWorkerComments);
      setUserBlocks(apiUserBlocks);
      setPlaceStatuses((current) => ({ ...current, ...apiPlaceStatuses }));
      setPublicDataSources(apiPublicDataSources);
      setHashtags(apiHashtags);
      setQuestions(mappedQuestions);
      setMyQuestions(apiMyQuestions);
      setSelectedPlaceId((current) => mappedPlaces.find((place) => place.id === current)?.id ?? mappedPlaces[0]?.id ?? "");
      hasLoadedLiveDataRef.current = true;
      hasLoadedDirectoryRef.current = false;
      setAnalyticsTransportEnabled(true);
      setDataMode(runtimeConfig.dataMode === "live" ? "live" : "sample");
      trackEvent("nearby_loaded", { resultCount: mappedPlaces.length, dataMode: runtimeConfig.dataMode });
      return runtimeConfig.dataMode === "live" ? "live" as const : "sample" as const;
    } catch (error) {
      if (process.env.NODE_ENV === "production" || cloudflareApiConfigured) {
        try {
          const directory = await fetchStaticPlaceDirectory({
            regionId: activeDataRegionId,
            limit: 100,
          });
          const mappedPlaces = mapPlaces(directory.places, []);
          clearTruthBearingData();
          setPlaces(mappedPlaces);
          setSelectedPlaceId(mappedPlaces[0]?.id ?? "");
          hasLoadedDirectoryRef.current = true;
          setAnalyticsTransportEnabled(false);
          setDataMode("directory");
          if (!options.silent) {
            setToast("실시간 API 보호 중이라 검증된 기본 장소 위치만 보여드립니다.");
          }
          return "directory" as const;
        } catch {
          // A malformed or unavailable snapshot must fail closed instead of becoming live-looking data.
        }
      }

      const preserveDirectory = options.silent && hasLoadedDirectoryRef.current;
      if (!preserveDirectory && shouldClearTruthBearingDataOnLoadFailure(process.env.NODE_ENV)) {
        clearTruthBearingData();
        setAnalyticsTransportEnabled(false);
        setDataMode("unavailable");
      } else if (!preserveDirectory && !options.silent && !hasLoadedLiveDataRef.current) {
        clearTruthBearingData();
        setAnalyticsTransportEnabled(false);
        setDataMode("unavailable");
      }

      if (!options.silent) {
        trackEvent("nearby_load_failed", { reason: "request_failed" });
        setToast(error instanceof Error ? error.message : "실시간 데이터를 불러오지 못했습니다.");
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [activeDataRegionId, cloudflareApiConfigured]);

  useEffect(() => {
    const scrollTop = pendingScrollRestoreRef.current ?? 0;
    pendingScrollRestoreRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      if (phoneBodyRef.current) {
        phoneBodyRef.current.scrollTop = scrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView]);

  const returnFromDetail = useCallback(() => {
    if (activeView === "ask") {
      pendingScrollRestoreRef.current = askReturnScrollRef.current;
      setActiveView("place");
      return;
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("place");
    currentUrl.searchParams.delete("report");
    window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    consumedPlaceDeepLinkRef.current = "";
    setFocusedReportId(null);

    const target = placeReturnTargetRef.current;
    pendingScrollRestoreRef.current = target.scrollTop;
    setActiveView(target.view === "place" || target.view === "ask" ? "home" : target.view);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "place" && activeView !== "ask") {
      return;
    }

    const handleBackShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "ArrowLeft" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (target instanceof HTMLElement && Boolean(target.closest('a, button, input, textarea, select, [role="tab"], [contenteditable="true"]')))
      ) {
        return;
      }
      event.preventDefault();
      returnFromDetail();
    };

    window.addEventListener("keydown", handleBackShortcut);
    return () => window.removeEventListener("keydown", handleBackShortcut);
  }, [activeView, returnFromDetail]);

  useEffect(() => {
    if (activeView === "map") {
      trackEvent("map_viewed");
    }
  }, [activeView]);

  useEffect(() => {
    if (activeView === "place" && selectedPlace && selectedPlaceStatus?.dataMode === "live") {
      trackEvent("live_status_viewed", { placeId: selectedPlace.id });
    }
  }, [activeView, selectedPlace, selectedPlaceStatus?.dataMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const placeId = searchParams.get("place")?.trim() ?? "";
    const requestedReportId = searchParams.get("report")?.trim() ?? "";
    const deepLinkKey = `${placeId}:${requestedReportId}`;
    if (!placeId || consumedPlaceDeepLinkRef.current === deepLinkKey) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      consumedPlaceDeepLinkRef.current = deepLinkKey;
      if (!isSafeDeepLinkId(placeId) || (requestedReportId && !isSafeDeepLinkId(requestedReportId))) {
        setFocusedReportId(null);
        setToast("공유 링크 형식이 올바르지 않습니다.");
        return;
      }

      void (async () => {
        let deepLinkedPlace = displayPlaces.find((place) => place.id === placeId) ?? null;
        let deepLinkedReports = visibleReports.filter((report) => report.placeId === placeId);

        try {
          const shouldFetchExactScope = cloudflareApiConfigured && dataMode === "live" && (
            !deepLinkedPlace || Boolean(requestedReportId && !deepLinkedReports.some((report) => report.id === requestedReportId))
          );

          if (shouldFetchExactScope) {
            const [exactApiPlace, exactApiReports, exactWorkerPhotos] = await Promise.all([
              deepLinkedPlace
                ? Promise.resolve<ApiPlaceInput | null>(null)
                : fetchJsonWithTimeout<WorkerPlace>(
                    cloudflareApiUrl(`/api/places/${encodeURIComponent(placeId)}`),
                    { signal: controller.signal },
                  ).then(workerPlaceToAppPlace),
              fetchJsonWithTimeout<PublicReport[]>(
                cloudflareApiUrl(buildScopedApiPath("/api/reports", { placeId, limit: 100 })),
                { signal: controller.signal },
              ),
              fetchJsonWithTimeout<WorkerPhoto[]>(
                cloudflareApiUrl(buildScopedApiPath("/api/photos", { placeId, limit: workerPhotoLimitPerPlace })),
                { signal: controller.signal },
              ).catch(() => []),
            ]);
            if (!active) return;

            const exactReports = mapReports(exactApiReports, exactApiPlace ? [exactApiPlace] : []);
            deepLinkedReports = mergeReportCollections(exactReports, deepLinkedReports);
            if (!deepLinkedPlace && exactApiPlace) {
              deepLinkedPlace = mapPlaces([exactApiPlace], exactReports)[0] ?? null;
            }

            if (deepLinkedPlace) {
              const exactPlace = deepLinkedPlace;
              setPlaces((current) => current.some((place) => place.id === exactPlace.id) ? current : [...current, exactPlace]);
            }
            setReports((current) => mergeReportCollections(exactReports, current));
            setWorkerPhotos((current) => mergeWorkerPhotos(exactWorkerPhotos, current).slice(0, 80));
          }
        } catch {
          if (!active) return;
          deepLinkedPlace = null;
        }

        if (!active) return;
        if (!deepLinkedPlace) {
          setFocusedReportId(null);
          setToast("공유된 장소를 찾지 못했습니다. 전국 검색에서 다시 확인해 주세요.");
          return;
        }

        const reportFound = !requestedReportId || deepLinkedReports.some((report) => report.id === requestedReportId);
        placeReturnTargetRef.current = { view: "home", scrollTop: 0 };
        setSelectedPlaceId(deepLinkedPlace.id);
        setFocusedReportId(reportFound && requestedReportId ? requestedReportId : null);
        setActiveView("place");
        trackEvent("place_deep_link_opened", {
          placeId: deepLinkedPlace.id,
          reportId: reportFound && requestedReportId ? requestedReportId : null,
        });
        if (requestedReportId) {
          setToast(reportFound
            ? "공유된 현장 제보 위치로 이동했습니다."
            : "공유된 제보는 만료되었거나 비공개입니다. 장소의 최신 정보로 이동했습니다.");
        }
      })();
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cloudflareApiConfigured, dataMode, displayPlaces, loading, visibleReports]);

  useEffect(() => {
    if (!cloudflareApiConfigured || dataMode !== "live" || activeView !== "place" || !selectedPlace) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setPlaceStatusLoading(true);
      void fetchJsonWithTimeout<CloudflarePlaceStatus>(
        cloudflareApiUrl(`/api/places/${encodeURIComponent(selectedPlace.id)}/status`),
        { signal: controller.signal },
      )
        .then((status) => {
          if (!active) return;
          setPlaceStatuses((current) => ({ ...current, [selectedPlace.id]: status }));
        })
        .catch(() => {
          if (!active) return;
          setPlaceStatuses((current) => {
            const next = { ...current };
            delete next[selectedPlace.id];
            return next;
          });
        })
        .finally(() => {
          if (active) setPlaceStatusLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeView, cloudflareApiConfigured, dataMode, selectedPlace]);

  useEffect(() => {
    if (dataMode === "directory" || dataMode === "unavailable") {
      return;
    }
    const timer = window.setInterval(() => {
      void loadData({
        silent: true,
        bounds: activeView === "map" ? mapBoundsRef.current : null,
        query: activeView === "map" ? normalizedMapSearchQuery : null,
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [activeView, dataMode, loadData, normalizedMapSearchQuery]);

  const requeryCurrentMap = useCallback(async () => {
    if (mapRequerying) {
      return;
    }

    setMapRequerying(true);
    try {
      lastMapBoundsFetchKeyRef.current = "";
      const result = await loadData({
        silent: true,
        bounds: mapBoundsRef.current,
        query: normalizedMapSearchQuery,
        allowLiveRecovery: true,
      });
      setToast(result === "directory"
        ? "실시간 연결을 다시 확인했지만 보호 모드를 유지합니다. 기본 장소 위치만 표시합니다."
        : mapBoundsRef.current
          ? "현재 지도 화면 기준으로 다시 불러왔습니다."
          : "현재 검색어 기준으로 장소를 다시 불러왔습니다.");
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
    notificationEnabledRef.current = notificationEnabled;
  }, [notificationEnabled]);

  useEffect(() => {
    if (!persistenceReady || !cloudflareApiConfigured || dataMode !== "live" || preferencesSyncLoadedRef.current) {
      return;
    }

    preferencesSyncLoadedRef.current = true;
    let active = true;
    void fetchJson<CloudflarePreferences>(cloudflareApiUrl("/api/preferences"))
      .then((preferences) => {
        if (!active) {
          return;
        }

        setFollowedPlaceIds(new Set(preferences.savedPlaceIds));
        setSavedPostIds(new Set(preferences.savedPostIds));
        setFollowedHashtagNames(new Set(preferences.followedTopicNames));
        setNotificationEnabled(preferences.notificationEnabled);
      })
      .catch(() => {
        if (active) {
          preferencesSyncLoadedRef.current = false;
        }
      });

    return () => {
      active = false;
    };
  }, [cloudflareApiConfigured, dataMode, persistenceReady]);

  useEffect(() => {
    const handlePushToken = (event: Event) => {
      const detail = (event as CustomEvent<PushTokenEventDetail>).detail;
      if (
        !detail ||
        (detail.platform !== "ios" && detail.platform !== "android") ||
        typeof detail.token !== "string" ||
        !notificationEnabledRef.current ||
        !cloudflareApiConfigured ||
        dataMode !== "live"
      ) {
        return;
      }

      void hashPushToken(detail.token).then((pushTokenHash) => {
        if (!pushTokenHash) {
          return;
        }

        void syncPreference({
          kind: "notifications",
          enabled: true,
          platform: detail.platform,
          pushTokenHash,
        });
      });
    };

    window.addEventListener("silsigan:push-token", handlePushToken);
    return () => window.removeEventListener("silsigan:push-token", handlePushToken);
  }, [cloudflareApiConfigured, dataMode, notificationEnabled, syncPreference]);

  useEffect(() => {
    trackEvent("app_opened");
  }, []);

  useEffect(() => {
    if (activeView === "home") {
      trackEvent("view_home");
    }

    if (activeView === "place" && selectedPlace) {
      trackEvent("view_place", { placeId: selectedPlace.id });
    }
  }, [activeView, selectedPlace]);

  useEffect(() => {
    if (!cloudflareApiConfigured || dataMode !== "live" || !realtimePlaceId) {
      return;
    }

    let active = true;
    let loadedOnce = false;
    let socket: WebSocket | null = null;
    let pollingTimerId: number | null = null;
    let reconnectTimerId: number | null = null;
    let connectTimeoutId: number | null = null;
    let reconnectAttempt = 0;
    const roomPath = `/api/realtime/place/${encodeURIComponent(realtimePlaceId)}`;
    const roomHttpUrl = cloudflareApiUrl(roomPath);
    const roomWebSocketUrl = realtimeWebSocketUrl(roomHttpUrl);

    const clearPollingTimer = () => {
      if (pollingTimerId !== null) {
        window.clearTimeout(pollingTimerId);
        pollingTimerId = null;
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const clearConnectTimeout = () => {
      if (connectTimeoutId !== null) {
        window.clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
    };

    const applyRealtimeEvents = (events: readonly unknown[]) => {
      setRealtimeEventsByPlaceId((current) => ({
        ...current,
        [realtimePlaceId]: mergeRealtimeEvents(
          current[realtimePlaceId] ?? [],
          events,
          realtimePlaceId,
        ),
      }));
    };

    const loadRealtimeRoom = async () => {
      if (!loadedOnce) {
        setLiveConnection("connecting");
      }

      try {
        const room = await fetchJson<CloudflareRealtimeRoom>(roomHttpUrl);
        if (!active) {
          return;
        }

        loadedOnce = true;
        applyRealtimeEvents(Array.isArray(room.events) ? room.events : []);
        if (socket?.readyState !== 1) {
          setLiveConnection("polling");
        }
      } catch {
        if (active) {
          loadedOnce = true;
          setLiveConnection("polling");
        }
      }
    };

    const schedulePolling = () => {
      if (!active || document.visibilityState === "hidden" || pollingTimerId !== null || socket?.readyState === 1) {
        return;
      }
      pollingTimerId = window.setTimeout(() => {
        pollingTimerId = null;
        void loadRealtimeRoom().finally(schedulePolling);
      }, REALTIME_POLL_INTERVAL_MS);
    };

    const connectWebSocket = () => {
      if (
        !active ||
        document.visibilityState === "hidden" ||
        socket ||
        !roomWebSocketUrl ||
        typeof window.WebSocket !== "function"
      ) {
        schedulePolling();
        return;
      }

      setLiveConnection(loadedOnce ? "polling" : "connecting");
      let candidate: WebSocket;
      try {
        candidate = new window.WebSocket(roomWebSocketUrl);
      } catch {
        schedulePolling();
        return;
      }
      socket = candidate;

      const handleDisconnect = () => {
        if (!active || socket !== candidate) {
          return;
        }
        clearConnectTimeout();
        socket = null;
        setLiveConnection("polling");
        schedulePolling();
        if (document.visibilityState !== "hidden" && reconnectTimerId === null) {
          const delay = realtimeReconnectDelayMs(reconnectAttempt);
          reconnectAttempt += 1;
          reconnectTimerId = window.setTimeout(() => {
            reconnectTimerId = null;
            connectWebSocket();
          }, delay);
        }
      };

      connectTimeoutId = window.setTimeout(() => {
        if (socket === candidate && candidate.readyState !== 1) {
          handleDisconnect();
          candidate.close();
        }
      }, REALTIME_CONNECT_TIMEOUT_MS);

      candidate.onopen = () => {
        if (!active || socket !== candidate) {
          candidate.close();
          return;
        }
        clearConnectTimeout();
        clearPollingTimer();
        clearReconnectTimer();
        reconnectAttempt = 0;
        loadedOnce = true;
        setLiveConnection("live");
      };
      candidate.onmessage = (event) => {
        if (!active || socket !== candidate) {
          return;
        }
        const realtimeEvent = parseRealtimeEventMessage(event.data, realtimePlaceId);
        if (realtimeEvent) {
          applyRealtimeEvents([realtimeEvent]);
        }
      };
      candidate.onerror = () => {
        handleDisconnect();
        candidate.close();
      };
      candidate.onclose = handleDisconnect;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearPollingTimer();
        clearReconnectTimer();
        clearConnectTimeout();
        const currentSocket = socket;
        socket = null;
        currentSocket?.close(1000, "page-hidden");
        return;
      }

      void loadRealtimeRoom();
      connectWebSocket();
      schedulePolling();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void loadRealtimeRoom().finally(() => {
      connectWebSocket();
      schedulePolling();
    });

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPollingTimer();
      clearReconnectTimer();
      clearConnectTimeout();
      const currentSocket = socket;
      socket = null;
      currentSocket?.close(1000, "scope-changed");
    };
  }, [cloudflareApiConfigured, dataMode, realtimePlaceId]);

  const openPlace = (place: Place) => {
    if (activeView !== "place" && activeView !== "ask") {
      placeReturnTargetRef.current = {
        view: activeView,
        scrollTop: phoneBodyRef.current?.scrollTop ?? 0,
      };
    }
    setLocationVerificationStatus("idle");
    setVerifiedLocation(null);
    setFocusedReportId(null);
    setToast(`${place.name} 현장 정보를 확인합니다. 현장 인증은 작성 화면에서 다시 선택해 주세요.`);
    setSelectedPlaceId(place.id);
    setActiveView("place");
    trackEvent("place_opened", { placeId: place.id });
    void recordPlaceClick(place, "detail");
  };

  const startReportForPlace = (place: Place) => {
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
    setLocationVerificationStatus("idle");
    setVerifiedLocation(null);
    if (place.id !== selectedPlaceId) {
      setPhotoAttached(false);
      setAttachedPhotoIds([]);
      reportRequestIdRef.current = null;
    }
    setSelectedPlaceId(place.id);
    setReportPlaceId(place.id);
    setActiveView("upload");
    reportStartedAtRef.current = Date.now();
    trackEvent("report_started", { placeId: place.id });
    setToast(`${place.name} 지금 상태를 올립니다. 위치 인증은 선택 사항입니다.`);
  };

  const openUploadPlacePicker = () => {
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
    setReportPlaceId(null);
    setActiveView("upload");
    reportStartedAtRef.current = null;
  };

  const changeBottomNavView = (view: View) => {
    if (view === "upload") {
      openUploadPlacePicker();
      return;
    }

    if (view === "my") {
      void loadMyPlaceAdditionRequests();
    }
    setActiveView(view);
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
    setSelectedHashtagName(null);
    setHashtagMediaReports([]);
    setHashtagMediaNextCursor(null);
    setActiveRegion(region);
    trackEvent("manual_location_selected", { region });
  };

  const updateMapBounds = (bounds: MapBounds) => {
    setMapBounds((current) => (areMapBoundsEquivalent(current, bounds) ? current : bounds));
  };

  const recordPlaceClick = async (place: Place, source: "detail" | "map_marker" | "ranking") => {
    trackEvent("click_place", { placeId: place.id, source });

    if (!cloudflareApiConfigured || dataMode !== "live") {
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
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
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
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
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

  const blockCommentCreator = async (place: Place, comment: PlaceComment) => {
    if (!comment.workerCommentId || comment.ownedByCurrentSession) {
      return;
    }
    if (!cloudflareApiConfigured) {
      setToast("샘플 미리보기에서는 사용자 차단이 저장되지 않습니다.");
      return;
    }

    try {
      const block = await fetchJson<UserBlock>(cloudflareApiUrl("/api/blocks"), {
        method: "POST",
        body: JSON.stringify({ targetType: "comment", targetId: comment.workerCommentId }),
      });
      setUserBlocks((current) => current.some((item) => item.id === block.id) ? current : [block, ...current]);
      setWorkerCommentsByPlaceId((current) => ({
        ...current,
        [place.id]: (current[place.id] ?? []).filter((item) => item.workerCommentId !== comment.workerCommentId),
      }));
      trackEvent("user_blocked", { targetType: "comment", targetId: comment.workerCommentId });
      setToast("작성자를 차단했습니다. 이 작성자의 댓글과 게시물이 내 화면에서 숨겨집니다.");
      await loadData({ silent: true });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "사용자 차단에 실패했습니다.");
    }
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
    trackEvent("content_reported", { targetType: target.targetType });

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
    trackEvent("request_location", { placeId: reportPlace?.id ?? null });
    trackEvent("location_permission_requested", { placeId: reportPlace?.id ?? null });
    if (!navigator.geolocation) {
      setVerifiedLocation(null);
      setLocationVerificationStatus("unsupported");
      trackEvent("report_location_failed", { reason: "unsupported" });
      setToast("이 브라우저에서는 위치 인증을 사용할 수 없어 상태 제보로 등록됩니다.");
      return;
    }

    setLocationVerificationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracyBucket = locationAccuracyBucketForMeters(position.coords.accuracy);
        if (accuracyBucket !== "high" && accuracyBucket !== "medium") {
          setVerifiedLocation(null);
          setLocationVerificationStatus("low_accuracy");
          trackEvent("location_permission_granted", { placeId: reportPlace?.id ?? null });
          trackEvent("report_location_failed", { reason: "low_accuracy" });
          setToast("GPS 정확도가 낮아 일반 제보로 등록됩니다. 다시 측정하면 현장 인증을 시도할 수 있습니다.");
          return;
        }

        setVerifiedLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
        setLocationVerificationStatus("verified");
        trackEvent("location_permission_granted", { placeId: reportPlace?.id ?? null });
        trackEvent("report_location_verified", { placeId: reportPlace?.id ?? null });
        setToast("실제 GPS 좌표를 확인했습니다. 등록 시 서버에서 장소 반경만 검증합니다.");
      },
      (error) => {
        setVerifiedLocation(null);
        setLocationVerificationStatus("denied");
        trackEvent("location_denied", { placeId: reportPlace?.id ?? null });
        trackEvent("location_permission_denied", { placeId: reportPlace?.id ?? null });
        trackEvent("report_location_failed", { reason: error.code === 1 ? "permission_denied" : "location_unavailable" });
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
    if (!reportPlace || isSubmitting) {
      return;
    }
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }

    const crowdLevel = crowdValueFromLabel(pickedCrowd);
    const queueStatus = queueValueFromLabel(pickedLine);
    const parkingObservation = parkingObservationFromLabel(pickedParking);
    const localConditions = [...pickedLocalConditions]
      .map(localConditionValueFromLabel)
      .filter((condition): condition is string => Boolean(condition));
    if (!crowdLevel && !queueStatus && !parkingObservation && localConditions.length === 0) {
      setToast("실제로 확인한 현장 상태를 하나 이상 선택해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const clientRequestId = reportRequestIdRef.current ?? `report-${crypto.randomUUID()}`;
      reportRequestIdRef.current = clientRequestId;
      const payload = {
        placeId: reportPlace.id,
        category: reportPlace.category,
        ...(crowdLevel ? { crowdLevel } : {}),
        ...(queueStatus ? { queueStatus } : {}),
        ...(parkingObservation ? { parkingObservation } : {}),
        ...(localConditions.length ? { localConditions } : {}),
        comment: reportText.trim() || undefined,
        photoIds: attachedPhotoIds,
        hashtagNames: recommendedTags,
        clientRequestId,
        ...(verifiedLocation ? { clientLocation: verifiedLocation } : {}),
      };

      const result = await fetchJson<FieldReportSubmitResult>(cloudflareApiConfigured ? cloudflareApiUrl("/api/reports") : "/api/reports", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const earned = result.credits.reduce((sum, event) => sum + Math.max(event.amount, 0), 0);
      const badge = result.report.verifiedRadiusM ? "현장 인증" : "상태 제보";
      const safetyNotice = result.safetyWarning ? ` · ${result.safetyWarning}` : "";
      const rewardNotice = featureFlags.REWARDS_ENABLED && result.report.moderationStatus === "approved" && earned > 0 ? ` · 질문권 +${earned}` : "";
      const reportCompletionMs = reportStartedAtRef.current === null
        ? null
        : Math.min(600_000, Math.max(0, Date.now() - reportStartedAtRef.current));
      trackEvent("submit_report", {
        placeId: reportPlace.id,
        locationVerified: Boolean(result.report.verifiedRadiusM),
        signalCount: result.report.observations.length,
      });
      trackEvent("report_submitted", {
        placeId: reportPlace.id,
        locationVerified: Boolean(result.report.verifiedRadiusM),
        ...(reportCompletionMs === null ? {} : { completionMs: reportCompletionMs }),
      });
      const moderationNotice = result.report.moderationStatus === "pending"
        ? "검수 후 현재 상태에 반영됩니다"
        : "현재 상태에 반영됐습니다";
      setToast(`${badge} 접수 완료. ${moderationNotice}${rewardNotice}${safetyNotice}`);
      setReportText("");
      setPhotoAttached(false);
      setAttachedPhotoIds([]);
      reportRequestIdRef.current = null;
      reportStartedAtRef.current = null;
      setPickedCrowd("");
      setPickedParking("");
      setPickedLine("");
      setPickedLocalConditions(new Set());
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
      if (!cloudflareApiConfigured || dataMode !== "live") {
        throw new Error("사진 서버 설정 후 사용할 수 있습니다.");
      }

      const turnstileToken = await acquirePhotoUploadTurnstileToken(photoUploadProtection);

      const ticket = await fetchJson<PhotoUploadTicket>(cloudflareApiUrl("/api/photos/upload-ticket"), {
        method: "POST",
        body: JSON.stringify({
          placeId: place.id,
          mimeType: photo.mimeType,
          byteSize: photo.byteSize,
          width: photo.width,
          height: photo.height,
          rightsAttested: photo.rightsAttested,
          rightsPolicyVersion: photo.rightsPolicyVersion,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      });

      if (ticket.rightsPolicyVersion !== photo.rightsPolicyVersion) {
        throw new Error("사진 게시 권한 확인 버전을 검증하지 못했습니다.");
      }

      const formData = new FormData();
      formData.set("uploadId", ticket.uploadId);
      formData.set("placeId", place.id);
      formData.set("byteSize", String(photo.byteSize));
      formData.set("mimeType", photo.mimeType);
      formData.set("width", String(photo.width));
      formData.set("height", String(photo.height));
      formData.set("clientReencoded", "true");
      formData.set("file", photo.blob, `upload.${photo.mimeType === "image/jpeg" ? "jpg" : "webp"}`);

      const result = await fetchJson<PhotoCompleteResult>(cloudflareApiUrl("/api/photos/upload"), {
        method: "POST",
        body: formData,
      });

      setWorkerPhotos((current) => mergeWorkerPhotos([{ ...result.photo, ownedByCurrentSession: true }], current).slice(0, 80));
      setPhotoAttached(true);
      setAttachedPhotoIds((current) => [...new Set([...current, result.photo.id])].slice(0, 4));
      reportRequestIdRef.current = null;
      trackEvent("upload_photo", { placeId: place.id, mimeType: photo.mimeType, byteSize: photo.byteSize });
      if (result.photo.status === "ready") {
        appendRealtimeEvent(place.id, "photo.ready", result.photo.createdAt, { id: result.photo.id, placeId: place.id });
        setToast(`${place.name} 지금 사진이 등록됐습니다.`);
      } else {
        setToast("사진이 안전 검수 대기 중입니다. 승인된 파생 이미지만 공개됩니다.");
      }
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
        const remainingPhotoIds = attachedPhotoIds.filter((photoId) => photoId !== workerPhotoId);
        setAttachedPhotoIds(remainingPhotoIds);
        setPhotoAttached(remainingPhotoIds.length > 0);
        reportRequestIdRef.current = null;
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
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
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
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
      return;
    }
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
    if (dataMode !== "live") {
      setToast(liveWriteUnavailableMessage);
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

  const blockPostCreator = async (post: PublicPost) => {
    if (!cloudflareApiConfigured) {
      hidePostCreatorLocally(post);
      setToast("샘플 미리보기에서는 화면에서만 숨기며 차단은 저장되지 않습니다.");
      return;
    }

    try {
      const block = await fetchJson<UserBlock>(cloudflareApiUrl("/api/blocks"), {
        method: "POST",
        body: JSON.stringify({ targetType: "post", targetId: post.id }),
      });
      setUserBlocks((current) => current.some((item) => item.id === block.id) ? current : [block, ...current]);
      hidePostCreatorLocally(post);
      trackEvent("user_blocked", { targetType: "post", targetId: post.id });
      setToast("작성자를 차단했습니다. 이 작성자의 게시물과 댓글이 내 화면에서 숨겨집니다.");
      await loadData({ silent: true });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "사용자 차단에 실패했습니다.");
    }
  };

  const unblockUser = async (blockId: string) => {
    if (!cloudflareApiConfigured) {
      setToast("실시간 API 연결 후 차단을 해제할 수 있습니다.");
      return;
    }

    try {
      await fetchJson<{ blockId: string; blocked: boolean }>(cloudflareApiUrl(`/api/blocks/${encodeURIComponent(blockId)}`), {
        method: "DELETE",
      });
      setUserBlocks((current) => current.filter((block) => block.id !== blockId));
      setToast("사용자 차단을 해제했습니다.");
      await loadData({ silent: true });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "차단 해제에 실패했습니다.");
    }
  };

  const voteOnReport = async (report: Report, voteType: "agree" | "changed") => {
    if (!cloudflareApiConfigured) {
      setToast("샘플 미리보기에서는 상태 확인 투표가 저장되지 않습니다.");
      return;
    }

    try {
      const result = await fetchJson<{
        agreeCount: number;
        changedCount: number;
        invalidated: boolean;
      }>(cloudflareApiUrl(`/api/reports/${encodeURIComponent(report.id)}/votes`), {
        method: "POST",
        body: JSON.stringify({ voteType }),
      });
      trackEvent(voteType === "agree" ? "report_vote_agree" : "report_vote_changed", { reportId: report.id });
      if (result.invalidated) {
        setReports((current) => current.filter((item) => item.id !== report.id));
        setHashtagMediaReports((current) => current.filter((item) => item.id !== report.id));
        setToast("여러 사용자가 현재 상태가 달라졌다고 확인해 기존 제보를 현재 판단에서 제외했습니다.");
        return;
      }
      setToast(voteType === "agree"
        ? `현재도 맞다는 확인이 반영됐습니다. 맞아요 ${result.agreeCount}건`
        : `지금은 다르다는 확인이 반영됐습니다. 변경 ${result.changedCount}건`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "상태 확인 투표에 실패했습니다.");
    }
  };

  const deleteCurrentAccount = async () => {
    if (!cloudflareApiConfigured) {
      throw new Error("실시간 API 연결 후 계정을 삭제할 수 있습니다.");
    }

    try {
      await fetchJson<{ deleted: boolean }>(cloudflareApiUrl("/api/account/deletion"), {
        method: "POST",
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
      });
      for (const key of Object.values(persistedSetKeys)) {
        window.localStorage.removeItem(key);
      }
      window.localStorage.removeItem(notificationEnabledKey);
      setHelpfulPostIds(new Set());
      setSavedPostIds(new Set());
      setFollowedPlaceIds(new Set());
      setFollowedHashtagNames(new Set());
      notificationEnabledRef.current = false;
      setNotificationEnabled(false);
      preferencesSyncLoadedRef.current = false;
      setHiddenCreatorNames(new Set());
      setUserBlocks([]);
      setWorkerCommentsByPlaceId({});
      setWorkerPhotos([]);
      setSelectedHashtagName(null);
      setHashtagMediaReports([]);
      setHashtagMediaNextCursor(null);
      setPlaceAdditionRequests([]);
      placeAdditionRequestIdsRef.current.clear();
      trackEvent("account_deletion_requested", {});
      setToast("이 기기의 익명 활동과 사진 삭제를 완료했습니다.");
      setActiveView("home");
      await loadData({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "계정 삭제에 실패했습니다.";
      setToast(message);
      throw new Error(message);
    }
  };

  const submitPlaceAdditionRequest = async (draft: PlaceAdditionRequestDraft) => {
    if (!cloudflareApiConfigured || dataMode !== "live") {
      setToast("실시간 API가 연결된 운영 환경에서 장소 추가를 요청할 수 있습니다.");
      return false;
    }

    const normalizedDraft = {
      name: draft.name.normalize("NFKC").trim(),
      address: draft.address.normalize("NFKC").trim(),
      category: draft.category.normalize("NFKC").trim() || "기타",
    };
    const candidateKey = [normalizedDraft.name, normalizedDraft.address, normalizedDraft.category]
      .join("\u0000")
      .toLocaleLowerCase("ko-KR");
    const clientRequestId = placeAdditionRequestIdsRef.current.get(candidateKey) ?? `place-request-${crypto.randomUUID()}`;
    placeAdditionRequestIdsRef.current.set(candidateKey, clientRequestId);
    setPlaceAdditionRequestSubmitting(true);

    try {
      const result = await fetchJson<PlaceAdditionRequest>(cloudflareApiUrl("/api/place-requests"), {
        method: "POST",
        body: JSON.stringify({
          clientRequestId,
          name: normalizedDraft.name,
          address: normalizedDraft.address,
          category: normalizedDraft.category,
        }),
      });
      setPlaceAdditionRequests((current) => [result, ...current.filter((request) => request.id !== result.id)]);
      setToast("장소 추가 요청을 접수했습니다. 검토 전에는 지도나 사진 등록에 나타나지 않습니다.");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "장소 추가 요청을 접수하지 못했습니다.");
      throw error;
    } finally {
      setPlaceAdditionRequestSubmitting(false);
    }
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
    if (preset.patch.pickedLocalConditions) setPickedLocalConditions(new Set(preset.patch.pickedLocalConditions));
    if (typeof preset.patch.photoAttached === "boolean") setPhotoAttached(preset.patch.photoAttached);
    if (preset.patch.reportText) setReportText(preset.patch.reportText);
    trackEvent("submit_quick_report", { presetId: preset.id, placeId: selectedPlace?.id ?? null });
    setToast(`${preset.label} 빠른 제보가 작성 폼에 반영됐습니다.`);
  };

  const answerFieldQuest = (quest: FieldQuest) => {
    if (quest.questionType === "parking") {
      setPickedParking("거의 만차");
    }
    if (quest.questionType === "line") {
      setPickedLine("10~30분");
    }
    if (quest.questionType === "crowd") {
      setPickedCrowd("혼잡");
    }
    setPhotoAttached(false);
    setReportText(quest.prompt);
    setSelectedPlaceId(quest.placeId);
    setReportPlaceId(quest.placeId);
    setActiveView("upload");
    trackEvent("answer_field_quest", { questId: quest.id, placeId: quest.placeId });
    setToast("현장 질문을 올리기 화면으로 연결했습니다. 위치 인증은 선택 사항입니다.");
  };

  const selectHashtag = async (hashtagName: string) => {
    trackEvent("click_hashtag", { hashtagName });

    try {
      const hashtagResults = await fetchJson<PublicHashtag[]>(
        cloudflareApiConfigured
          ? cloudflareApiUrl(buildHashtagApiPath({
              name: hashtagName,
              regionId: activeDataRegionId,
              hasPhoto: true,
              activeOnly: true,
              sort: "recent",
              limit: 100,
            }))
          : buildHashtagApiPath({
              name: hashtagName,
              regionId: activeDataRegionId,
              hasPhoto: true,
              activeOnly: true,
              sort: "recent",
              limit: 100,
            }),
      );
      const selectedHashtag = hashtagResults.find((tag) => tag.name === hashtagName);
      const nextHashtagReports = hashtagMediaToReports(selectedHashtag?.recentMedia ?? [], hashtagName, places);
      setSelectedHashtagName(hashtagName);
      setHashtagMediaReports(nextHashtagReports);
      setHashtagMediaNextCursor(selectedHashtag?.nextCursor ?? null);
      setMapSearchQuery(`#${hashtagName}`);
      setActiveView("search");
      setToast(`#${hashtagName} 최신 사진 ${selectedHashtag?.recentPhotoCount ?? 0}건을 불러왔습니다.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "해시태그 사진을 불러오지 못했습니다.");
    }
  };

  const loadMoreHashtagMedia = async () => {
    if (!selectedHashtagName || !hashtagMediaNextCursor || hashtagMediaLoadingMore) return;

    setHashtagMediaLoadingMore(true);
    try {
      const path = buildHashtagApiPath({
        name: selectedHashtagName,
        regionId: activeDataRegionId,
        hasPhoto: true,
        activeOnly: true,
        sort: "recent",
        cursor: hashtagMediaNextCursor,
        limit: 100,
      });
      const hashtagResults = await fetchJson<PublicHashtag[]>(cloudflareApiConfigured ? cloudflareApiUrl(path) : path);
      const selectedHashtag = hashtagResults.find((tag) => tag.name === selectedHashtagName);
      const nextReports = hashtagMediaToReports(selectedHashtag?.recentMedia ?? [], selectedHashtagName, places);
      setHashtagMediaReports((current) => mergeReportCollections(current, nextReports));
      setHashtagMediaNextCursor(selectedHashtag?.nextCursor ?? null);
      setToast(nextReports.length > 0 ? `#${selectedHashtagName} 사진 ${nextReports.length}건을 더 불러왔습니다.` : "더 불러올 최신 사진이 없습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "해시태그 사진을 더 불러오지 못했습니다.");
    } finally {
      setHashtagMediaLoadingMore(false);
    }
  };

  const clearHashtagFilter = () => {
    setSelectedHashtagName(null);
    setHashtagMediaReports([]);
    setHashtagMediaNextCursor(null);
    setMapSearchQuery((current) => current.trim().startsWith("#") ? "" : current);
  };

  const updateSearchQuery = (query: string) => {
    setMapSearchQuery(query);
    if (selectedHashtagName && query.trim() !== `#${selectedHashtagName}`) {
      setSelectedHashtagName(null);
      setHashtagMediaReports([]);
      setHashtagMediaNextCursor(null);
    }
  };

  const selectChallenge = async (challenge: Challenge) => {
    trackEvent("view_challenge", { challengeId: challenge.id, hashtagName: challenge.hashtagName });
    await selectHashtag(challenge.hashtagName);
  };

  const toggleHashtagFollow = (hashtagName: string) => {
    const isFollowing = followedHashtagNames.has(hashtagName);
    setFollowedHashtagNames((current) => toggleSetValue(current, hashtagName));
    void syncPreference({ kind: "followed_topic", key: hashtagName, enabled: !isFollowing });
    trackEvent("follow_hashtag", { hashtagName, following: !isFollowing });
    setToast(isFollowing ? `#${hashtagName} 팔로우를 해제했습니다.` : `#${hashtagName} 관심 피드를 팔로우합니다.`);
  };

  const toggleFollowPlace = (place: Place) => {
    const isFollowing = followedPlaceIds.has(place.id);
    setFollowedPlaceIds((current) => toggleSetValue(current, place.id));
    void syncPreference({ kind: "saved_place", key: place.id, enabled: !isFollowing });
    trackEvent("follow_place", { placeId: place.id, following: !isFollowing });
    setToast(isFollowing ? `${place.name} 팔로우를 해제했습니다.` : `${place.name}을(를) 팔로우합니다.`);
  };

  const toggleNotifications = () => {
    const nextEnabled = !notificationEnabled;
    const followCount = followedPlaceIds.size + followedHashtagNames.size;
    const nativeBridge = window.SilsiganNativeBridge;

    if (nextEnabled && nativeBridge) {
      notificationEnabledRef.current = true;
      setNotificationEnabled(true);
      trackEvent("toggle_notifications", { enabled: true, followCount });
      void nativeBridge.requestPushRegistration()
        .then(() => {
          void syncPreference({
            kind: "notifications",
            enabled: true,
            platform: nativeBridge.platform ?? "webview",
          });
          setToast("새 현장 알림 권한을 켰습니다. 알림 설정은 마이에서 관리할 수 있습니다.");
        })
        .catch(() => {
          notificationEnabledRef.current = false;
          setNotificationEnabled(false);
          void syncPreference({
            kind: "notifications",
            enabled: false,
            platform: nativeBridge.platform ?? "webview",
            pushTokenHash: null,
          });
          setToast("알림 권한을 켜지 못했습니다. 기기 설정에서 다시 시도해 주세요.");
        });
      return;
    }

    notificationEnabledRef.current = nextEnabled;
    setNotificationEnabled(nextEnabled);
    void syncPreference({
      kind: "notifications",
      enabled: nextEnabled,
      platform: nativeBridge?.platform ?? "webview",
      ...(nextEnabled ? {} : { pushTokenHash: null }),
    });
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
    if (post.isSample) {
      setToast("체험용 샘플에서는 도움돼요가 저장되거나 랭킹에 반영되지 않습니다.");
      return;
    }

    if (helpfulPostIds.has(post.id)) {
      setToast("이미 도움돼요를 누른 제보입니다.");
      return;
    }

    setHelpfulPostIds((current) => toggleSetValue(current, post.id));
    trackEvent("helpful_post", { postId: post.id });
    setToast("도움돼요가 반영됐습니다. 피드 랭킹에 즉시 반영됩니다.");
  };

  const toggleSavePost = (post: PublicPost) => {
    const isSaved = savedPostIds.has(post.id);
    setSavedPostIds((current) => toggleSetValue(current, post.id));
    void syncPreference({ kind: "saved_post", key: post.id, enabled: !isSaved });
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

  const shareReport = async (report: Report, place: Place) => {
    if (report.moderationStatus !== "approved" || report.hiddenAt || report.isSample) {
      setToast("검수가 끝난 실제 현장 제보만 공유할 수 있습니다.");
      return;
    }

    const shareUrl = `${getSiteUrl()}/?place=${encodeURIComponent(place.id)}&report=${encodeURIComponent(report.id)}`;
    const hashtagsText = report.hashtagNames.slice(0, 3).map((tag) => `#${tag}`).join(" ");
    const shareText = `${place.name} 지금 상황\n${report.body}${hashtagsText ? `\n${hashtagsText}` : ""}\n${shareUrl}`;
    const browserNavigator = navigator as Navigator & {
      clipboard?: Clipboard;
      share?: (data: ShareData) => Promise<void>;
    };

    try {
      if (browserNavigator.share) {
        await browserNavigator.share({ title: `${place.name} 지금 상황`, text: report.body, url: shareUrl });
        trackEvent("share_report", { reportId: report.id, placeId: place.id, method: "native" });
        setToast("현장 제보 공유 시트를 열었습니다.");
        return;
      }
      if (!browserNavigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }
      await browserNavigator.clipboard.writeText(shareText);
      trackEvent("share_report", { reportId: report.id, placeId: place.id, method: "clipboard" });
      setToast("장소로 바로 열리는 현장 제보 링크를 복사했습니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setToast("공유를 취소했습니다.");
        return;
      }
      setToast("공유 기능을 사용할 수 없습니다. 운영 URL 연결 후 다시 확인해 주세요.");
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
            selectedPlace={activeView === "upload" ? reportPlace : selectedPlace}
            toast={toast}
            onBack={returnFromDetail}
            notificationEnabled={notificationEnabled}
            onNotify={toggleNotifications}
            onSafety={() => setToast("정확한 좌표, 원본 파일명, 민감정보는 공개하지 않는 정책입니다.")}
          />

          <div className={styles.phoneBody} ref={phoneBodyRef}>
            {loading && <SharedEmptyState title="실시간 데이터를 불러오는 중입니다" body="최근 제보와 질문을 확인하고 있어요." />}
            {!loading && activeView !== "map" && activeView !== "upload" && places.length === 0 && (
              <SharedEmptyState
                title={activeRegion === "nationwide" ? "아직 전국에서 확인된 최근 제보가 없습니다" : "아직 이 지역 제보가 없습니다"}
                body={activeRegion === "nationwide"
                  ? "전국 기능은 열려 있습니다. 데이터가 없는 장소는 임의 상태를 만들지 않고 ‘최근 확인 정보 없음’으로 안내합니다."
                  : "다른 지역 탭을 선택하거나 첫 제보가 올라오면 최근 3시간 기준으로 랭킹과 지도에 반영됩니다."}
                action={(
                  <div className={styles.emptyActionRow}>
                    <button type="button" onClick={() => setActiveView("search")}>{activeRegion === "nationwide" ? "전국 장소 검색" : "검색으로 넓히기"}</button>
                    <button type="button" onClick={() => setActiveView("map")}>{activeRegion === "nationwide" ? "전국 지도에서 찾기" : "지도에서 다른 지역 보기"}</button>
                  </div>
                )}
              />
            )}
            {!loading && (
              <>
                {activeView === "home" && selectedPlace && (
                  <HomeScreen
                    dataMode={dataMode}
                    qnaEnabled={featureFlags.QNA_ENABLED}
                    rewardsEnabled={featureFlags.REWARDS_ENABLED}
                    socialFeedEnabled={featureFlags.SOCIAL_FEED_ENABLED}
                    placeStatuses={placeStatuses}
                    publicDataSources={publicDataSources}
                    places={displayPlaces}
                    questions={questions}
                    posts={rankedPosts}
                    hashtags={hashtags}
                    challenges={activeChallenges}
                    selectedHashtagName={selectedHashtagName}
                    followedHashtagNames={followedHashtagNames}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    reports={visibleReports}
                    onBlockPost={blockPostCreator}
                    onFlagPost={setPendingFlagPost}
                    onClearHashtagFilter={clearHashtagFilter}
                    onFollowHashtag={toggleHashtagFollow}
                    onHelpfulPost={markHelpful}
                    onOpenPlace={openPlace}
                    onSavePost={toggleSavePost}
                    onSelectChallenge={selectChallenge}
                    onShareReport={shareReport}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    onGoMap={() => setActiveView("map")}
                    onGoSearch={(query?: string) => {
                      if (query) updateSearchQuery(query);
                      setActiveView("search");
                    }}
                    onGoReport={(place?: Place) => {
                      if (place) {
                        startReportForPlace(place);
                        return;
                      }

                      openUploadPlacePicker();
                    }}
                    onVoteReport={voteOnReport}
                  />
                )}
                {activeView === "search" && (
                  <SearchScreen
                    dataMode={dataMode}
                    hashtags={hashtags}
                    selectedHashtagName={selectedHashtagName}
                    followedHashtagNames={followedHashtagNames}
                    places={displayPlaces}
                    posts={rankedPosts}
                    query={mapSearchQuery}
                    reports={visibleReports}
                    hashtagMediaHasMore={Boolean(selectedHashtagName && hashtagMediaNextCursor)}
                    hashtagMediaLoadingMore={hashtagMediaLoadingMore}
                    placeAdditionRequestSubmitting={placeAdditionRequestSubmitting}
                    workerPhotos={workerPhotos}
                    onGoMap={(query) => {
                      updateSearchQuery(query);
                      setActiveView("map");
                      setToast(query ? `${query} 기준으로 지도에서 볼게요.` : "지도에서 주변 장소를 볼게요.");
                    }}
                    onGoUpload={(place) => {
                      startReportForPlace(place);
                    }}
                    onOpenPlace={openPlace}
                    onFollowHashtag={toggleHashtagFollow}
                    onLoadMoreHashtagMedia={loadMoreHashtagMedia}
                    onQueryChange={updateSearchQuery}
                    onRequestPlaceAddition={submitPlaceAdditionRequest}
                    onSelectHashtag={selectHashtag}
                  />
                )}
                {activeView === "map" && (
                  <MapScreen
                    activeFilter={activeFilter}
                    dataMode={dataMode}
                    photoUploadReady={photoUploadReady}
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
                    onBlockComment={blockCommentCreator}
                    onLikeComment={likePlaceComment}
                    onLikePlace={togglePlaceLike}
                    onLocation={setMapCurrentLocation}
                    onLocationPermissionChange={setMapLocationPermission}
                    onMapBoundsChange={updateMapBounds}
                    onRequery={requeryCurrentMap}
                    onRegionChange={changeActiveRegion}
                    onReport={startReportForPlace}
                    onReportPlace={reportMapPlace}
                    onSearchQueryChange={updateSearchQuery}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportComment={openCommentReport}
                    onReportPhoto={openPhotoReport}
                    places={displayPlaces}
                    posts={rankedPosts}
                    reports={visibleReports}
                    workerCommentsByPlaceId={workerCommentsByPlaceId}
                    workerPhotos={workerPhotos}
                    locationPermission={mapLocationPermission}
                    onToast={setToast}
                  />
                )}
                {activeView === "place" && selectedPlace && (
                  <PlaceScreen
                    key={selectedPlace.id}
                    dataMode={dataMode}
                    photoUploadReady={photoUploadReady}
                    qnaEnabled={featureFlags.QNA_ENABLED}
                    rewardsEnabled={featureFlags.REWARDS_ENABLED}
                    place={selectedPlace}
                    followed={followedPlaceIds.has(selectedPlace.id)}
                    placeStatus={selectedPlaceStatus}
                    placeStatusLoading={placeStatusLoading}
                    posts={selectedPosts}
                    questions={questions}
                    reports={selectedReports}
                    focusedReportId={focusedReportId}
                    nearbyPlaces={displayPlaces
                      .filter((place) => place.region === selectedPlace.region && place.id !== selectedPlace.id)
                      .slice(0, 5)}
                    fieldQuests={activeFieldQuests.filter((quest) => quest.placeId === selectedPlace.id)}
                    onFollow={toggleFollowPlace}
                    onAsk={() => {
                      askReturnScrollRef.current = phoneBodyRef.current?.scrollTop ?? 0;
                      setActiveView("ask");
                    }}
                    onAnswerQuest={answerFieldQuest}
                    onBlockPost={blockPostCreator}
                    onFlagPost={setPendingFlagPost}
                    helpfulPostIds={helpfulPostIds}
                    savedPostIds={savedPostIds}
                    onHelpfulPost={markHelpful}
                    onReport={() => startReportForPlace(selectedPlace)}
                    onPhotoDelete={deletePlacePhoto}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={uploadPlacePhoto}
                    onReportPhoto={openPhotoReport}
                    onSavePost={toggleSavePost}
                    onShareReport={shareReport}
                    onSharePost={sharePost}
                    onSelectHashtag={selectHashtag}
                    onVoteReport={voteOnReport}
                    workerPhotos={workerPhotos}
                  />
                )}
                {activeView === "upload" && !reportPlace && (
                  <ReportPlaceGate
                    places={displayPlaces}
                    onMap={() => setActiveView("map")}
                    onSearch={() => setActiveView("search")}
                    onSelectPlace={startReportForPlace}
                  />
                )}
                {activeView === "upload" && reportPlace && (
                  <ReportScreen
                    isSubmitting={isSubmitting}
                    photoUploadReady={photoUploadReady}
                    place={reportPlace}
                    places={displayPlaces}
                    sensitiveWarning={sensitivePhotoWarningFor(reportPlace)}
                    pickedCrowd={pickedCrowd}
                    pickedParking={pickedParking}
                    pickedLine={pickedLine}
                    pickedLocalConditions={pickedLocalConditions}
                    photoAttached={photoAttached}
                    locationVerificationStatus={locationVerificationStatus}
                    reportText={reportText}
                    recommendedTags={recommendedTags}
                    quickReportPresets={quickReportPresets}
                    photos={photosForPlace(
                      rankedPosts.filter((post) => post.placeId === reportPlace.id),
                      visibleReports.filter((report) => report.placeId === reportPlace.id),
                      workerPhotos.filter((photo) => photo.placeId === reportPlace.id && photo.status === "ready"),
                    )}
                    setPickedCrowd={setPickedCrowd}
                    setPickedParking={setPickedParking}
                    setPickedLine={setPickedLine}
                    onToggleLocalCondition={(condition) => {
                      setPickedLocalConditions((current) => toggleLocalCondition(current, condition));
                    }}
                    setReportText={setReportText}
                    onSelectPlace={(place) => {
                      if (photoAttached && place.id !== reportPlace.id) {
                        setToast("사진을 삭제한 뒤 장소를 바꿀 수 있습니다.");
                        return;
                      }

                      if (place.id !== reportPlace.id) {
                        setPhotoAttached(false);
                        setAttachedPhotoIds([]);
                        reportRequestIdRef.current = null;
                      }
                      setSelectedPlaceId(place.id);
                      setReportPlaceId(place.id);
                    }}
                    onApplyPreset={applyQuickReportPreset}
                    onOpenPlace={() => setActiveView("place")}
                    onPhotoDelete={(photo) => deletePlacePhoto(reportPlace, photo)}
                    onPhotoClick={clickPlacePhoto}
                    onPhotoUpload={(photo) => uploadPlacePhoto(reportPlace, photo)}
                    onReportPhoto={(photo) => openPhotoReport(reportPlace, photo)}
                    onRequestLocation={requestFieldVerification}
                    onSubmit={submitReport}
                  />
                )}
                {activeView === "ask" && selectedPlace && featureFlags.QNA_ENABLED && (
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
                    qnaEnabled={featureFlags.QNA_ENABLED}
                    rewardsEnabled={featureFlags.REWARDS_ENABLED}
                    followedHashtagNames={followedHashtagNames}
                    followedPlaces={places.filter((place) => followedPlaceIds.has(place.id))}
                    hiddenCreatorNames={hiddenCreatorNames}
                    myQuestions={myQuestions}
                    placeAdditionRequests={placeAdditionRequests}
                    reports={myReports}
                    savedPosts={allRankedPosts.filter((post) => savedPostIds.has(post.id))}
                    userBlocks={userBlocks}
                    accountDeleteAvailable={cloudflareApiConfigured && dataMode === "live"}
                    onDeleteAccount={deleteCurrentAccount}
                    onSelectHashtag={selectHashtag}
                    onUnblockUser={unblockUser}
                    onToast={setToast}
                  />
                )}
              </>
            )}
          </div>

          <BottomNav activeView={activeView} onChange={changeBottomNavView} />
          {showOnboarding && activeView === "home" && (
            <OnboardingSheet
              onClose={closeOnboarding}
              onGoMap={() => {
                closeOnboarding();
                setActiveView("map");
              }}
              onGoReport={() => {
                closeOnboarding();
                openUploadPlacePicker();
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
  const modeLabel = dataMode === "live"
    ? "실시간 데이터"
    : dataMode === "sample"
      ? "샘플 미리보기"
      : dataMode === "directory"
        ? "기본 장소 목록"
        : "실시간 연결 안 됨";
  const modeDescription =
    dataMode === "live"
      ? "출처와 관측시각이 확인된 최신 상태를 불러옵니다."
      : dataMode === "sample"
        ? "현재 화면은 예시 데이터입니다. 실제 현재 상태로 사용하지 않습니다."
        : dataMode === "directory"
          ? "실시간 API 보호 중입니다. 검증된 장소 위치만 표시하며 현재 상태·사진·제보는 숨깁니다."
          : "샘플로 대체하지 않았습니다. 잠시 후 다시 시도하거나 지역을 직접 선택해 주세요.";

  return (
    <header className={styles.topHeader}>
      <div className={styles.headerRow}>
        <button className={styles.iconButton} type="button" onClick={isDetail ? onBack : onSafety} aria-label={isDetail ? "뒤로" : "안전 정책"}>
          {isDetail ? <ChevronLeft size={18} /> : <ShieldCheck size={18} />}
        </button>
        <div>
          <p className={styles.eyebrow}>{activeView === "home" ? "지금 가도 될지, 10초 안에" : "지금 장소 사진"}</p>
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
      <div className={`${styles.dataModeBanner} ${dataMode !== "live" ? styles.dataModeBannerSample : ""}`}>
        <strong>{modeLabel}</strong>
        <span>{modeDescription}</span>
      </div>
      {toast && <div className={styles.toast} role="status" aria-live="polite">{toast}</div>}
    </header>
  );
}

function HomeScreen({
  dataMode,
  qnaEnabled,
  rewardsEnabled,
  socialFeedEnabled,
  placeStatuses,
  publicDataSources,
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
  onBlockPost,
  onFlagPost,
  onClearHashtagFilter,
  onFollowHashtag,
  onHelpfulPost,
  onOpenPlace,
  onSavePost,
  onSelectChallenge,
  onShareReport,
  onSharePost,
  onSelectHashtag,
  onGoSearch,
  onGoMap,
  onGoReport,
  onVoteReport,
}: {
  dataMode: DataMode;
  qnaEnabled: boolean;
  rewardsEnabled: boolean;
  socialFeedEnabled: boolean;
  placeStatuses: Record<string, CloudflarePlaceStatus>;
  publicDataSources: PublicDataSource[];
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
  onBlockPost: (post: PublicPost) => void;
  onFlagPost: (post: PublicPost) => void;
  onClearHashtagFilter: () => void;
  onFollowHashtag: (hashtagName: string) => void;
  onHelpfulPost: (post: PublicPost) => void;
  onOpenPlace: (place: Place) => void;
  onSavePost: (post: PublicPost) => void;
  onSelectChallenge: (challenge: Challenge) => void;
  onShareReport: (report: Report, place: Place) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  onGoSearch: (query?: string) => void;
  onGoMap: () => void;
  onGoReport: (place?: Place) => void;
  onVoteReport: (report: Report, voteType: "agree" | "changed") => void;
}) {
  const [activeFeedTab, setActiveFeedTab] = useState<FeedTab>("전체");
  const [activeHomeCategory, setActiveHomeCategory] = useState("all");
  const featured = places[0];
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const officialWeather = useMemo(() => {
    for (const place of places) {
      const status = currentLivePlaceStatus(placeStatuses[place.id]);
      const signal = status?.currentSignals
        .filter((candidate) => candidate.dimension === "weather" && candidate.sourceType.startsWith("official_"))
        .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];

      if (signal) {
        return signal;
      }
    }

    return null;
  }, [placeStatuses, places]);
  const homeCategoryOptions = [
    { id: "all", label: "전체" },
    { id: "tourism", label: "관광지" },
    { id: "festival", label: "축제" },
    { id: "restaurant_cafe", label: "맛집" },
    { id: "parking", label: "주차" },
  ] as const;
  const homePlaces = places
    .filter((place) => activeHomeCategory === "all" || place.category === activeHomeCategory)
    .slice(0, 5);
  const filteredPosts = useMemo(
    () =>
      posts
        .filter((post) => !post.hiddenAt)
        .filter((post) => postMatchesFeedTab(post, placeById.get(post.placeId), activeFeedTab))
        .slice(0, 3),
    [activeFeedTab, placeById, posts],
  );
  const currentHomeStatuses = homePlaces
    .map((place) => currentLivePlaceStatus(placeStatuses[place.id]))
    .filter((status): status is CloudflarePlaceStatus => Boolean(status));
  const goodCount = currentHomeStatuses.filter((status) => status.status === "likely_good").length;
  const cautionCount = currentHomeStatuses.filter((status) => status.status === "check_before_visit").length;
  const avoidCount = currentHomeStatuses.filter((status) => status.status === "likely_crowded").length;
  const leadPost = filteredPosts.find((post) => post.photoCount > 0) ?? filteredPosts[0] ?? posts.find((post) => !post.hiddenAt) ?? null;
  const leadPlace = leadPost ? placeById.get(leadPost.placeId) ?? featured : featured;
  const leadPhotoReport = leadPost ? reports.find((report) => report.placeId === leadPost.placeId && report.hasPhoto) ?? null : null;
  const leadPhotoUrl = leadPost ? photoUrlForPost(leadPost, reports) : null;
  const leadIsSample = dataMode === "sample" || Boolean(leadPost?.isSample) || Boolean(leadPost?.id.startsWith("fallback_"));
  const leadDecision = leadPlace
    ? dataMode === "live"
      ? visitDecisionShortLabel(currentLivePlaceStatus(placeStatuses[leadPlace.id])?.status ?? "insufficient")
      : leadPlace.signal
    : "판단 근거 확인 중";
  const safeLeadPhotoSourceUrl = safeHttpUrl(leadPhotoReport?.photoSourceUrl);
  const leadTags = (leadPost?.hashtagNames.length ? leadPost.hashtagNames : hashtags.map((tag) => tag.name)).slice(0, 3);
  const keywordQueries = ["광안리 주차", "황리단길 웨이팅", "태화강 산책"];
  const currentSignalCount = currentHomeStatuses.reduce((total, status) => total + status.currentSignals.length, 0);
  const activeSourceNames = [...new Set(
    publicDataSources
      .filter((source) => source.activationStatus === "active")
      .map((source) => source.sourceName),
  )].slice(0, 2);

  return (
    <div className={styles.screenStack}>
      <section className={styles.photoLeadCard} aria-label={dataMode === "directory" ? "기본 장소 위치 안내" : "가장 최근 장소 사진과 방문 판단"}>
        <button
          className={styles.photoLeadPreview}
          style={photoBackgroundStyle(leadPhotoUrl)}
          type="button"
          onClick={() => leadPlace && onOpenPlace(leadPlace)}
          disabled={!leadPlace}
        >
          <span className={styles.photoLeadDecision}>{leadDecision}</span>
          <span className={styles.photoLeadMeta}>
            {dataMode === "directory"
              ? "기본 장소 · 실시간 근거 없음"
              : leadIsSample
                ? "체험용 사진 · 예시 데이터"
                : `최근 ${leadPost ? minutesAgo(leadPost.createdAt) : "방금 전"}`}
          </span>
          <span className={styles.photoLeadKicker}>{dataMode === "directory" ? "장소 탐색 유지 중" : "출발 전 10초 확인"}</span>
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
            {dataMode === "directory" ? "장소 정보 보기" : "실시간 사진 보기"}
          </button>
          <button type="button" onClick={() => onGoReport(leadPlace ?? undefined)} disabled={dataMode !== "live"}>
            {dataMode === "directory" ? "연결 후 업로드" : "지금컷 올리기"}
          </button>
        </div>
        {leadPhotoReport?.photoAttribution && (
          safeLeadPhotoSourceUrl ? (
            <a className={styles.photoLeadCredit} href={safeLeadPhotoSourceUrl} target="_blank" rel="noreferrer">
              사진 출처 · {leadPhotoReport.photoAttribution}
            </a>
          ) : (
            <span className={styles.photoLeadCredit}>사진 출처 · {leadPhotoReport.photoAttribution}</span>
          )
        )}
      </section>

      <section className={styles.homeDecisionHero} aria-label="방문 판단 안내">
        <div>
          <p className={styles.homeDecisionEyebrow}>{dataMode === "directory" ? "실시간 연결 보호 중" : "어디 갈지 고민될 때"}</p>
          <h2>{dataMode === "directory" ? <>전국 장소 위치를<br />먼저 확인하세요.</> : <>출발 전,<br />지금 상황만 확인하세요.</>}</h2>
          <p>{dataMode === "directory"
            ? "현재 상태는 추정하지 않습니다. 지역을 바꾸거나 지도에서 다시 불러오면 연결 복구를 확인합니다."
            : "날씨·인파·대기·주차를 한 화면에서 보고 10초 안에 결정해요."}</p>
        </div>
        <div className={styles.homeDecisionActions}>
          <button className={styles.homeDecisionPrimary} type="button" onClick={onGoMap}>
            <MapIcon size={17} /> 지도로 바로 확인
          </button>
          <button className={styles.homeDecisionSecondary} type="button" onClick={() => onGoSearch()}>
            장소 검색 <ChevronRight size={16} />
          </button>
        </div>
        <div className={styles.homeTrustPromise}>
          <ShieldCheck size={16} />
          <span>오래됐거나 근거가 없는 정보는 추천에 쓰지 않아요.</span>
        </div>
      </section>

      <section className={styles.homeWeather} aria-label="공식 현재 날씨">
        <div className={styles.homeWeatherHeader}>
          <div>
            <p className={styles.eyebrow}>공식 현재 날씨</p>
            <h2>{officialWeather ? placeById.get(officialWeather.placeId)?.name ?? "선택 지역" : "선택 지역"}</h2>
          </div>
          <CloudSun size={23} />
        </div>
        {officialWeather ? (
          <>
            <strong className={styles.homeWeatherValue}>
              {typeof officialWeather.valueNumber === "number"
                ? `${officialWeather.valueNumber}${officialWeather.unit ?? "°C"}`
                : liveSignalValueLabel(officialWeather.dimension, officialWeather.valueCode)}
            </strong>
            <p>{officialWeather.valueText ?? liveSignalValueLabel(officialWeather.dimension, officialWeather.valueCode)}</p>
            <div className={styles.homeWeatherMeta}>
              <span>{officialWeather.sourceName}</span>
              <time dateTime={officialWeather.observedAt}>{formatObservedAt(officialWeather.observedAt)}</time>
            </div>
          </>
        ) : (
          <div className={styles.homeWeatherEmpty}>
            <strong>현재 확인된 공식 날씨가 없습니다</strong>
            <p>출처와 관측시각이 확인된 날씨만 여기에 표시합니다.</p>
          </div>
        )}
      </section>

      <section className={styles.homeEvidencePulse} aria-label="현재 판단 근거 현황">
        {dataMode === "live" ? (
          <>
            <div>
              <p className={styles.eyebrow}>지금 확인된 근거</p>
              <strong>최신 신호 {currentSignalCount}개를 반영 중이에요</strong>
              <span>{activeSourceNames.length > 0 ? activeSourceNames.join(" · ") : "현장 제보와 공식 출처를 함께 확인해요"}</span>
            </div>
            <BadgeCheck size={24} aria-hidden="true" />
          </>
        ) : dataMode === "directory" ? (
          <>
            <div>
              <p className={styles.eyebrow}>비상 탐색 모드</p>
              <strong>검증된 장소 위치만 표시 중이에요</strong>
              <span>현재 상태·사진·제보는 연결 복구 후 확인해 주세요.</span>
            </div>
            <ShieldAlert size={24} aria-hidden="true" />
          </>
        ) : (
          <>
            <div>
              <p className={styles.eyebrow}>미리보기 안내</p>
              <strong>실제 판단에는 확인된 최신 정보만 사용해요</strong>
              <span>이 화면의 예시 수치와 사진은 방문 판단에 반영하지 않습니다.</span>
            </div>
            <ShieldAlert size={24} aria-hidden="true" />
          </>
        )}
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

      <section className={styles.homeCategorySection} aria-label="장소 종류 선택">
        <div className={styles.homeCategoryRail}>
          {homeCategoryOptions.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeHomeCategory === category.id ? styles.homeCategoryActive : ""}
              aria-pressed={activeHomeCategory === category.id}
              onClick={() => setActiveHomeCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </section>

      {dataMode === "live" && currentHomeStatuses.length > 0 && <section className={styles.decisionRail} aria-label="현재 확인된 장소 판단 요약">
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
      </section>}

      {socialFeedEnabled && <section className={styles.sectionBlock}>
        <SectionTitle title={selectedHashtagName ? `#${selectedHashtagName} 피드` : "실시간 사진 피드"} caption={selectedHashtagName ? `${filteredPosts.length}개 현장 게시물` : `${activeFeedTab} ${filteredPosts.length}건`} />
        {selectedHashtagName && (
          <div className={styles.feedFilterBanner}>
            <span>해시태그 필터 적용 중</span>
            <button type="button" onClick={onClearHashtagFilter}>전체 피드 보기</button>
          </div>
        )}
        <div className={styles.feedTabs} role="tablist" aria-label="실시간 사진 피드 필터">
          {feedTabLabels.map((tab, index) => (
            <button
              key={tab}
              id={`home-feed-tab-${index}`}
              aria-controls="home-feed-panel"
              aria-selected={tab === activeFeedTab}
              className={tab === activeFeedTab ? styles.activeFeedTab : ""}
              role="tab"
              tabIndex={tab === activeFeedTab ? 0 : -1}
              type="button"
              onClick={() => setActiveFeedTab(tab)}
              onKeyDown={(event) => {
                const nextIndex = nextTabIndex(event, index, feedTabLabels.length);
                if (nextIndex === null) return;
                event.preventDefault();
                setActiveFeedTab(feedTabLabels[nextIndex]);
                window.requestAnimationFrame(() => document.getElementById(`home-feed-tab-${nextIndex}`)?.focus());
              }}
            >{tab}</button>
          ))}
        </div>
        <div
          className={styles.feedList}
          id="home-feed-panel"
          role="tabpanel"
          aria-labelledby={`home-feed-tab-${Math.max(0, feedTabLabels.indexOf(activeFeedTab))}`}
        >
          {filteredPosts.map((post) => {
            const place = places.find((item) => item.id === post.placeId) ?? places[0];
            return (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                reports={reports}
                onBlock={() => onBlockPost(post)}
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
      </section>}

      {rewardsEnabled && <section className={styles.challengeSection}>
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
      </section>}

      {hashtags.length > 0 && <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption="최대 5개 추천 구조" />
        <div className={styles.hashtagCloud}>
          {hashtags.slice(0, 4).map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)} aria-label={`#${tag.name} 해시태그 보기`}>
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
      </section>}

      <section className={styles.sectionBlock}>
        <div className={styles.nearbyHeadingActions}>
          <SectionTitle title="지금 확인할 장소" caption={`${homePlaces.length}곳`} />
          <button className={styles.nearbyMapButton} type="button" onClick={onGoMap}>
            <MapIcon size={15} />지도
          </button>
        </div>
        <div className={styles.rankingList}>
          {homePlaces.map((place, index) => {
            const placeStatus = currentLivePlaceStatus(placeStatuses[place.id]);
            const decisionStatus = placeStatus?.status ?? "insufficient";
            const decisionLabel = dataMode === "live" ? visitDecisionShortLabel(decisionStatus) : place.signal;
            const primarySignal = placeStatus?.currentSignals[0];

            return (
              <button key={place.id} className={styles.rankingItem} type="button" onClick={() => onOpenPlace(place)}>
              <span className={styles.rank}>{index + 1}</span>
              <div className={styles.homePlaceCopy}>
                <div className={styles.homePlaceTitleRow}>
                  <strong>{place.name}</strong>
                  <span className={styles.homePlaceSignal} data-decision={decisionStatus}>
                    {decisionLabel}
                  </span>
                </div>
                <p>{place.summary}</p>
                <span className={styles.homePlaceEvidence}>현재 위치 기준 {place.distance}</span>
                {primarySignal ? (
                  <span className={styles.homePlaceEvidence}>
                    {primarySignal.sourceName} · {formatObservedAt(primarySignal.observedAt)} · {formatConfidence(primarySignal.confidenceScore)} · {formatExpiryHint(primarySignal.expiresAt)}
                  </span>
                ) : (
                  <span className={styles.homePlaceEvidence}>현재 판단 근거 확인 중 · {place.updated}</span>
                )}
              </div>
              <span className={styles.visitors}>{place.visitors}</span>
              </button>
            );
          })}
          {homePlaces.length === 0 && (
            <div className={styles.emptyActionRow}>
              <p className={styles.emptyText}>선택한 종류의 장소가 아직 없습니다.</p>
              <button type="button" onClick={() => setActiveHomeCategory("all")}>전체 장소 보기</button>
              <button type="button" onClick={onGoMap}>지도에서 찾기</button>
            </div>
          )}
        </div>
      </section>

      {reports.length > 0 && (
        <section className={styles.sectionBlock}>
          <SectionTitle title="최근 현장 코멘트" caption="최근순" />
          <div className={styles.reportGrid}>
            {reports.slice(0, 2).map((report) => {
              const place = places.find((item) => item.id === report.placeId) ?? places[0];
              return (
                <LiveReportCard
                  key={report.id}
                  report={report}
                  place={place}
                  onOpen={() => onOpenPlace(place)}
                  onShare={report.moderationStatus === "approved" && !report.hiddenAt && !report.isSample
                    ? () => onShareReport(report, place)
                    : undefined}
                  onVote={(voteType) => onVoteReport(report, voteType)}
                />
              );
            })}
          </div>
        </section>
      )}

      {qnaEnabled && <AnswerableQuestions questions={questions} places={places} />}
    </div>
  );
}

function SearchScreen({
  dataMode,
  followedHashtagNames,
  hashtags,
  selectedHashtagName,
  onFollowHashtag,
  onGoMap,
  onGoUpload,
  onLoadMoreHashtagMedia,
  onOpenPlace,
  onQueryChange,
  onRequestPlaceAddition,
  onSelectHashtag,
  placeAdditionRequestSubmitting,
  places,
  posts,
  query,
  reports,
  hashtagMediaHasMore,
  hashtagMediaLoadingMore,
  workerPhotos,
}: {
  dataMode: DataMode;
  followedHashtagNames: Set<string>;
  hashtags: PublicHashtag[];
  selectedHashtagName: string | null;
  onFollowHashtag: (hashtagName: string) => void;
  onGoMap: (query: string) => void;
  onGoUpload: (place: Place) => void;
  onLoadMoreHashtagMedia: () => void;
  onOpenPlace: (place: Place) => void;
  onQueryChange: (query: string) => void;
  onRequestPlaceAddition: (draft: PlaceAdditionRequestDraft) => Promise<boolean>;
  onSelectHashtag: (hashtagName: string) => void;
  placeAdditionRequestSubmitting: boolean;
  places: Place[];
  posts: PublicPost[];
  query: string;
  reports: Report[];
  hashtagMediaHasMore: boolean;
  hashtagMediaLoadingMore: boolean;
  workerPhotos: WorkerPhoto[];
}) {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.replace(/^#/, "").trim().toLocaleLowerCase("ko-KR");
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const [externalSearchStatus, setExternalSearchStatus] = useState<"idle" | "loading" | "ready" | "unconfigured" | "error">("idle");
  const [externalPlaces, setExternalPlaces] = useState<NaverLocalSearchResult[]>([]);
  const [externalSearchMessage, setExternalSearchMessage] = useState("");
  const [placeRequestFormOpen, setPlaceRequestFormOpen] = useState(false);
  const [placeRequestName, setPlaceRequestName] = useState("");
  const [placeRequestAddress, setPlaceRequestAddress] = useState("");
  const [placeRequestCategory, setPlaceRequestCategory] = useState("");
  const [placeRequestFormMessage, setPlaceRequestFormMessage] = useState("");
  const matchedPlaces = searchPlaces(places, trimmedQuery).slice(0, 6);
  const matchedHashtags = hashtags
    .filter((tag) => !normalizedQuery || tag.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
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
  const fieldReportPhotos = reports
    .filter((report) => report.moderationStatus === "approved" && !report.hiddenAt && report.hasPhoto)
    .filter((report) => {
      if (!normalizedQuery) return true;
      const place = placeById.get(report.placeId);
      const haystack = [report.title, report.body, place?.name, place?.address, ...report.hashtagNames].join(" ");
      return haystack.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
    })
    .map((report) => {
      const place = placeById.get(report.placeId);
      const linkedPhoto = workerPhotos.find(
        (photo) => photo.status === "ready" && report.photoIds.includes(photo.id),
      );
      return { report, place, photoUrl: linkedPhoto?.previewUrl ?? report.photoUrl };
    })
    .filter((item): item is { report: Report; place: Place; photoUrl: string | null | undefined } => Boolean(item.place))
    .sort((left, right) => Date.parse(right.report.createdAt) - Date.parse(left.report.createdAt))
    .slice(0, 4);
  const hotRegions = ["광안리", "황리단길", "태화강", "주차", "웨이팅", "사진스팟"];
  const externalSearchEnabled = dataMode === "live" && !trimmedQuery.startsWith("#") && trimmedQuery.length >= 2;
  const visibleExternalSearchStatus = externalSearchEnabled ? externalSearchStatus : "idle";
  const visibleExternalPlaces = externalSearchEnabled ? externalPlaces : [];
  const matchedUploadPlace = matchedPlaces[0];
  const shouldShowExternalFallback =
    visibleExternalSearchStatus === "unconfigured" ||
    visibleExternalSearchStatus === "error" ||
    (visibleExternalSearchStatus === "ready" && visibleExternalPlaces.length === 0);
  const placeRequestReady = placeRequestName.trim().length >= 2
    && placeRequestAddress.trim().length >= 4
    && placeRequestName.trim().length <= 80
    && placeRequestAddress.trim().length <= 160
    && placeRequestCategory.trim().length <= 80;

  const submitManualPlaceRequest = async () => {
    if (!placeRequestReady || placeAdditionRequestSubmitting) return;
    setPlaceRequestFormMessage("");
    try {
      const submitted = await onRequestPlaceAddition({
        name: placeRequestName,
        address: placeRequestAddress,
        category: placeRequestCategory,
      });
      if (!submitted) return;
      setPlaceRequestName("");
      setPlaceRequestAddress("");
      setPlaceRequestCategory("");
      setPlaceRequestFormMessage("검토 요청을 접수했습니다. 마이에서 진행 상태를 확인할 수 있습니다.");
    } catch {
      setPlaceRequestFormMessage("요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  useEffect(() => {
    if (!externalSearchEnabled) {
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
          setExternalSearchMessage("");
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
  }, [externalSearchEnabled, trimmedQuery]);

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
        <SectionTitle title={dataMode === "directory" ? "최근 사진 연결 중단" : "사진 있는 최근 결과"} caption={`${fieldReportPhotos.length + matchedPosts.length}개`} />
        {selectedHashtagName && (
          <button
            className={styles.followTagButton}
            type="button"
            onClick={() => onFollowHashtag(selectedHashtagName)}
            aria-pressed={followedHashtagNames.has(selectedHashtagName)}
          >
            <Bell size={14} />
            {followedHashtagNames.has(selectedHashtagName) ? `#${selectedHashtagName} 팔로잉 해제` : `#${selectedHashtagName} 팔로우`}
          </button>
        )}
        <div className={styles.searchPhotoList}>
          {fieldReportPhotos.map(({ report, place, photoUrl }) => (
            <article key={report.id} className={styles.searchPhotoItem}>
              <button className={styles.searchPhotoButton} type="button" onClick={() => onOpenPlace(place)}>
                <span className={styles.searchPhotoThumb} style={photoBackgroundStyle(photoUrl)} aria-hidden="true" />
                <span className={styles.searchPhotoCopy}>
                  <span>{report.verified ? "현장 인증 사진" : "최신 제보 사진"}</span>
                  <strong>{place.name}</strong>
                  <p>{report.body}</p>
                  <time className={styles.searchResultTime} dateTime={report.createdAt} title={formatFullDateTime(report.createdAt)}>
                    {report.isSample ? "체험용 샘플 시각" : formatRecentTimestamp(report.createdAt)}
                  </time>
                </span>
              </button>
              <button type="button" onClick={() => onGoUpload(place)}>지금컷 추가</button>
            </article>
          ))}
          {matchedPosts.map((post) => {
            const place = placeById.get(post.placeId) ?? places[0];
            const photoUrl = photoUrlForPost(post, reports);
            const isSample = Boolean(post.isSample) || post.id.startsWith("fallback_");

            return (
              <article key={post.id} className={styles.searchPhotoItem}>
                <button className={styles.searchPhotoButton} type="button" onClick={() => place && onOpenPlace(place)}>
                  <span className={styles.searchPhotoThumb} style={photoBackgroundStyle(photoUrl)} aria-hidden="true" />
                  <span className={styles.searchPhotoCopy}>
                    <span>{isSample ? "샘플 사진" : post.photoCount > 0 ? "사진 있음" : "상태"}</span>
                    <strong>{place?.name ?? "장소"}</strong>
                    <p>{post.caption ?? post.shareCard.headline}</p>
                    <time className={styles.searchResultTime} dateTime={post.createdAt} title={formatFullDateTime(post.createdAt)}>
                      {isSample ? "체험용 샘플 시각" : formatRecentTimestamp(post.createdAt)}
                    </time>
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
        {selectedHashtagName && hashtagMediaHasMore && (
          <button
            className={styles.inlineActionButton}
            type="button"
            onClick={onLoadMoreHashtagMedia}
            disabled={hashtagMediaLoadingMore}
            aria-busy={hashtagMediaLoadingMore}
          >
            {hashtagMediaLoadingMore ? "최신 사진 더 불러오는 중" : `#${selectedHashtagName} 최신 사진 더 보기`}
          </button>
        )}
        {fieldReportPhotos.length + matchedPosts.length === 0 && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>{dataMode === "directory" ? "보호 모드에서는 최근 사진을 불러오지 않습니다." : "아직 검색어와 맞는 최근 사진이 없습니다."}</p>
            <button type="button" onClick={() => onGoMap(trimmedQuery)}>지도에서 찾기</button>
            {matchedUploadPlace && <button type="button" onClick={() => onGoUpload(matchedUploadPlace)}>지금컷 추가</button>}
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
        {dataMode === "directory" && <p className={styles.emptyText}>보호 모드에서는 외부 검색을 호출하지 않습니다. 위 기본 장소 목록을 이용해 주세요.</p>}
        {dataMode !== "directory" && visibleExternalSearchStatus === "idle" && <p className={styles.emptyText}>두 글자 이상 입력하면 앱 밖 장소도 함께 확인합니다.</p>}
        {visibleExternalSearchStatus === "loading" && <p className={styles.emptyText}>네이버 장소를 확인하는 중입니다.</p>}
        {visibleExternalSearchStatus === "unconfigured" && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>현재는 앱에 등록된 장소만 검색합니다. 찾는 장소가 없으면 지도에서 지역을 넓혀보세요.</p>
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
            {matchedUploadPlace ? (
              <button type="button" onClick={() => onGoUpload(matchedUploadPlace)}>
                이 장소 지금컷 추가
              </button>
            ) : (
              <button type="button" onClick={() => onGoMap("")}>인기 지역 보기</button>
            )}
          </div>
        )}
        {visibleExternalPlaces.length > 0 && (
          <>
            <p className={styles.externalResultNotice}>아래 내용은 네이버 검색 결과이며 #실시간에 등록된 장소가 아닙니다. 검색 결과는 별도 저장하지 않습니다.</p>
            <div className={styles.searchPhotoList} aria-label="네이버 장소 검색 결과">
              {visibleExternalPlaces.map((item) => {
              const address = item.roadAddress || item.address || "주소 정보 없음";

              return (
                <article key={`${item.title}:${address}`} className={styles.searchPhotoItem}>
                  <div className={styles.externalResultCopy}>
                    <span>{item.category || "네이버 장소"}</span>
                    <strong>{item.title}</strong>
                    <p>{address}</p>
                  </div>
                </article>
              );
              })}
            </div>
          </>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="실시간 장소 직접 제안" caption="검토 후 등록" />
        <p className={styles.externalResultNotice}>
          네이버 검색 결과는 자동으로 옮기지 않습니다. 직접 알고 있는 장소명과 주소를 입력하면 운영자가 주소·좌표·중복 여부를 확인합니다.
        </p>
        {!placeRequestFormOpen ? (
          <button className={styles.inlineActionButton} type="button" onClick={() => setPlaceRequestFormOpen(true)}>
            장소 추가 요청 작성
          </button>
        ) : (
          <div className={styles.placeRequestForm}>
            <label>
              장소명
              <input
                autoComplete="off"
                maxLength={80}
                value={placeRequestName}
                onChange={(event) => setPlaceRequestName(event.target.value)}
                placeholder="직접 알고 있는 장소명"
              />
            </label>
            <label>
              주소
              <input
                autoComplete="street-address"
                maxLength={160}
                value={placeRequestAddress}
                onChange={(event) => setPlaceRequestAddress(event.target.value)}
                placeholder="도로명 또는 지번 주소"
              />
            </label>
            <label>
              카테고리 <span>선택</span>
              <input
                autoComplete="off"
                maxLength={80}
                value={placeRequestCategory}
                onChange={(event) => setPlaceRequestCategory(event.target.value)}
                placeholder="예: 공원, 시장, 해수욕장"
              />
            </label>
            <p>접수만으로 지도·랭킹·사진 등록에 공개되지 않습니다.</p>
            {placeRequestFormMessage && <p role="status">{placeRequestFormMessage}</p>}
            <div className={styles.emptyActionRow}>
              <button type="button" onClick={() => setPlaceRequestFormOpen(false)} disabled={placeAdditionRequestSubmitting}>닫기</button>
              <button
                type="button"
                onClick={() => void submitManualPlaceRequest()}
                disabled={!placeRequestReady || placeAdditionRequestSubmitting}
                aria-busy={placeAdditionRequestSubmitting}
              >
                {placeAdditionRequestSubmitting ? "검토 요청 중" : "검토 요청 보내기"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="인기 해시태그" caption={`${matchedHashtags.length}개`} />
        <div className={styles.hashtagCloud}>
          {matchedHashtags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => onSelectHashtag(tag.name)} aria-label={`#${tag.name} 해시태그 보기`}>
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
            {matchedUploadPlace && <button type="button" onClick={() => onGoUpload(matchedUploadPlace)}>해시태그로 지금컷 올리기</button>}
          </div>
        )}
      </section>
    </div>
  );
}

function MapScreen({
  activeFilter,
  dataMode,
  photoUploadReady,
  activeRegion,
  currentLocation,
  likedPlaceIds,
  liveConnection,
  locationPermission,
  mapBounds,
  mapRequerying,
  onFilterChange,
  onClosePreview,
  onBlockComment,
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
  photoUploadReady: boolean;
  activeRegion: RegionTabId;
  currentLocation: UiLocation | null;
  likedPlaceIds: Set<string>;
  liveConnection: "connecting" | "live" | "polling";
  locationPermission: LocationPermissionState;
  mapBounds: MapBounds | null;
  mapRequerying: boolean;
  onFilterChange: (filter: string) => void;
  onClosePreview: () => void;
  onBlockComment: (place: Place, comment: PlaceComment) => void;
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
  const mapTop = dataMode === "directory"
    ? []
    : rankPlaces(dataMode === "live" ? mapAreaPlaces.filter((place) => place.score > 0) : mapAreaPlaces);
  const detailPlace = previewPlace;
  const detailPosts = detailPlace ? posts.filter((post) => post.placeId === detailPlace.id && !post.hiddenAt) : [];
  const detailReports = detailPlace
    ? reports.filter((report) => report.placeId === detailPlace.id && !report.hiddenAt && report.moderationStatus === "approved")
    : [];
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
          <p className={styles.eyebrow}>{dataMode === "directory" ? "전국 기본 장소 위치" : "전국 장소와 최근 근거"}</p>
          <h2>{dataMode === "directory" ? "장소 위치를 확인하고 연결을 다시 시도하세요" : "장소를 찾고 최근 사진·상태를 확인하세요"}</h2>
        </div>
        <span className={styles.liveBadge}>{dataMode === "directory" ? "위치 목록" : visibleLiveConnection === "live" ? "실시간 연결" : "자동 갱신"}</span>
      </section>

      <section className={styles.realMapFrame} aria-label="네이버 지도 기반 현장 지도">
        <NaverMap
          places={filteredPlaces}
          compact
          currentLocation={currentLocation}
          providerEnabled={dataMode !== "directory" && dataMode !== "unavailable"}
          showTraffic={trafficEnabled}
          onBoundsChange={onMapBoundsChange}
          onMapInteraction={() => setRequeryHintVisible(true)}
          onMapReady={() => trackEvent("map_load_succeeded")}
          onMapFailure={(reason) => trackEvent("map_load_failed", { reason })}
          onSelectPlace={selectMapPlace}
        />
      </section>
      <p className={styles.mapTruthNote}>
        {dataMode === "sample"
          ? "샘플 미리보기라 지도 핀과 상태도 예시입니다. 운영에서는 최근 근거가 없는 장소를 ‘최근 확인 정보 없음’으로 표시합니다."
          : dataMode === "directory"
            ? "API 보호 중이라 검증된 장소 핀만 표시합니다. 모든 상태는 ‘최근 확인 정보 없음’이며 실시간 판단에 사용하지 않습니다."
            : "네이버 지도 타일이 불안정하면 대체 지도가 먼저 표시됩니다. 장소 판단은 사진과 최근 상태를 함께 확인하세요."}
      </p>

      {detailPlace && (
        <section className={styles.mapSelectedPlaceBar} aria-live="polite">
          <div>
            <span>
              {dataMode === "directory"
                ? "기본 장소 · 최근 확인 정보 없음"
                : `${photos.length > 0 ? `사진 ${photos.length}장` : "상태 제보"} · ${detailReports[0]?.meta ?? (detailPosts[0] ? minutesAgo(detailPosts[0].createdAt) : "방금 전")}`}
            </span>
            <strong>{detailPlace.name}</strong>
            <p>{detailReports[0]?.body ?? detailPosts[0]?.caption ?? detailPlace.summary}</p>
          </div>
          <div className={styles.mapSelectedActions}>
            <button type="button" onClick={() => detailSheetRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>
              {dataMode === "directory" ? "장소 정보 보기" : "실시간 사진 보기"}
            </button>
            <button type="button" onClick={() => onReport(detailPlace)} disabled={dataMode !== "live"}>
              {dataMode === "directory" ? "연결 후 업로드" : "지금컷 올리기"}
            </button>
          </div>
        </section>
      )}

      <div className={styles.mapSearchRow}>
        <label className={styles.searchBox}>
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="지도 장소 검색"
            placeholder="장소·지역 검색"
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
        <button className={trafficEnabled ? styles.mapToolActive : ""} type="button" onClick={toggleTraffic} aria-pressed={trafficEnabled} disabled={dataMode === "directory"}>
          {dataMode === "directory" ? "교통 연결 중단" : trafficEnabled ? "교통 끄기" : "교통 켜기"}
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
            if (permission === "requesting") {
              trackEvent("location_permission_requested");
            } else if (permission === "granted") {
              trackEvent("location_permission_granted");
            } else if (permission === "denied" || permission === "unsupported") {
              trackEvent("location_permission_denied", { reason: permission });
            }
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
            reportCount={comments.length}
            realtimeEvents={realtimeEventsByPlaceId[detailPlace.id] ?? []}
            realtimeMode={visibleLiveConnection}
            safetyNotice={sensitivePhotoWarningFor(detailPlace)}
            photoUploadReady={photoUploadReady}
            liked={likedPlaceIds.has(detailPlace.id)}
            onClose={onClosePreview}
            onBlockComment={(comment) => onBlockComment(detailPlace, comment)}
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

      <section
        className={styles.rankingGrid}
        id="map-region-results"
        role="tabpanel"
        aria-labelledby={`map-region-tab-${activeRegion}`}
        aria-label="실시간 장소 랭킹"
      >
        <RankingPanel
          title={dataMode === "directory" ? "실시간 순위 일시 중단" : activeRegion === "nationwide" ? "전국 최신 근거 TOP 10" : "지도 화면 안 TOP 10"}
          places={mapTop}
          onOpenPlace={(place) => {
            const fullPlace = places.find((candidate) => candidate.id === place.id);
            if (fullPlace) onPreviewPlace(fullPlace, "ranking");
          }}
          emptyBody={dataMode === "directory"
            ? "기본 장소 위치는 표시하지만 최신 근거가 없으므로 순위를 만들지 않습니다."
            : activeRegion === "nationwide"
              ? "전국 기능은 열려 있지만 현재 순위를 만들 최신 근거가 없습니다. 정보 없는 장소는 순위에 넣지 않습니다."
              : "지도를 움직이거나 지역 탭을 바꾸면 최신 근거가 있는 후보만 다시 계산됩니다."}
        />
      </section>
    </div>
  );
}

function PlaceScreen({
  dataMode,
  photoUploadReady,
  qnaEnabled,
  rewardsEnabled,
  place,
  followed,
  placeStatus,
  placeStatusLoading,
  posts,
  questions,
  reports,
  focusedReportId,
  nearbyPlaces,
  fieldQuests,
  onFollow,
  onAsk,
  onAnswerQuest,
  onBlockPost,
  onFlagPost,
  helpfulPostIds,
  savedPostIds,
  onHelpfulPost,
  onPhotoDelete,
  onPhotoClick,
  onPhotoUpload,
  onReport,
  onReportPhoto,
  onSavePost,
  onShareReport,
  onSharePost,
  onSelectHashtag,
  onVoteReport,
  workerPhotos,
}: {
  dataMode: DataMode;
  photoUploadReady: boolean;
  qnaEnabled: boolean;
  rewardsEnabled: boolean;
  place: Place;
  followed: boolean;
  placeStatus: CloudflarePlaceStatus | null;
  placeStatusLoading: boolean;
  posts: PublicPost[];
  questions: Question[];
  reports: Report[];
  focusedReportId: string | null;
  nearbyPlaces: Place[];
  fieldQuests: FieldQuest[];
  onFollow: (place: Place) => void;
  onAsk: () => void;
  onAnswerQuest: (quest: FieldQuest) => void;
  onBlockPost: (post: PublicPost) => void;
  onFlagPost: (post: PublicPost) => void;
  helpfulPostIds: Set<string>;
  savedPostIds: Set<string>;
  onHelpfulPost: (post: PublicPost) => void;
  onPhotoDelete: (place: Place, photo: PlacePhoto) => Promise<void>;
  onPhotoClick: (photo: PlacePhoto) => Promise<void>;
  onPhotoUpload: (place: Place, photo: PreparedPhotoUpload) => Promise<void>;
  onReport: () => void;
  onReportPhoto: (place: Place, photo: PlacePhoto) => void;
  onSavePost: (post: PublicPost) => void;
  onShareReport: (report: Report, place: Place) => void;
  onSharePost: (post: PublicPost) => void;
  onSelectHashtag: (hashtagName: string) => void;
  onVoteReport: (report: Report, voteType: "agree" | "changed") => void;
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
  const visiblePlaceTabs: PlaceTab[] = qnaEnabled
    ? ["실시간", "사진", "질문", "해시태그", "근처"]
    : ["실시간", "사진", "해시태그", "근처"];
  const latestReportEvidence = reports.find((report) => !report.isSample) ?? null;
  const signalCount = placeStatus?.currentSignals.length ?? 0;
  const evidenceCount = signalCount > 0 ? signalCount : latestReportEvidence ? 1 : 0;
  const decisionLabel = dataMode === "sample"
    ? "샘플 화면이며 실제 방문 판단에 사용할 수 없어요"
    : dataMode === "directory"
      ? "최근 확인 정보 없음"
      : placeStatusLoading
        ? "판단 근거 확인 중"
        : visitDecisionLabel(placeStatus?.status ?? "insufficient");
  const decisionDetail = dataMode === "sample"
    ? "아래 내용은 기능 확인용 샘플이며 실제 관측 정보가 아닙니다."
    : dataMode === "directory"
      ? "검증된 장소 위치만 표시합니다. 현재 상태·사진·제보는 연결 복구 후 확인해 주세요."
      : placeStatus?.observedAt
        ? `최근 관측 ${formatObservedAt(placeStatus.observedAt)}`
        : "판단할 최신 관측 정보가 부족합니다.";

  useEffect(() => {
    if (!focusedReportId || !reports.some((report) => report.id === focusedReportId)) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const reportCard = document.querySelector<HTMLElement>(`[data-report-id="${focusedReportId}"]`);
      if (!reportCard) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      reportCard.scrollIntoView({ block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      reportCard.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusedReportId, reports]);

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
          <button className={styles.followTagButton} type="button" onClick={() => onFollow(place)} aria-pressed={followed}>
            <Bell size={14} />
            {followed ? "팔로우 해제" : "장소 팔로우"}
          </button>
        </div>
        <p>{place.summary}</p>
        <div className={styles.placeStatsRow}>
          <StatBox label={dataMode === "sample" ? "체험 예시" : dataMode === "directory" ? "확인된 제보" : "오늘 제보"} value={String(todayReports)} />
          <StatBox label="사진" value={String(photoCount)} />
          {qnaEnabled && <StatBox label="질문" value={String(questions.filter((question) => question.placeId === place.id).length)} />}
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
          <p className={styles.eyebrow}>방문 판단</p>
          <strong>{decisionLabel}</strong>
          <span>{decisionDetail}</span>
        </div>
        <div className={styles.trustRing}>
          <ShieldCheck size={24} />
        </div>
      </section>

      <section className={styles.sourceEvidenceCard} aria-label="현재 상태 출처와 관측시각">
        <SectionTitle title="현재 판단 근거" caption={`${evidenceCount}개`} />
        {placeStatusLoading && <p className={styles.sourceEvidenceEmpty}>최신 출처를 확인하고 있습니다.</p>}
        {!placeStatusLoading && placeStatus?.currentSignals.map((signal) => (
          <article className={styles.sourceEvidenceItem} key={signal.id}>
            <div>
              <strong>{liveSignalDimensionLabel(signal.dimension)} · {liveSignalValueLabel(signal.dimension, signal.valueCode)}</strong>
              <span>{signal.sourceName}{signal.attributionText ? ` · ${signal.attributionText}` : ""}</span>
            </div>
            <div className={styles.sourceEvidenceMeta}>
              <span>{signal.isEstimated ? "예상" : liveSignalSourceLabel(signal.sourceType)}</span>
              <time dateTime={signal.observedAt}>{formatObservedAt(signal.observedAt)}</time>
            </div>
          </article>
        ))}
        {!placeStatusLoading && signalCount === 0 && latestReportEvidence && (
          <article className={styles.sourceEvidenceItem}>
            <div>
              <strong>현장 제보 · {latestReportEvidence.body}</strong>
              <span>{dataMode === "sample" ? "샘플 사용자 제보" : "사용자 제보"}</span>
            </div>
            <div className={styles.sourceEvidenceMeta}>
              <span>{latestReportEvidence.verified ? "현장 확인" : "미확인"}</span>
              <time dateTime={latestReportEvidence.createdAt}>{formatObservedAt(latestReportEvidence.createdAt)}</time>
            </div>
          </article>
        )}
        {!placeStatusLoading && signalCount === 0 && !latestReportEvidence && (
          <p className={styles.sourceEvidenceEmpty}>유효한 공식 데이터나 현장 제보가 아직 없습니다.</p>
        )}
      </section>

      {hasSensitivePolicy && (
        <section className={styles.warningCard}>
          <ShieldAlert size={18} />
          <p>{sensitiveWarning}</p>
        </section>
      )}

      {qnaEnabled && <section className={styles.fieldQuestCard}>
        <SectionTitle title="근처 사람이 궁금해해요" caption={`${fieldQuests.length}개`} />
        <div className={styles.fieldQuestList}>
          {fieldQuests.map((quest) => (
            <button key={quest.id} type="button" onClick={() => onAnswerQuest(quest)}>
              <MessageCircleQuestion size={17} />
              <div>
                <strong>{quest.prompt}</strong>
                <span>{rewardsEnabled ? `답변하면 질문권 +${quest.rewardCredits}` : "현장 질문에 답변하기"}</span>
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
      </section>}

      <section className={styles.placeTabs} role="tablist" aria-label="장소 프로필 탭">
        {visiblePlaceTabs.map((tab, index) => (
          <button
            key={tab}
            id={`place-tab-${index}`}
            aria-controls="place-tab-panel"
            aria-selected={tab === placeActiveTab}
            className={tab === placeActiveTab ? styles.placeTabActive : ""}
            role="tab"
            tabIndex={tab === placeActiveTab ? 0 : -1}
            type="button"
            onClick={() => setPlaceActiveTab(tab)}
            onKeyDown={(event) => {
              const nextIndex = nextTabIndex(event, index, visiblePlaceTabs.length);
              if (nextIndex === null) return;
              event.preventDefault();
              setPlaceActiveTab(visiblePlaceTabs[nextIndex]);
              window.requestAnimationFrame(() => document.getElementById(`place-tab-${nextIndex}`)?.focus());
            }}
          >{tab}</button>
        ))}
      </section>

      {(placeActiveTab === "실시간" || placeActiveTab === "사진") && (
        <section className={styles.sectionBlock} id="place-tab-panel" role="tabpanel" aria-labelledby={`place-tab-${visiblePlaceTabs.indexOf(placeActiveTab)}`}>
          <SectionTitle title={placeActiveTab === "사진" ? "사진 있는 게시물" : "장소별 타임라인"} caption={`${tabPosts.length}건`} />
          <div className={styles.feedList}>
            {tabPosts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                place={place}
                reports={reports}
                onBlock={() => onBlockPost(post)}
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
                {qnaEnabled && <button type="button" onClick={onAsk}>질문 남기기</button>}
              </div>
            )}
          </div>
        </section>
      )}

      {qnaEnabled && placeActiveTab === "질문" && (
        <section className={styles.sectionBlock} id="place-tab-panel" role="tabpanel" aria-labelledby={`place-tab-${visiblePlaceTabs.indexOf(placeActiveTab)}`}>
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
        <section className={styles.sectionBlock} id="place-tab-panel" role="tabpanel" aria-labelledby={`place-tab-${visiblePlaceTabs.indexOf(placeActiveTab)}`}>
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
        <section className={styles.sectionBlock} id="place-tab-panel" role="tabpanel" aria-labelledby={`place-tab-${visiblePlaceTabs.indexOf(placeActiveTab)}`}>
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
          uploadEnabled={photoUploadReady}
        />
      </section>

      <section className={styles.sectionBlock}>
        <SectionTitle title="현장 인증 제보" caption="최근 3시간" />
        {reports.map((report) => (
          <LiveReportCard
            key={report.id}
            focused={report.id === focusedReportId}
            report={report}
            place={place}
            onShare={report.moderationStatus === "approved" && !report.hiddenAt && !report.isSample
              ? () => onShareReport(report, place)
              : undefined}
            onVote={(voteType) => onVoteReport(report, voteType)}
          />
        ))}
        {reports.length === 0 && (
          <div className={styles.emptyActionRow}>
            <p className={styles.emptyText}>최근 3시간 안에 올라온 현장 제보가 없습니다.</p>
            <button type="button" onClick={onReport}>확인한 상태 제보하기</button>
          </div>
        )}
      </section>

      {qnaEnabled && <section className={styles.questionCard}>
        <div>
          <p className={styles.eyebrow}>최근 질문</p>
          <h3>{latestQuestion?.body ?? "지금 현장 상황이 궁금한가요?"}</h3>
        </div>
        <button type="button" onClick={onAsk}>물어보기</button>
      </section>}

      <div className={styles.stickyActions}>
        {qnaEnabled && <button className={styles.secondaryButton} type="button" onClick={onAsk}>물어보기</button>}
        <button className={styles.primaryButton} type="button" onClick={onReport}>지금컷 올리기</button>
      </div>
    </div>
  );
}

function ReportPlaceGate({
  places,
  onMap,
  onSearch,
  onSelectPlace,
}: {
  places: Place[];
  onMap: () => void;
  onSearch: () => void;
  onSelectPlace: (place: Place) => void;
}) {
  return (
    <div className={styles.screenStack}>
      <section className={styles.reportPlaceGate} aria-labelledby="report-place-gate-title">
        <span className={styles.reportPlaceGateIcon} aria-hidden="true"><MapPin size={24} /></span>
        <div>
          <p className={styles.reportPlaceGateEyebrow}>지금컷 올리기</p>
          <h2 id="report-place-gate-title">장소를 먼저 선택해 주세요</h2>
          <p>선택하기 전에는 어떤 장소에도 사진이나 상태가 연결되지 않습니다.</p>
        </div>
      </section>

      {places.length > 0 && (
        <section className={styles.uploadPlaceCard} aria-label="최근 확인한 장소 선택">
          <div>
            <span>앱 안 장소</span>
            <strong>올릴 장소를 직접 확인해 주세요</strong>
            <p>장소 이름과 주소를 확인한 뒤 선택하면 작성 화면이 열립니다.</p>
          </div>
          <div className={styles.reportPlaceChoiceList}>
            {places.slice(0, 8).map((place) => (
              <button key={place.id} type="button" onClick={() => onSelectPlace(place)}>
                <strong>{place.name}</strong>
                <span>{place.address}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.reportPlaceGateActions} aria-label="다른 장소 찾기">
        {places.length === 0 && <p>아직 앱에 확인된 장소가 없습니다. 검색이나 지도에서 먼저 장소를 찾아주세요.</p>}
        <button type="button" onClick={onSearch}><Search size={17} /> 장소 검색</button>
        <button type="button" onClick={onMap}><MapIcon size={17} /> 지도에서 선택</button>
      </section>
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
  pickedLocalConditions,
  photoAttached,
  locationVerificationStatus,
  reportText,
  recommendedTags,
  quickReportPresets,
  photos,
  setPickedCrowd,
  setPickedParking,
  setPickedLine,
  onToggleLocalCondition,
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
  pickedLocalConditions: Set<string>;
  photoAttached: boolean;
  locationVerificationStatus: LocationVerificationStatus;
  reportText: string;
  recommendedTags: string[];
  quickReportPresets: QuickReportPreset[];
  photos: PlacePhoto[];
  setPickedCrowd: (value: string) => void;
  setPickedParking: (value: string) => void;
  setPickedLine: (value: string) => void;
  onToggleLocalCondition: (value: string) => void;
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
  const placeLockedByPhoto = photoAttached;
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
            <li>운전 중에는 제보하지 말고, 안전하게 정차한 뒤 올려주세요.</li>
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
          uploadEnabled={photoUploadReady}
        />
        {!photoUploadReady && (
          <p className={styles.uploadReadinessNote}>
            사진 서버에 연결할 수 없어 사진 선택을 비활성화했습니다. 확인한 혼잡·줄·주차 상태는 사진 없이도 바로 제보할 수 있어요.
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
        {placeLockedByPhoto && (
          <p className={styles.uploadReadinessNote} role="status">
            사진이 연결된 뒤에는 장소를 바꿀 수 없습니다. 다른 장소를 선택하려면 먼저 위 사진을 삭제해 주세요.
          </p>
        )}
        <div className={styles.uploadPlaceList}>
          {places.slice(0, 6).map((candidate) => (
            <button
              key={candidate.id}
              className={candidate.id === place.id ? styles.uploadPlaceActive : ""}
              type="button"
              onClick={() => onSelectPlace(candidate)}
              aria-pressed={candidate.id === place.id}
              disabled={placeLockedByPhoto && candidate.id !== place.id}
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
      <MultiChoiceGroup
        title="현장 상태"
        options={localConditionChips}
        values={pickedLocalConditions}
        onToggle={onToggleLocalCondition}
      />

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
  accountDeleteAvailable,
  qnaEnabled,
  rewardsEnabled,
  followedHashtagNames,
  followedPlaces,
  hiddenCreatorNames,
  myQuestions,
  onDeleteAccount,
  onSelectHashtag,
  onUnblockUser,
  onToast,
  placeAdditionRequests,
  reports,
  savedPosts,
  userBlocks,
}: {
  accountDeleteAvailable: boolean;
  qnaEnabled: boolean;
  rewardsEnabled: boolean;
  followedHashtagNames: Set<string>;
  followedPlaces: Place[];
  hiddenCreatorNames: Set<string>;
  myQuestions: MyQuestion[];
  onDeleteAccount: () => Promise<void>;
  onSelectHashtag: (hashtagName: string) => void;
  onUnblockUser: (blockId: string) => Promise<void>;
  onToast: (message: string) => void;
  placeAdditionRequests: PlaceAdditionRequest[];
  reports: Report[];
  savedPosts: PublicPost[];
  userBlocks: UserBlock[];
}) {
  const reportsRef = useRef<HTMLElement | null>(null);
  const placeRequestsRef = useRef<HTMLElement | null>(null);
  const questionsRef = useRef<HTMLElement | null>(null);
  const savedRef = useRef<HTMLElement | null>(null);
  const hashtagsRef = useRef<HTMLElement | null>(null);
  const badgesRef = useRef<HTMLElement | null>(null);
  const safetyRef = useRef<HTMLElement | null>(null);
  const accountRef = useRef<HTMLElement | null>(null);
  const [activeMenuTarget, setActiveMenuTarget] = useState<MyMenuTarget | null>(null);
  const [deletionDialogOpen, setDeletionDialogOpen] = useState(false);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const closeDeletionDialog = useCallback(() => {
    setDeletionDialogOpen(false);
    setDeletionConfirmation("");
  }, []);
  const {
    dialogRef: deletionDialogRef,
    initialFocusRef: deletionInitialFocusRef,
  } = useModalFocus(deletionDialogOpen, closeDeletionDialog);
  const answeredCount = myQuestions.filter((question) => question.status === "answered").length;
  const latestReports = [...reports]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 4);
  const latestQuestions = myQuestions.slice(0, 4);
  const latestPlaceRequests = [...placeAdditionRequests]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 6);
  const publicReportCount = reports.filter((report) => report.moderationStatus === "approved" && !report.hiddenAt).length;
  const pendingReportCount = reports.filter((report) => report.moderationStatus === "pending").length;
  const nonPublicReportCount = Math.max(0, reports.length - publicReportCount - pendingReportCount);
  const reportModerationLabel = (report: Report) => {
    if (report.moderationStatus === "pending") return "검수 대기";
    if (report.moderationStatus === "rejected") return "공개되지 않음";
    if (report.moderationStatus === "hidden") return "숨김됨";
    return "공개됨";
  };
  const questionStatusMeta = (question: MyQuestion | Question) => {
    const reward = "reward" in question ? question.reward : question.questionType === "photo_request" ? "+2" : "+1";
    return `${question.answeredReportId ? "답변 완료" : "답변 대기"} · ${reward}`;
  };
  const placeRequestStatusLabel = (status: PlaceAdditionRequestStatus) => {
    if (status === "needs_verification") return "추가 확인 중";
    if (status === "ready_for_manual_import") return "등록 준비";
    if (status === "duplicate") return "기존 장소 확인됨";
    if (status === "rejected") return "등록하지 않음";
    return "검토 대기";
  };
  const menuItems = [
    { icon: Camera, label: "최근 사진", message: "최근 사진 활동으로 이동했습니다.", target: "reports", ref: reportsRef },
    { icon: MapPin, label: "장소 추가 요청", message: "장소 추가 요청 상태로 이동했습니다.", target: "placeRequests", ref: placeRequestsRef },
    ...(qnaEnabled
      ? [{ icon: MessageCircleQuestion, label: "내 질문", message: "내 질문 현황으로 이동했습니다.", target: "questions" as const, ref: questionsRef }]
      : []),
    { icon: Bookmark, label: "저장한 게시물", message: "저장한 게시물로 이동했습니다.", target: "saved", ref: savedRef },
    { icon: Hash, label: "팔로우한 해시태그", message: "팔로우한 해시태그로 이동했습니다.", target: "hashtags", ref: hashtagsRef },
    ...(rewardsEnabled
      ? [{ icon: Star, label: "지역 뱃지", message: "지역 뱃지로 이동했습니다.", target: "badges" as const, ref: badgesRef }]
      : []),
    { icon: UserX, label: "숨긴 작성자", message: `${hiddenCreatorNames.size}명 숨김 상태를 확인합니다.`, target: "safety", ref: safetyRef },
    { icon: ShieldCheck, label: "안전 정책 및 이용 안내", message: "안전 정책으로 이동했습니다.", target: "safety", ref: safetyRef },
    { icon: Settings, label: "계정 및 데이터", message: "계정과 데이터 관리로 이동했습니다.", target: "account", ref: accountRef },
  ] satisfies Array<{ icon: LucideIcon; label: string; message: string; target: MyMenuTarget; ref: RefObject<HTMLElement | null> }>;
  const handleMenuClick = (item: (typeof menuItems)[number]) => {
    setActiveMenuTarget(item.target);
    onToast(item.message);
    window.requestAnimationFrame(() => {
      scrollNearestContainerToChild(item.ref.current);
      item.ref.current?.focus({ preventScroll: true });
    });
  };

  const confirmAccountDeletion = async () => {
    if (deletionConfirmation !== "계정 삭제" || deletingAccount) {
      return;
    }
    setDeletingAccount(true);
    try {
      await onDeleteAccount();
      closeDeletionDialog();
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div className={styles.screenStack}>
      <section className={styles.profileCard}>
        <div className={styles.avatar}>실</div>
        <div>
          <h2>익명 현장러</h2>
          <p>이 기기 기준 활동 · 로그인 없이 바로 사용</p>
        </div>
        <Settings size={19} />
      </section>

      <section className={styles.myDataNotice}>
        <ShieldCheck size={17} />
        <p>마이는 이 기기에서 저장한 장소, 제보와 안전 설정을 보여줍니다. 기기를 바꾸거나 브라우저 데이터를 지우면 복구할 수 없습니다.</p>
      </section>

      <section className={styles.reputationCard}>
        <div>
          <p className={styles.eyebrow}>내 제보 상태</p>
          <h3>{reports.length === 0 ? "아직 올린 지금컷이 없습니다." : `공개 ${publicReportCount} · 검수 대기 ${pendingReportCount} · 비공개 ${nonPublicReportCount}`}</h3>
        </div>
        <div className={styles.reputationMeter}>
          <strong>{reports.length}</strong>
          <span>이 기기 제보</span>
        </div>
        <p>
          숫자 신뢰점수를 만들지 않고 실제 검수 상태만 보여드립니다. 접수한 제보의 공개 여부는 아래 최근 사진 활동에서 확인할 수 있습니다.
        </p>
      </section>

      <section className={styles.myStatsGrid}>
        <StatBox label="내 제보" value={String(reports.length)} />
        {qnaEnabled && <StatBox label="내 질문" value={String(myQuestions.length)} />}
        {qnaEnabled && <StatBox label="답변 완료" value={String(answeredCount)} />}
        <StatBox label="저장" value={String(savedPosts.length)} />
      </section>

      {rewardsEnabled && <section
        ref={badgesRef}
        className={`${styles.badgeShelf} ${activeMenuTarget === "badges" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-label="지역 뱃지"
      >
        {["태화강 지금컷", "부산 주차 도우미", "사진 스팟 헌터"].map((badge) => (
          <span key={badge}><BadgeCheck size={14} />{badge}</span>
        ))}
      </section>}

      {rewardsEnabled && <section className={styles.walletCard}>
        <div>
          <p className={styles.eyebrow}>질문권</p>
          <h3>기본 질문권 3개로 현장 질문을 보낼 수 있어요.</h3>
        </div>
        <strong>3개</strong>
      </section>}

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
                <span>{reportModerationLabel(report)} · {report.verified ? "현장 인증" : "상태 제보"} · {report.meta}</span>
              </div>
            </article>
          ))}
          {latestReports.length === 0 && <p className={styles.emptyText}>아직 등록한 제보가 없습니다. 접수 후 검수 상태도 여기에 표시됩니다.</p>}
        </div>
      </section>

      <section
        ref={placeRequestsRef}
        className={`${styles.sectionBlock} ${activeMenuTarget === "placeRequests" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="my-place-requests-heading"
      >
        <SectionTitle title="장소 추가 요청" caption={`${latestPlaceRequests.length}건`} headingId="my-place-requests-heading" />
        <div className={styles.followList}>
          {latestPlaceRequests.map((request) => (
            <article key={request.id} className={styles.followListItem}>
              <MapPin size={15} />
              <div>
                <strong>{request.name}</strong>
                <span>{placeRequestStatusLabel(request.status)} · {request.address}</span>
              </div>
            </article>
          ))}
          {latestPlaceRequests.length === 0 && (
            <p className={styles.emptyText}>아직 요청한 장소가 없습니다. 요청은 주소·좌표 검토 전에는 공개되지 않습니다.</p>
          )}
        </div>
      </section>

      {qnaEnabled && <section
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
      </section>}

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
            <button key={tag} type="button" onClick={() => onSelectHashtag(tag)} aria-label={`#${tag} 최신 사진 다시 보기`}>
              <Hash size={13} />#{tag}
            </button>
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
        <div className={styles.blockedUserList} aria-label="차단한 사용자">
          <div className={styles.panelTitleRow}>
            <h3>차단한 사용자</h3>
            <span>{userBlocks.length}명</span>
          </div>
          {userBlocks.length > 0 ? userBlocks.map((block) => (
            <div className={styles.blockedUserRow} key={block.id}>
              <div>
                <strong>{block.label}</strong>
                <span>{minutesAgo(block.createdAt)} 차단</span>
              </div>
              <button type="button" onClick={() => void onUnblockUser(block.id)}>차단 해제</button>
            </div>
          )) : <p className={styles.emptyText}>차단한 사용자가 없습니다.</p>}
        </div>
      </section>

      <section
        ref={accountRef}
        className={`${styles.accountSection} ${activeMenuTarget === "account" ? styles.sectionFocus : ""}`}
        tabIndex={-1}
        aria-labelledby="account-data-heading"
      >
        <div>
          <p className={styles.eyebrow}>계정 및 데이터</p>
          <h3 id="account-data-heading">이 기기의 익명 활동 삭제</h3>
          <p>작성한 제보, 댓글, 사진과 차단 기록을 삭제합니다. 삭제 후에는 복구할 수 없습니다.</p>
        </div>
        <button
          className={styles.accountDeleteButton}
          type="button"
          disabled={!accountDeleteAvailable}
          onClick={() => setDeletionDialogOpen(true)}
        >
          계정 삭제
        </button>
        {!accountDeleteAvailable && <span>실시간 API가 연결된 운영 환경에서만 삭제할 수 있습니다.</span>}
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

      {deletionDialogOpen && (
        <div className={styles.flagModalOverlay} role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
          <section className={styles.flagModal} ref={deletionDialogRef}>
            <div className={styles.flagModalHeader}>
              <div>
                <p className={styles.eyebrow}>되돌릴 수 없는 작업</p>
                <h2 id="account-delete-title">익명 활동을 삭제할까요?</h2>
              </div>
              <button ref={deletionInitialFocusRef} type="button" onClick={closeDeletionDialog} aria-label="계정 삭제 닫기">
                <X size={16} />
              </button>
            </div>
            <p className={styles.flagModalHelp}>계속하려면 아래에 <strong>계정 삭제</strong>를 입력하세요.</p>
            <label className={styles.deletionConfirmationField}>
              확인 문구
              <input
                autoComplete="off"
                value={deletionConfirmation}
                onChange={(event) => setDeletionConfirmation(event.target.value)}
                placeholder="계정 삭제"
              />
            </label>
            <div className={styles.deletionActions}>
              <button type="button" onClick={closeDeletionDialog}>취소</button>
              <button
                type="button"
                disabled={deletionConfirmation !== "계정 삭제" || deletingAccount}
                onClick={() => void confirmAccountDeletion()}
              >
                {deletingAccount ? "삭제 중" : "영구 삭제"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function useModalFocus(active: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => initialFocusRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden"));
      const first = focusableElements[0];
      const last = focusableElements.at(-1);

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [active]);

  return { dialogRef, initialFocusRef };
}

function BottomNav({ activeView, onChange }: { activeView: View; onChange: (view: View) => void }) {
  return (
    <nav className={styles.bottomNav} aria-label="주요 화면">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activeView;
        return (
          <button
            key={item.id}
            aria-current={isActive ? "page" : undefined}
            className={`${styles.navButton} ${isActive ? styles.navActive : ""} ${item.id === "upload" ? styles.reportNav : ""}`}
            type="button"
            onClick={() => onChange(item.id)}
          >
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
  const { dialogRef, initialFocusRef } = useModalFocus(true, onClose);

  return (
    <div className={styles.onboardingOverlay} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className={styles.onboardingSheet} ref={dialogRef}>
        <button ref={initialFocusRef} className={styles.onboardingClose} type="button" onClick={onClose} aria-label="온보딩 닫기">
          <X size={16} />
        </button>
        <div>
          <span>처음 오셨나요?</span>
          <h2 id="onboarding-title">사진으로 지금 장소 분위기를 확인하세요.</h2>
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
  const { dialogRef, initialFocusRef } = useModalFocus(true, onClose);

  return (
    <div className={styles.flagModalOverlay} role="dialog" aria-modal="true" aria-label="신고 이유 선택">
      <section className={styles.flagModal} ref={dialogRef}>
        <div className={styles.flagModalHeader}>
          <div>
            <p className={styles.eyebrow}>신고 사유 선택</p>
            <h2>{title}</h2>
          </div>
          <button ref={initialFocusRef} type="button" onClick={onClose} aria-label="신고 닫기">
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

function LiveReportCard({
  focused = false,
  report,
  place,
  onOpen,
  onShare,
  onVote,
}: {
  focused?: boolean;
  report: Report;
  place: Place;
  onOpen?: () => void;
  onShare?: () => void;
  onVote?: (voteType: "agree" | "changed") => void;
}) {
  const safePhotoSourceUrl = safeHttpUrl(report.photoSourceUrl);

  return (
    <article
      className={`${styles.liveReportCard} ${focused ? styles.liveReportFocused : ""}`}
      data-report-id={report.id}
      tabIndex={-1}
      aria-current={focused ? "true" : undefined}
    >
      <button className={styles.liveReportOpen} type="button" onClick={onOpen} disabled={!onOpen}>
        <span className={[styles.reportPhoto, report.hasPhoto ? styles.reportPhotoImage : styles[report.tone]].join(" ")} style={photoBackgroundStyle(report.photoUrl)}>
          {report.hasPhoto ? <Camera size={18} /> : <Sparkles size={18} />}
        </span>
        <span className={styles.liveReportCopy}>
          <span className={[styles.statusChip, report.isSample ? styles.sampleStatusChip : styles[report.tone]].join(" ")}>{report.isSample ? "체험용 샘플" : report.verified ? "현장 인증" : "상태 제보"}</span>
          <strong>{place.name}</strong>
          <p>{report.body}</p>
          <time className={styles.reportTimestamp} dateTime={report.createdAt} title={formatFullDateTime(report.createdAt)}>
            {report.isSample ? "체험용 샘플 시각" : formatRecentTimestamp(report.createdAt)}
          </time>
          <small>{report.meta}</small>
        </span>
      </button>
      {report.photoAttribution && (
        safePhotoSourceUrl ? (
          <a className={styles.samplePhotoCredit} href={safePhotoSourceUrl} target="_blank" rel="noreferrer">
            사진 출처 · {report.photoAttribution}
          </a>
        ) : (
          <span className={styles.samplePhotoCredit}>사진 출처 · {report.photoAttribution}</span>
        )
      )}
      {(onVote || onShare) && (
        <div className={styles.reportVoteActions} aria-label="현장 제보 상태 확인">
          {onVote && <button type="button" onClick={() => onVote("agree")}><CheckCircle2 size={14} />맞아요</button>}
          {onVote && <button type="button" onClick={() => onVote("changed")}><AlertTriangle size={14} />지금은 달라요</button>}
          {onShare && <button type="button" onClick={onShare}><Share2 size={14} />공유</button>}
        </div>
      )}
    </article>
  );
}

function FeedPostCard({
  post,
  place,
  reports,
  onBlock,
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
  onBlock: () => void;
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
  const isSample = Boolean(post.isSample);
  const postEvidenceLabel = isSample ? "예시 화면" : "현장 제보";
  const verificationTooltip = isSample
    ? "체험용 샘플: 화면 확인용 예시이며 현재 방문 판단에는 반영되지 않습니다."
    : post.locationVerified
    ? "현장 인증: 실제 GPS와 장소 반경만 검증하고 정확한 좌표는 저장하지 않습니다."
    : "상태 제보: 위치 인증 없이 작성되어 판단에는 낮은 가중치로 반영됩니다.";
  const photoUrl = photoUrlForPost(post, reports ?? []);

  return (
    <article className={styles.feedPostCard}>
      <button className={styles.feedPhoto} style={photoBackgroundStyle(photoUrl)} type="button" onClick={onOpenPlace}>
        <span>{post.photoLabel}</span>
        <strong>{postEvidenceLabel}</strong>
      </button>
      <div className={styles.feedPostBody}>
        <div className={styles.feedPostHeader}>
          <button type="button" onClick={onOpenPlace}>
            <strong>{place.name}</strong>
            <span>{isSample ? "예시 데이터" : minutesAgo(post.createdAt)}</span>
          </button>
          <div className={styles.feedPostChips}>
            <span className={`${styles.statusChip} ${isSample ? styles.sampleStatusChip : styles.unknown}`}>{postEvidenceLabel}</span>
            <span className={`${styles.verificationChip} ${isSample ? styles.sampleStatusChip : post.locationVerified ? styles.verificationVerified : styles.verificationReport}`} title={verificationTooltip}>
              {isSample ? <ShieldAlert size={12} /> : post.locationVerified ? <BadgeCheck size={12} /> : <MapPin size={12} />}
              {isSample ? "체험용 샘플" : post.locationVerified ? "현장 인증" : "상태 제보"}
            </span>
          </div>
        </div>
        <p>{post.caption ?? `${place.name}의 현재 상태가 업데이트됐습니다.`}</p>
        <div className={styles.statusInline}>
          <span>{isSample ? "예시 사람" : "사람"} {crowdLabels[post.crowdLevel]}</span>
          <span>{isSample ? "예시 주차" : "주차"} {parkingLabels[post.parkingStatus]}</span>
          <span>{isSample ? "예시 줄" : "줄"} {lineLabels[post.lineStatus]}</span>
        </div>
        <div className={styles.feedHashtags}>
          {post.hashtagNames.slice(0, 3).map((tag) => (
            <button key={tag} type="button" onClick={() => onSelectHashtag(tag)}>#{tag}</button>
          ))}
        </div>
        <div className={styles.feedActions}>
          <button className={helpfulActive ? styles.feedActionActive : ""} type="button" onClick={onHelpful}>
            <Heart size={15} />도움돼요{isSample ? "" : ` ${post.helpfulCount}`}
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
            <button type="button" onClick={onBlock}><UserX size={15} />작성자 차단</button>
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
          <button
            key={option}
            className={value === option ? styles.choiceActive : ""}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}

function MultiChoiceGroup({
  title,
  options,
  values,
  onToggle,
}: {
  title: string;
  options: string[];
  values: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <section className={styles.choiceGroup}>
      <h3>{title}</h3>
      <div>
        {options.map((option) => (
          <button
            key={option}
            className={values.has(option) ? styles.choiceActive : ""}
            type="button"
            onClick={() => onToggle(option)}
            aria-pressed={values.has(option)}
          >
            {option}
          </button>
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

function visitDecisionLabel(status: CloudflarePlaceStatus["status"]) {
  if (status === "likely_good") return "방문하기 괜찮을 가능성이 높아요";
  if (status === "check_before_visit") return "출발 전 한 번 더 확인하세요";
  if (status === "likely_crowded") return "혼잡하거나 이용이 어려울 수 있어요";
  return "판단할 최신 정보가 부족해요";
}

function visitDecisionShortLabel(status: CloudflarePlaceStatus["status"]) {
  if (status === "likely_good") return "방문 무난";
  if (status === "check_before_visit") return "확인 필요";
  if (status === "likely_crowded") return "혼잡 가능";
  return "정보 부족";
}

function currentLivePlaceStatus(status: CloudflarePlaceStatus | undefined): CloudflarePlaceStatus | null {
  if (!status || status.dataMode !== "live") {
    return null;
  }

  const nowMs = Date.now();
  const hasExpiredSignal = status.currentSignals.some((signal) => {
    if (!signal.expiresAt) return true;
    const expiryMs = Date.parse(signal.expiresAt);
    return !Number.isFinite(expiryMs) || expiryMs <= nowMs;
  });
  return hasExpiredSignal ? null : status;
}

function placeWithV2Status(place: Place, status: CloudflarePlaceStatus | null | undefined, dataMode: DataMode): Place {
  if (dataMode !== "live") {
    return place;
  }

  const liveStatus = currentLivePlaceStatus(status ?? undefined);
  if (!liveStatus) {
    return {
      ...place,
      status: "정보 부족",
      signal: "정보 부족",
      summary: "현재 판단할 최신 관측 정보가 없습니다.",
      crowd: "정보 없음",
      parking: "정보 없음",
      line: "정보 없음",
      weather: "정보 없음",
      score: 0,
      tone: "unknown",
      visitors: "근거 없음",
      isSample: false,
    };
  }

  const confidenceScore = Math.round(Math.min(1, Math.max(0, liveStatus.confidenceScore)) * 100);
  return {
    ...place,
    status: visitDecisionShortLabel(liveStatus.status),
    signal: visitDecisionLabel(liveStatus.status),
    summary: placeStatusSummary(liveStatus),
    crowd: liveSignalForDimension(liveStatus, "crowd"),
    parking: liveSignalForDimension(liveStatus, "parking"),
    line: liveSignalForDimension(liveStatus, "queue"),
    weather: liveSignalForDimension(liveStatus, "weather"),
    updated: liveStatus.observedAt ? formatObservedAt(liveStatus.observedAt) : "관측시각 확인 필요",
    score: confidenceScore,
    tone: toneForVisitDecision(liveStatus.status),
    visitors: `근거 ${liveStatus.currentSignals.length}개`,
    isSample: false,
  };
}

function liveSignalForDimension(status: CloudflarePlaceStatus, dimension: CloudflarePlaceStatus["currentSignals"][number]["dimension"]): string {
  const signal = status.currentSignals.find((candidate) => candidate.dimension === dimension);
  return signal ? liveSignalValueLabel(signal.dimension, signal.valueCode) : "정보 없음";
}

function placeStatusSummary(status: CloudflarePlaceStatus): string {
  if (status.conflictingDimensions.length > 0) {
    return "출처 간 판단이 엇갈려 방문 전 확인이 필요합니다.";
  }

  if (status.missingRequiredDimensions.length > 0) {
    const missing = status.missingRequiredDimensions.slice(0, 2).map(liveSignalDimensionLabel).join("·");
    return `${missing} 최신 정보가 부족해 방문 판단을 보류합니다.`;
  }

  if (status.status === "likely_good") {
    return "현재 확인된 최신 근거가 방문 판단을 뒷받침합니다.";
  }
  if (status.status === "likely_crowded") {
    return "현재 확인된 최신 근거에서 혼잡 가능성이 높습니다.";
  }
  if (status.status === "check_before_visit") {
    return "출발 전 최신 현장 상태를 한 번 더 확인해 주세요.";
  }

  return "현재 판단할 최신 관측 정보가 없습니다.";
}

function toneForVisitDecision(status: CloudflarePlaceStatus["status"]): StatusTone {
  if (status === "likely_good") return "calm";
  if (status === "likely_crowded") return "danger";
  if (status === "check_before_visit") return "busy";
  return "unknown";
}

function liveSignalDimensionLabel(dimension: CloudflarePlaceStatus["currentSignals"][number]["dimension"]) {
  const labels: Record<CloudflarePlaceStatus["currentSignals"][number]["dimension"], string> = {
    weather: "날씨",
    local_condition: "현장 상태",
    crowd: "인파",
    queue: "대기",
    parking: "주차",
    road_traffic: "주변 도로",
    entry: "입장",
    business_status: "운영",
    stream: "라이브 영상",
  };
  return labels[dimension];
}

function liveSignalValueLabel(
  dimension: CloudflarePlaceStatus["currentSignals"][number]["dimension"],
  valueCode: string,
) {
  const labels: Record<string, string> = {
    clear: "맑음",
    calm: "안정",
    rain: "비",
    snow: "눈",
    windy: "강풍 주의",
    storm: "악천후",
    quiet: "여유",
    normal: "보통",
    busy: "혼잡",
    packed: "매우 혼잡",
    none: "없음",
    under_10: "10분 이하",
    "10_to_30": "10~30분",
    "30_to_60": "30~60분",
    "60_plus": "60분 이상",
    available: "여유",
    limited: "일부 남음",
    almost_full: "거의 만차",
    full: "만차",
    closed: "폐쇄",
    strong_wind: "강풍",
    slippery: "노면 미끄러움",
    entry_restricted: "입장 제한",
    event: "행사 진행",
    temporary_closed: "임시 휴무로 보임",
    smooth: "원활",
    slow: "서행",
    congested: "혼잡",
    blocked: "통제",
    restricted: "제한",
    open: "운영 중",
    healthy: "정상",
    down: "연결 안 됨",
  };
  return labels[valueCode] ?? `${liveSignalDimensionLabel(dimension)} 정보`;
}

function liveSignalSourceLabel(sourceType: string) {
  if (sourceType === "official_live" || sourceType === "official_periodic" || sourceType === "official_static") return "공식 데이터";
  if (sourceType === "venue_operator") return "운영자 확인";
  if (sourceType === "verified_ugc") return "현장 인증 제보";
  if (sourceType === "ugc") return "사용자 제보";
  if (sourceType === "consensus") return "복수 제보 종합";
  return "예상 정보";
}

function formatObservedAt(value: string) {
  return Number.isFinite(Date.parse(value)) ? `${minutesAgo(value)} 관측` : "관측시각 확인 필요";
}

function formatConfidence(value: number) {
  return `신뢰도 ${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function formatExpiryHint(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "만료시각 확인 필요";
  }

  const remainingMinutes = Math.ceil((Date.parse(value) - Date.now()) / 60_000);
  if (remainingMinutes <= 0) {
    return "만료됨";
  }

  return remainingMinutes >= 60 ? `${Math.ceil(remainingMinutes / 60)}시간 내 만료` : `${remainingMinutes}분 내 만료`;
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

  if (status === "low_accuracy") {
    return {
      title: "정확도가 낮아 상태 제보로 등록",
      body: "현장 인증 배지는 붙이지 않습니다. 다시 측정하면 인증을 다시 시도할 수 있습니다.",
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

function nextTabIndex(event: ReactKeyboardEvent<HTMLElement>, currentIndex: number, tabCount: number): number | null {
  if (tabCount <= 0) {
    return null;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    return (currentIndex + 1) % tabCount;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    return (currentIndex - 1 + tabCount) % tabCount;
  }
  if (event.key === "Home") {
    return 0;
  }
  if (event.key === "End") {
    return tabCount - 1;
  }
  return null;
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

function mapPlaces(apiPlaces: ApiPlaceInput[], reports: Report[]): Place[] {
  return apiPlaces.map((place, index) => {
    const latestReports = reports.filter((report) => report.placeId === place.id && !report.hiddenAt);
    const currentReports = latestReports.filter((report) => !report.isSample);
    const latest = currentReports[0];
    const latestSample = latestReports.find((report) => report.isSample);
    const presentation = presentationByPlaceId[place.id] ?? {
      x: 30 + index * 12,
      y: 40 + index * 8,
    };
    const reportCount = currentReports.length;
    return {
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      region: place.region,
      distance: "선택 지역 기준",
      status: "정보 없음",
      signal: "정보 부족",
      summary: latest?.body ?? latestSample?.body ?? "현재 판단할 최신 관측 정보가 없습니다.",
      crowd: "정보 없음",
      parking: "정보 없음",
      line: "정보 없음",
      weather: "정보 없음",
      crowdLevel: "normal",
      parkingStatus: "unknown",
      lineStatus: "none",
      weatherFeel: "good",
      updated: latest?.meta.split(" · ")[0] ?? "정보 대기",
      score: 0,
      x: presentation.x,
      y: presentation.y,
      tone: "unknown",
      visitors: reportCount > 0 ? `${reportCount}건` : latestSample ? "체험용 샘플" : "정보 없음",
      isSample: !latest && Boolean(latestSample),
    };
  });
}

function sortPlacesByLocation(places: Place[], location: Pick<ClientLocation, "latitude" | "longitude"> | null): Place[] {
  const withDistance = places.map((place) => ({
    ...place,
    distance: location
      ? formatDistanceMeters(
          haversineDistanceMeters(location, {
            latitude: place.latitude,
            longitude: place.longitude,
          }),
        )
      : "선택 지역 기준",
  }));

  if (!location) {
    return withDistance;
  }

  return withDistance.sort((left, right) => {
    const distanceDifference = distanceKmFromLabel(left.distance) - distanceKmFromLabel(right.distance);
    if (distanceDifference !== 0) {
      return distanceDifference;
    }

    const scoreDifference = right.score - left.score;
    return scoreDifference !== 0 ? scoreDifference : left.name.localeCompare(right.name, "ko");
  });
}

function mapReports(reports: PublicReport[], apiPlaces: ApiPlace[]): Report[] {
  return [...reports]
    .filter((report) => !report.hiddenAt)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((report) => {
      const place = apiPlaces.find((candidate) => candidate.id === report.placeId);
      const tone = reportToneFromObservation(report.crowdLevel, report.parkingStatus);
      const photoIds = report.photoIds ?? [];
      const hashtagNames = report.hashtagNames ?? [];
      const hasPhoto = Boolean(report.photoUrl) || photoIds.length > 0;

      return {
        id: report.id,
        placeId: report.placeId,
        title: place?.name ?? "지금컷",
        body: report.comment ?? reportObservationSummary(report),
        meta: report.isSample
          ? `체험용 샘플 · 운영 판단 제외 · ${hasPhoto ? "사진 있음" : "사진 없음"}`
          : `${minutesAgo(report.createdAt)} · 사용자 제보 · ${report.verifiedRadiusM ? "현장 인증" : "미인증"} · ${hasPhoto ? "사진 있음" : "사진 없음"}`,
        tone,
        verified: Boolean(report.verifiedRadiusM),
        hasPhoto,
        photoUrl: report.photoUrl,
        photoAttribution: report.photoAttribution,
        photoSourceUrl: report.photoSourceUrl,
        isSample: report.isSample,
        createdAt: report.createdAt,
        hiddenAt: report.hiddenAt ?? null,
        moderationStatus: report.moderationStatus ?? "approved",
        crowdLevel: report.crowdLevel,
        lineStatus: report.lineStatus,
        parkingStatus: report.parkingStatus,
        weatherFeel: report.weatherFeel,
        photoIds,
        hashtagNames,
      } satisfies Report;
    });
}

function reportObservationSummary(report: PublicReport) {
  const summaries = new Set<string>();
  const observationLabels: Record<string, Record<string, string>> = {
    crowd: {
      quiet: "인파 여유",
      normal: "인파 보통",
      busy: "인파 혼잡",
      packed: "인파 매우 혼잡",
    },
    queue: {
      none: "대기 없음",
      under_10: "대기 10분 이하",
      "10_to_30": "대기 10~30분",
      "30_to_60": "대기 30~60분",
      "60_plus": "대기 60분 이상",
    },
    parking: {
      available: "주차 여유",
      limited: "주차 일부 남음",
      almost_full: "주차 거의 만차",
      full: "주차 만차",
      closed: "주차장 폐쇄",
    },
    local_condition: {
      rain: "비",
      snow: "눈",
      strong_wind: "강풍",
      slippery: "노면 미끄러움",
      entry_restricted: "입장 제한",
      event: "행사 진행",
      temporary_closed: "임시 휴무로 보임",
    },
  };

  for (const observation of report.observations ?? []) {
    const label = observationLabels[observation.dimension]?.[observation.valueCode];
    if (label) summaries.add(label);
  }

  if (report.crowdLevel) summaries.add(`인파 ${crowdLabels[report.crowdLevel]}`);
  if (report.lineStatus) summaries.add(`대기 ${lineLabels[report.lineStatus]}`);
  if (report.parkingStatus && report.parkingStatus !== "unknown") {
    summaries.add(`주차 ${parkingLabels[report.parkingStatus]}`);
  }
  if (report.weatherFeel) summaries.add(`날씨 ${weatherLabels[report.weatherFeel]}`);

  const localConditionLabels: Record<string, string> = {
    rain: "비",
    snow: "눈",
    strong_wind: "강풍",
    slippery: "노면 미끄러움",
    entry_restricted: "입장 제한",
    event: "행사 진행",
    temporary_closed: "임시 휴무로 보임",
  };
  for (const condition of report.localConditions ?? []) {
    const label = localConditionLabels[condition];
    if (label) summaries.add(label);
  }

  return summaries.size > 0 ? [...summaries].join(" · ") : "관측한 항목만 등록된 현장 제보입니다.";
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

function isSafeDeepLinkId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value);
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
  const postIds = new Set(posts.map((post) => post.id));
  const postComments = posts
    .filter((post) => post.caption)
    .map((post) => {
      const isSample = Boolean(post.isSample) || post.id.startsWith("post_seed_") || post.id.startsWith("fallback_");

      return {
        id: `post:${post.id}`,
        author: isSample ? "체험용 샘플" : post.creatorName,
        body: post.caption ?? "",
        meta: isSample ? "체험용 샘플 · 운영 판단 제외" : `${minutesAgo(post.createdAt)} · 도움 ${post.helpfulCount}`,
        verified: isSample ? false : post.locationVerified,
      };
    });
  const reportComments = reports.filter((report) => !postIds.has(report.id)).map((report) => ({
    id: `report:${report.id}`,
    author: report.isSample ? "체험용 샘플" : report.verified ? "현장 인증 제보자" : "상태 제보자",
    body: report.body,
    meta: report.meta,
    verified: report.isSample ? false : report.verified,
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
    ownedByCurrentSession: comment.ownedByCurrentSession,
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
  const reportById = new Map(reports.map((report) => [report.id, report]));
  const postIds = new Set(posts.map((post) => post.id));
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
      meta: post.isSample ? "체험용 샘플 · 운영 판단 제외" : `${minutesAgo(post.createdAt)} · ${post.creatorBadge}`,
      previewUrl: post.previewUrl ?? reportById.get(post.id)?.photoUrl ?? undefined,
    }));
  const reportPhotos = reports
    .filter((report) => report.hasPhoto && !postIds.has(report.id))
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
  const safePhotoUrl = safeHttpUrl(photoUrl);
  if (!safePhotoUrl) {
    return undefined;
  }

  return { "--photo-url": `url(${JSON.stringify(safePhotoUrl)})` };
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
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

async function fetchWorkerCommentsForPlaces(placeIds: string[]): Promise<Record<string, PlaceComment[]>> {
  const scopedPlaceIds = [...new Set(placeIds.filter(Boolean))].slice(0, workerPhotoPlaceScopeLimit);
  const entries = await Promise.all(
    scopedPlaceIds.map(async (placeId) => {
      const comments = await fetchJson<WorkerComment[]>(
        cloudflareApiUrl(buildScopedApiPath("/api/comments", { placeId, limit: 20 })),
      ).catch(() => []);

      return [placeId, comments.map(workerCommentToPlaceComment)] as const;
    }),
  );

  return Object.fromEntries(entries);
}

async function fetchWorkerStatusesForPlaces(placeIds: string[]): Promise<Record<string, CloudflarePlaceStatus>> {
  const scopedPlaceIds = [...new Set(placeIds.filter(Boolean))].slice(0, 5);
  const entries = await Promise.all(
    scopedPlaceIds.map(async (placeId) => {
      const status = await fetchJsonWithTimeout<CloudflarePlaceStatus>(
        cloudflareApiUrl(`/api/places/${encodeURIComponent(placeId)}/status`),
      ).catch(() => null);

      return status ? ([placeId, status] as const) : null;
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, CloudflarePlaceStatus] => Boolean(entry)));
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

  if (distance.trim().toLowerCase().endsWith("m")) {
    return Number.isFinite(value) ? value / 1_000 : Number.POSITIVE_INFINITY;
  }

  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function minutesAgo(createdAt: string) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return "시간 확인 필요";
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs < -FUTURE_TIMESTAMP_TOLERANCE_MS) {
    return "시각 확인 필요";
  }
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes >= 24 * 60) {
    return `${Math.round(diffMinutes / (24 * 60))}일 전`;
  }

  if (diffMinutes >= 60) {
    return `${Math.round(diffMinutes / 60)}시간 전`;
  }

  return `${diffMinutes}분 전`;
}

function formatRecentTimestamp(value: string) {
  return Number.isFinite(Date.parse(value)) ? minutesAgo(value) : "게시 시각 확인 필요";
}

function formatFullDateTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "게시 시각 확인 필요";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function reportToneFromObservation(crowdLevel?: CrowdLevel, parkingStatus?: ParkingStatus): StatusTone {
  if (crowdLevel === "packed" || parkingStatus === "full") {
    return "danger";
  }

  if (crowdLevel === "busy" || parkingStatus === "limited") {
    return "busy";
  }

  if (crowdLevel === "quiet") {
    return "calm";
  }

  if (crowdLevel === "normal" || parkingStatus === "available") {
    return "normal";
  }

  return "unknown";
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

async function hashPushToken(token: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle || !globalThis.TextEncoder) {
    return null;
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function crowdValueFromLabel(label: string): CrowdLevel | undefined {
  if (label === "여유") return "quiet";
  if (label === "보통") return "normal";
  if (label === "혼잡") return "busy";
  if (label === "매우 혼잡") return "packed";
  return undefined;
}

function queueValueFromLabel(label: string): "none" | "under_10" | "10_to_30" | "30_to_60" | "60_plus" | undefined {
  if (label === "없음") return "none";
  if (label === "10분 이하") return "under_10";
  if (label === "10~30분") return "10_to_30";
  if (label === "30~60분") return "30_to_60";
  if (label === "60분 이상") return "60_plus";
  return undefined;
}

function parkingObservationFromLabel(label: string): "available" | "limited" | "almost_full" | "full" | "closed" | undefined {
  if (label === "여유") return "available";
  if (label === "일부 남음") return "limited";
  if (label === "거의 만차") return "almost_full";
  if (label === "만차") return "full";
  if (label === "폐쇄") return "closed";
  return undefined;
}

function localConditionValueFromLabel(label: string): string | undefined {
  const values: Record<string, string> = {
    비: "rain",
    눈: "snow",
    강풍: "strong_wind",
    "노면 미끄러움": "slippery",
    "입장 제한": "entry_restricted",
    "행사 진행": "event",
    "임시 휴무로 보임": "temporary_closed",
  };
  return values[label];
}

function toggleLocalCondition(current: Set<string>, condition: string): Set<string> {
  if (condition === "확인하지 못함") {
    return new Set([condition]);
  }

  const next = new Set(current);
  next.delete("확인하지 못함");
  if (next.has(condition)) {
    next.delete(condition);
  } else {
    next.add(condition);
  }
  return next;
}

function questionTypeFromText(text: string): QuestionType {
  if (text.includes("사진")) return "photo_request";
  if (text.includes("주차")) return "parking";
  if (text.includes("줄") || text.includes("대기") || text.includes("웨이팅")) return "line";
  if (text.includes("날씨") || text.includes("비")) return "weather";
  if (text.includes("사람") || text.includes("혼잡")) return "crowd";
  return "other";
}

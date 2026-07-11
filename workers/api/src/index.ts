import {
  type ApiResponse,
  type BBox,
  type LikePolicyState,
  type PlaceRecord,
  type RankingRecord,
  type RateLimitState,
  PHOTO_MAX_BYTES,
  MAX_REGION_RANKING_LIMIT,
  applySlidingWindowRateLimit,
  clampLimit,
  filterPlacesByBBox,
  filterPlacesByRadius,
  intersectBBoxes,
  distanceMeters,
  parseBBox,
  parseRadiusSearch,
  rankRegionPlaces,
  registerUniqueCommentLike,
  registerUniquePlaceLike,
  registerUniquePhotoClick,
  unregisterUniquePlaceLike,
  validatePhotoComplete,
} from "./policies.ts";
import {
  DEFAULT_FEATURE_FLAGS,
  INITIAL_DIMENSION_SETTINGS,
  aggregatePlaceSignals,
  featureFlagKeys,
  isLiveSignalCurrent,
  listObservedReportSignals,
  resolveFeatureFlag,
  resolveSignalExpiry,
  type FeatureFlagKey,
  type FeatureFlagValue,
  type AggregatedPlaceStatus,
  type DecisionProfile,
  type LiveSignal,
  type LiveSignalDimension,
} from "../../../packages/contracts/src/index.ts";
import { PublicDataGateway, PublicDataGatewayError } from "./public-data/gateway.ts";
import { createKmaWeatherAdapter } from "./public-data/kma-weather-adapter.ts";
import { createTourApiAdapter } from "./public-data/tour-api-adapter.ts";
import { createNationalParkingAdapter } from "./public-data/national-parking-adapter.ts";
import { createNationalTrafficAdapter } from "./public-data/national-traffic-adapter.ts";
import { createNationalCctvAdapter } from "./public-data/national-cctv-adapter.ts";

declare const WebSocketPair: {
  new (): WebSocketPairResult;
};

type WebSocketPairResult = {
  0: WorkerWebSocket;
  1: WorkerWebSocket;
};

type ExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type WorkerResponseInit = ResponseInit & {
  webSocket?: WorkerWebSocket;
};

type WorkerWebSocket = {
  accept: () => void;
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: "message" | "close" | "error", listener: (event: WebSocketMessageEvent) => void) => void;
  readyState: number;
};

type WebSocketMessageEvent = {
  data: string | ArrayBuffer;
};

type DurableObjectNamespace = {
  idFromName: (name: string) => DurableObjectId;
  get: (id: DurableObjectId) => DurableObjectStub;
};

type DurableObjectId = {
  toString: () => string;
};

type DurableObjectStub = {
  fetch: (request: Request) => Promise<Response>;
};

type R2Bucket = {
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectBody | null>;
  delete: (key: string | string[]) => Promise<void>;
};

type R2ObjectBody = {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
  };
};

type ImagesBinding = {
  input: (source: ReadableStream | ArrayBuffer) => ImagesPipeline;
};

type ImagesPipeline = {
  transform: (options: ImagesTransformOptions) => ImagesPipeline;
  output: (options: ImagesOutputOptions) => Promise<ImagesOutput> | ImagesOutput;
};

type ImagesTransformOptions = {
  width: number;
  height: number;
  fit: "scale-down";
};

type ImagesOutputOptions = {
  format: "image/webp" | "image/jpeg";
  quality: number;
  anim: false;
};

type ImagesOutput = {
  response: () => Promise<Response> | Response;
};

type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type Env = {
  DB?: D1Database;
  PHOTOS?: R2Bucket;
  IMAGES?: ImagesBinding;
  CACHE?: KVNamespace;
  PLACE_ROOM?: DurableObjectNamespace;
  REGION_ROOM?: DurableObjectNamespace;
  GLOBAL_ROOM?: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  ADMIN_TOKENS?: string;
  MODERATION_ALERT_WEBHOOK_URL?: string;
  MODERATION_ALERT_WEBHOOK_TOKEN?: string;
  KMA_SERVICE_KEY?: string;
  TOUR_API_SERVICE_KEY?: string;
  NATIONAL_PARKING_SERVICE_KEY?: string;
  NATIONAL_PARKING_ENDPOINT_URL?: string;
  ITS_SERVICE_KEY?: string;
  MEMBER_LINK_HMAC_SECRET?: string;
  ENVIRONMENT?: string;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type D1PreparedStatement = {
  bind: (...values: D1Value[]) => D1PreparedStatement;
  all: <TRecord>() => Promise<{ results?: TRecord[] }>;
  first: <TRecord>() => Promise<TRecord | null>;
  run: () => Promise<unknown>;
};

type D1Value = string | number | null;

type D1FeatureFlagRow = {
  flagKey: FeatureFlagKey;
  enabled: number;
  scopeType: FeatureFlagValue["scopeType"];
  scopeKey: string;
};

type D1DimensionSettingRow = {
  settingKey: string;
  dimension: string | null;
  defaultTtlSeconds: number;
  currentEligible: number;
};

type D1DataSourceRow = {
  id: string;
  sourceKey: string;
  sourceName: string;
  providerName: string;
  sourceType: LiveSignal["sourceType"];
  documentationUrl: string | null;
  termsUrl: string | null;
  attributionText: string | null;
  commercialUseStatus: "pending" | "allowed" | "allowed_with_attribution" | "agreement_required" | "prohibited" | "unknown";
  agreementRequired: number;
  refreshIntervalSeconds: number | null;
  defaultTtlSeconds: number | null;
  enabled: number;
  enabledRegionsJson: string;
  lastTermsCheckedAt: string | null;
  lastHealthCheckedAt: string | null;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
};

type D1SourceHealthLogRow = {
  id: string;
  sourceId: string;
  sourceKey: string;
  status: "healthy" | "degraded" | "down";
  message: string | null;
  responseTimeMs: number | null;
  checkedAt: string;
};

type D1OperationalSourceRow = Pick<
  D1DataSourceRow,
  "id" | "sourceKey" | "sourceName" | "sourceType" | "commercialUseStatus" | "enabled" | "healthStatus" | "defaultTtlSeconds"
>;

type D1DecisionProfileDimensionRow = {
  profileId: string;
  profileKey: string;
  dimension: LiveSignalDimension;
  required: number;
  importance: "critical" | "important" | "supporting";
  positiveValueCodesJson: string;
  negativeValueCodesJson: string;
};

type D1LiveSignalRow = {
  id: string;
  placeId: string;
  dimension: LiveSignalDimension;
  valueCode: string;
  valueNumber: number | null;
  valueText: string | null;
  unit: string | null;
  sourceId: string;
  sourceType: LiveSignal["sourceType"];
  sourceName: string;
  attributionText: string | null;
  observedAt: string;
  fetchedAt: string;
  expiresAt: string | null;
  confidenceScore: number;
  isEstimated: number;
  evidenceType: LiveSignal["evidenceType"] | null;
  evidenceId: string | null;
  actorId: string | null;
};

type PublicLiveSignal = Pick<
  LiveSignal,
  | "id"
  | "placeId"
  | "dimension"
  | "valueCode"
  | "valueNumber"
  | "valueText"
  | "unit"
  | "sourceId"
  | "sourceType"
  | "sourceName"
  | "attributionText"
  | "observedAt"
  | "fetchedAt"
  | "expiresAt"
  | "confidenceScore"
  | "isEstimated"
  | "evidenceType"
> & {
  isExpired: false;
};

type PlaceStatusData = {
  contractVersion: 2;
  placeId: string;
  dataMode: "live" | "demo";
  status: AggregatedPlaceStatus["status"];
  currentSignals: PublicLiveSignal[];
  missingRequiredDimensions: LiveSignalDimension[];
  conflictingDimensions: LiveSignalDimension[];
  independentSourceCount: number;
  confidenceScore: number;
  reasonCodes: string[];
  observedAt: string | null;
  computedAt: string;
};

type D1PlaceRow = {
  id: string;
  name: string;
  categoryId: string;
  areaId: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number | null;
  status: PlaceRecord["status"];
  coordinateStatus: "verified";
};

type RankingCounts = {
  clickCount: number;
  likeCount: number;
  commentCount: number;
  photoCount: number;
  reportCount: number;
  uniqueUserCount: number;
};

type D1CommentRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  body: string;
  likeCount: number;
  hiddenAt: string | null;
  createdAt: string;
};

type D1PhotoRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  storageKey: string;
  mimeType: PhotoRecord["mimeType"];
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: PhotoRecord["status"];
  deletedAt: string | null;
  createdAt: string;
};

type D1ReportRow = {
  id: string;
  targetType: ReportRecord["targetType"];
  targetId: string;
  reason: ReportRecord["reason"];
  anonymousUserId: string;
  note: string | null;
  status: ReportRecord["status"];
  createdAt: string;
};

type D1FieldReportEventRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  verifiedRadiusM: FieldReportRecord["verifiedRadiusM"];
  expiresAt: string | null;
};

type D1CountRow = {
  count: number;
};

type AdminModerationAction = "hide" | "restore" | "delete";
type AdminBulkModerationAction = Exclude<AdminModerationAction, "delete">;
type AdminActionType =
  | AdminModerationAction
  | `bulk_${AdminBulkModerationAction}`
  | `report_${ReportRecord["status"]}`
  | "photo_approved"
  | "photo_rejected"
  | "place_coordinate_status"
  | "user_restrict"
  | "user_unrestrict"
  | "source_policy_updated";
type AdminRole = "operator" | "moderator" | "admin";

type AdminCredential = {
  role: AdminRole;
  token: string;
  source: "ADMIN_TOKEN" | "ADMIN_TOKENS";
};

type D1ModerationTarget = {
  exists: boolean;
  storageKey: string | null;
  placeId: string | null;
  regionId: string | null;
};

type CacheInvalidationResult = {
  binding: "CACHE" | "none";
  keys: string[];
  deletedKeys: string[];
};

type JsonObject = Record<string, unknown>;

type RankingCacheEntry = {
  data: RankingRecord[];
  meta: Record<string, unknown>;
};

type RankingRoute = {
  kind: "generic" | "global" | "region" | "area" | "category";
  regionId: string | null;
  areaId: string | null;
  categoryId: string | null;
};

type AdminBulkModerationTarget = {
  targetType: ReportRecord["targetType"];
  targetId: string;
};

type AdminBulkModerationResult = AdminBulkModerationTarget & {
  status: "ok" | "not_found";
};

type D1BlockedUserRow = {
  reason: string;
  blockedUntil: string | null;
};

type ModerationAlertPayload = {
  type: "moderation.report.created";
  reportId: string;
  targetType: ReportRecord["targetType"];
  targetId: string;
  reason: ReportRecord["reason"];
  priority: "normal" | "high" | "urgent";
  queuePath: string;
  environment: string;
  createdAt: string;
};

type AnonymousSession = {
  id: string;
  isNew: boolean;
};

type CommentRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  body: string;
  likeCount: number;
  hiddenAt: string | null;
  createdAt: string;
};

type PublicCommentRecord = Omit<CommentRecord, "anonymousUserId"> & {
  ownedByCurrentSession: boolean;
};

type PhotoRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: "pending" | "ready" | "rejected";
  deletedAt: string | null;
  createdAt: string;
};

type PublicPhotoRecord = Pick<
  PhotoRecord,
  "id" | "placeId" | "mimeType" | "byteSize" | "width" | "height" | "clickCount" | "status" | "createdAt"
> & {
  ownedByCurrentSession: boolean;
  previewUrl: string | null;
};

type DuplicatePhotoRecord = {
  id: string;
  placeId: string;
};

type SanitizedPhoto = {
  bytes: Uint8Array;
  mimeType: PhotoRecord["mimeType"];
  originalBytes: number;
  sanitizedBytes: number;
  metadataRemoved: boolean;
  pixelsReencoded: boolean;
  processing: "worker-metadata-stripped" | "cloudflare-images-reencoded";
};

type ReportRecord = {
  id: string;
  targetType: "place" | "post" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  anonymousUserId: string;
  note: string | null;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
};

type CrowdLevel = "quiet" | "normal" | "busy" | "packed";
type LineStatus = "none" | "short" | "medium" | "long";
type ParkingStatus = "available" | "limited" | "full" | "unknown";
type WeatherFeel = "good" | "rainy" | "windy" | "hot" | "cold";
type LocalCondition = "rain" | "snow" | "strong_wind" | "slippery" | "entry_restricted" | "event" | "temporary_closed";
type FieldReportObservation = {
  dimension: "crowd" | "queue" | "parking" | "local_condition";
  valueCode: string;
  expiresAt: string;
};

type FieldReportRecord = {
  id: string;
  placeId: string;
  category: "tourism" | "festival" | "restaurant_cafe" | "hospital" | "public_office" | "parking";
  crowdLevel?: CrowdLevel;
  lineStatus?: LineStatus;
  parkingStatus?: ParkingStatus;
  weatherFeel?: WeatherFeel;
  localConditions: LocalCondition[];
  observations: FieldReportObservation[];
  anonymousUserId: string;
  verifiedRadiusM: 50 | 150 | 300 | null;
  createdAt: string;
  expiresAt: string;
  hasPhoto: boolean;
};

type PostRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  creatorName: string;
  creatorBadge: string;
  caption: string | null;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  locationVerified: boolean;
  verifiedRadiusM: FieldReportRecord["verifiedRadiusM"];
  photoCount: number;
  photoLabel: string;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  hiddenAt: string | null;
  createdAt: string;
};

type D1PostRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  creatorName: string;
  creatorBadge: string;
  caption: string | null;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  locationVerified: number;
  verifiedRadiusM: FieldReportRecord["verifiedRadiusM"];
  photoCount: number;
  photoLabel: string;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string;
  hiddenAt: string | null;
  createdAt: string;
};

type QuestionType = "crowd" | "line" | "parking" | "weather" | "photo_request" | "other";

type QuestionRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  questionType: QuestionType;
  body: string;
  creditCost: 1 | 2;
  answeredReportId: string | null;
  status: "pending" | "answered" | "expired";
  createdAt: string;
};

type D1QuestionRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  questionType: QuestionType;
  body: string;
  creditCost: 1 | 2;
  answeredReportId: string | null;
  status: QuestionRecord["status"];
  createdAt: string;
};

type HashtagRecord = {
  id: string;
  name: string;
  tagType: "place" | "status" | "purpose" | "time" | "region";
  postCount: number;
  createdAt: string;
};

type ShareCardRecord = {
  headline: string;
  body: string;
  url: string;
  hashtags: string[];
  variant: "avoid" | "good" | "parking_full" | "waiting" | "photo_spot";
};

type ClientLocation = {
  latitude: number;
  longitude: number;
};

type FieldReportCredit = {
  type: "verified_report" | "photo_report";
  amount: 1;
};

type D1FieldReportRow = {
  id: string;
  placeId: string;
  category: FieldReportRecord["category"];
  crowdLevel: CrowdLevel | null;
  lineStatus: LineStatus | null;
  parkingStatus: ParkingStatus | null;
  verifiedRadiusM: FieldReportRecord["verifiedRadiusM"];
  createdAt: string;
  expiresAt: string;
};

type PublicFieldReportRecord = Omit<FieldReportRecord, "anonymousUserId" | "hasPhoto">;

type PlaceEventSource = "worker_api" | "field_report" | "detail" | "map_marker" | "ranking" | "search_result";
type PlaceClickSource = Exclude<PlaceEventSource, "field_report">;

type D1PlaceEventOptions = {
  id?: string;
  source?: PlaceEventSource;
  crowdLevel?: CrowdLevel | null;
  lineStatus?: LineStatus | null;
  parkingStatus?: ParkingStatus | null;
  verifiedRadiusM?: FieldReportRecord["verifiedRadiusM"];
  createdAt?: string;
  expiresAt?: string;
};

type RoomBroadcast = {
  type: "place.liked" | "comment.created" | "photo.ready" | "report.created" | "heartbeat";
  scope: "place" | "region" | "global";
  roomId: string;
  payload: JsonObject;
  createdAt: string;
};

const seedPlaces: PlaceRecord[] = [
  {
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    categoryId: "tourism",
    areaId: "busan-suyeong",
    regionId: "busan",
    latitude: 35.1532,
    longitude: 129.1186,
    score: 98,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "ulsan-taehwagang",
    name: "태화강 국가정원",
    categoryId: "tourism",
    areaId: "ulsan-jung",
    regionId: "ulsan",
    latitude: 35.5486,
    longitude: 129.3005,
    score: 84,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "gyeongju-hwangridan",
    name: "황리단길",
    categoryId: "restaurant_cafe",
    areaId: "gyeongju-hwango",
    regionId: "gyeongju",
    latitude: 35.8382,
    longitude: 129.2098,
    score: 91,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "seoul-yeouido",
    name: "여의도 한강공원",
    categoryId: "tourism",
    areaId: "seoul-yeongdeungpo",
    regionId: "seoul",
    latitude: 37.5265,
    longitude: 126.9349,
    score: 88,
    status: "beta",
    coordinateStatus: "verified",
  },
];

const posts: PostRecord[] = [
  seedPost({
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
  seedPost({
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
  seedPost({
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
  seedPost({
    id: "post_seed_yeouido_picnic",
    placeId: "seoul-yeouido",
    creatorName: "서울 한강러",
    creatorBadge: "전국 베타 현장 제보",
    caption: "잔디 쪽은 여유 있지만 편의점 앞은 줄이 조금 생겼습니다.",
    crowdLevel: "normal",
    parkingStatus: "limited",
    lineStatus: "short",
    weatherFeel: "good",
    photoCount: 1,
    photoLabel: "여의도 한강공원 피크닉 구역",
    helpfulCount: 16,
    commentCount: 3,
    hashtagNames: ["여의도한강공원지금", "서울", "한강피크닉", "줄짧음", "지금"],
    minutesAgo: 19,
  }),
];

const questions: QuestionRecord[] = [
  seedQuestion({
    id: "question_seed_gwangalli",
    placeId: "busan-gwangalli",
    questionType: "parking",
    body: "센텀 쪽으로 대면 걸어갈 만한가요?",
    minutesAgo: 7,
  }),
  seedQuestion({
    id: "question_seed_hwangridan",
    placeId: "gyeongju-hwangridan",
    questionType: "line",
    body: "황리단길 카페 웨이팅 지금도 긴가요?",
    minutesAgo: 18,
  }),
  seedQuestion({
    id: "question_seed_yeouido",
    placeId: "seoul-yeouido",
    questionType: "crowd",
    body: "여의도 잔디밭 지금 자리 잡을 수 있나요?",
    minutesAgo: 11,
  }),
];

const comments: CommentRecord[] = [];
const photos: PhotoRecord[] = [];
const reports: ReportRecord[] = [];
const fieldReports: FieldReportRecord[] = [];
const liveSignals: LiveSignal[] = [];
const rateBuckets = new Map<string, RateLimitState>();
const likeStateByAnon = new Map<string, LikePolicyState>();
const placeLikeCounts = new Map<string, number>();
const placeClickCounts = new Map<string, number>();
const placeClickWindowsByAnon = new Map<string, Map<string, number>>();
const roomEvents = new Map<string, RoomBroadcast[]>();
const photoContentHashes = new Map<string, string>();
const commentCreateMinuteLimit = 5;
const commentCreateDailyLimit = 100;
const commentBodyMaxLength = 280;
const commentBodyMinLength = 2;
const oneMinuteMs = 60_000;
const oneDayMs = 24 * 60 * 60_000;
const reportChangedVoteThreshold = 3;
const identityLinkMaxClockSkewMs = 5 * 60_000;
const adminRoles = ["operator", "moderator", "admin"] as const;
const adminRoleRank: Record<AdminRole, number> = {
  operator: 1,
  moderator: 2,
  admin: 3,
};
const REPORT_TTL_MS = 3 * 60 * 60 * 1000;
const RANKING_CACHE_TTL_SECONDS = 60;
const RANKING_CACHE_VERSION_KEY = "rankings:version";
const DEFAULT_RANKING_CACHE_VERSION = "initial";
const D1_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const D1_ACTIVE_CONTENT_CUTOFF_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')";
const fieldReportCategories = ["tourism", "festival", "restaurant_cafe", "hospital", "public_office", "parking"] as const;
const fieldReportCrowdLevels = ["quiet", "normal", "busy", "packed"] as const;
const fieldReportLineStatuses = ["none", "short", "medium", "long"] as const;
const fieldReportParkingStatuses = ["available", "limited", "full", "unknown"] as const;
const fieldReportQueueStatuses = ["none", "under_10", "10_to_30", "30_to_60", "60_plus", "not_observed"] as const;
const fieldReportParkingObservations = ["available", "limited", "almost_full", "full", "closed", "not_observed"] as const;
const fieldReportWeatherFeels = ["good", "rainy", "windy", "hot", "cold"] as const;
const fieldReportLocalConditions = ["rain", "snow", "strong_wind", "slippery", "entry_restricted", "event", "temporary_closed"] as const;
const questionTypes = ["crowd", "line", "parking", "weather", "photo_request", "other"] as const;
const publicSiteUrl = "https://silsigan.pages.dev";

const workerApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

export default workerApi;

export async function handleRequest(request: Request, env: Env = {}, ctx: ExecutionContext = testExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, service: "silsigan-cloudflare-api", storage: env.DB ? "d1" : "memory" });
    }

    if (requiresPersistentStore(env) && !env.DB) {
      throw new HttpError(503, "PERSISTENT_STORE_REQUIRED", "영구 데이터 저장소를 사용할 수 없습니다.");
    }

    if (request.method === "GET" && path === "/api/config") {
      return getRuntimeConfig(url, env);
    }

    if (request.method === "GET" && path === "/api/sources") {
      return await listPublicDataSources(env);
    }

    if (request.method === "GET" && path === "/api/admin/sources/health") {
      await requireAdmin(request, env, "operator");
      return await listSourceHealth(url, env);
    }

    const sourceHealthMatch = path.match(/^\/api\/admin\/sources\/([^/]+)\/health$/);
    if (sourceHealthMatch && request.method === "POST") {
      await requireAdmin(request, env, "operator");
      return await recordSourceHealth(decodeURIComponent(sourceHealthMatch[1]), request, env);
    }

    const sourcePolicyMatch = path.match(/^\/api\/admin\/sources\/([^/]+)$/);
    if (sourcePolicyMatch && request.method === "PATCH") {
      await requireAdmin(request, env, "admin");
      return await updateSourcePolicy(decodeURIComponent(sourcePolicyMatch[1]), request, env);
    }

    const sourceIngestionMatch = path.match(/^\/api\/admin\/sources\/([^/]+)\/ingest$/);
    if (sourceIngestionMatch && request.method === "POST") {
      await requireAdmin(request, env, "operator");
      return await ingestOfficialSource(decodeURIComponent(sourceIngestionMatch[1]), request, env);
    }

    const session = getAnonymousSession(request);
    const sessionHeaders = sessionHeadersFor(session);

    if (request.method === "GET" && path === "/api/places") {
      return withHeaders(await listPlaces(url, env), sessionHeaders);
    }

    const placeRouteMatch = path.match(/^\/api\/places\/([^/]+)(?:\/([^/]+))?$/);
    if (placeRouteMatch) {
      const placeId = decodeURIComponent(placeRouteMatch[1]);
      const action = placeRouteMatch[2];

      if (request.method === "GET" && !action) {
        return withHeaders(await getPlace(placeId, env), sessionHeaders);
      }

      if (request.method === "GET" && action === "live") {
        return withHeaders(await getPlaceLive(placeId, env), sessionHeaders);
      }

      if (request.method === "GET" && action === "status") {
        return withHeaders(await getPlaceStatus(placeId, env), sessionHeaders);
      }

      if (request.method === "POST" && action === "click") {
        await enforceRateLimit("place:click", request, session.id, 60, 60_000);
        return withHeaders(await clickPlace(request, placeId, session, env), sessionHeaders);
      }

      if (request.method === "POST" && action === "like") {
        await enforceRateLimit("place:like", request, session.id, 30, 60_000);
        return withHeaders(await likePlace(placeId, session, env, ctx), sessionHeaders);
      }

      if (request.method === "DELETE" && action === "like") {
        return withHeaders(await unlikePlace(placeId, session, env), sessionHeaders);
      }
    }

    if (request.method === "GET" && path.startsWith("/api/rankings")) {
      return withHeaders(await listRankings(url, path, env), sessionHeaders);
    }

    if (path === "/api/posts") {
      if (request.method === "GET") {
        return withHeaders(await listPosts(url, session, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("post:create", request, session.id, 12, 60_000);
        const response = await createPost(request, session, env, ctx);
        return withHeaders(response, sessionHeaders);
      }
    }

    if (request.method === "GET" && path === "/api/hashtags") {
      return withHeaders(await listHashtags(env), sessionHeaders);
    }

    if (path === "/api/questions") {
      if (request.method === "GET") {
        return withHeaders(await listQuestions(url, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("question:create", request, session.id, 10, 60_000);
        const response = await createQuestion(request, session, env);
        return withHeaders(response, sessionHeaders);
      }
    }

    if (request.method === "GET" && path === "/api/my-questions") {
      return withHeaders(await listMyQuestions(session, env), sessionHeaders);
    }

    if (path === "/api/comments") {
      if (request.method === "GET") {
        return withHeaders(await listComments(url, session, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("comment:create:minute", request, session.id, commentCreateMinuteLimit, oneMinuteMs);
        await enforceRateLimit("comment:create:daily", request, session.id, commentCreateDailyLimit, oneDayMs);
        const response = await createComment(request, session, env, ctx);
        return withHeaders(response, sessionHeaders);
      }
    }

    const commentLikeMatch = path.match(/^\/api\/comments\/([^/]+)\/like$/);
    if (commentLikeMatch && request.method === "POST") {
      await enforceRateLimit("comment:like", request, session.id, 30, 60_000);
      return withHeaders(await likeComment(commentLikeMatch[1], session, env), sessionHeaders);
    }

    const commentDeleteMatch = path.match(/^\/api\/comments\/([^/]+)$/);
    if (commentDeleteMatch && request.method === "DELETE") {
      return withHeaders(await deleteComment(commentDeleteMatch[1], session, env), sessionHeaders);
    }

    if (path === "/api/photos" && request.method === "GET") {
      return withHeaders(await listPhotos(url, session, env), sessionHeaders);
    }

    if (path === "/api/photos/upload-url" && request.method === "POST") {
      await enforceRateLimit("photo:upload-url", request, session.id, 10, 60 * 60_000);
      return withHeaders(await createPhotoUploadUrl(request, session, env), sessionHeaders);
    }

    if (path === "/api/photos/complete" && request.method === "POST") {
      await enforceRateLimit("photo:complete", request, session.id, 10, 60 * 60_000);
      const response = await completePhoto(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    const photoFileMatch = path.match(/^\/api\/photos\/([^/]+)\/file$/);
    if (photoFileMatch && request.method === "GET") {
      return withHeaders(await servePhotoFile(photoFileMatch[1], env), sessionHeaders);
    }

    const photoClickMatch = path.match(/^\/api\/photos\/([^/]+)\/click$/);
    if (photoClickMatch && request.method === "POST") {
      await enforceRateLimit("photo:click", request, session.id, 60, 60_000);
      return withHeaders(await clickPhoto(photoClickMatch[1], session, env), sessionHeaders);
    }

    const photoDeleteMatch = path.match(/^\/api\/photos\/([^/]+)$/);
    if (photoDeleteMatch && request.method === "DELETE") {
      return withHeaders(await deletePhoto(photoDeleteMatch[1], session, env), sessionHeaders);
    }

    if (path === "/api/reports" && request.method === "GET") {
      const response = await listFieldReports(url, env);
      return withHeaders(response, sessionHeaders);
    }

    if (path === "/api/reports" && request.method === "POST") {
      await enforceRateLimit("report:create", request, session.id, 5, 60_000);
      const response = await createPublicReport(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    const reportVoteMatch = path.match(/^\/api\/reports\/([^/]+)\/votes$/);
    if (reportVoteMatch && request.method === "POST") {
      await enforceRateLimit("report:vote", request, session.id, 30, 60_000);
      return withHeaders(await voteOnFieldReport(reportVoteMatch[1], request, session, env), sessionHeaders);
    }

    if (path === "/api/blocks") {
      if (request.method === "GET") {
        return withHeaders(await listUserBlocks(session, env), sessionHeaders);
      }
      if (request.method === "POST") {
        await enforceRateLimit("user:block", request, session.id, 20, 60_000);
        return withHeaders(await blockContentCreator(request, session, env), sessionHeaders);
      }
    }

    const blockDeleteMatch = path.match(/^\/api\/blocks\/([^/]+)$/);
    if (blockDeleteMatch && request.method === "DELETE") {
      return withHeaders(await unblockContentCreator(blockDeleteMatch[1], session, env), sessionHeaders);
    }

    if (path === "/api/account/deletion" && request.method === "POST") {
      await enforceRateLimit("account:deletion", request, session.id, 3, 60 * 60_000);
      return withHeaders(await deleteAnonymousAccount(request, session, env), sessionHeaders);
    }

    if (path === "/api/identity/link" && request.method === "POST") {
      await enforceRateLimit("identity:link", request, session.id, 10, 60 * 60_000);
      return withHeaders(await linkAnonymousIdentity(request, session, env), sessionHeaders);
    }

    if (path === "/api/moderation/reports" && request.method === "POST") {
      await enforceRateLimit("report:create", request, session.id, 5, 60_000);
      const response = await createModerationReport(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    if (path === "/api/moderation/reports" && request.method === "GET") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await listModerationReports(url, env), sessionHeaders);
    }

    const moderationActionMatch = path.match(/^\/api\/moderation\/reports\/([^/]+)\/action$/);
    if (moderationActionMatch && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await moderateReport(moderationActionMatch[1], request, env), sessionHeaders);
    }

    if (path === "/api/admin/moderation/bulk" && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await bulkModerateContent(request, env), sessionHeaders);
    }

    const photoModerationMatch = path.match(/^\/api\/admin\/photos\/([^/]+)\/moderation$/);
    if (photoModerationMatch && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await moderatePhoto(photoModerationMatch[1], request, env, ctx), sessionHeaders);
    }

    if (path === "/api/admin/places/coordinate-status" && request.method === "POST") {
      await requireAdmin(request, env, "operator");
      return withHeaders(await updatePlaceCoordinateStatus(request, env), sessionHeaders);
    }

    if (path === "/api/admin/users/restrict" && request.method === "POST") {
      await requireAdmin(request, env, "admin");
      return withHeaders(await restrictUser(request, env), sessionHeaders);
    }

    if (path === "/api/admin/users/unrestrict" && request.method === "POST") {
      await requireAdmin(request, env, "admin");
      return withHeaders(await unrestrictUser(request, env), sessionHeaders);
    }

    const adminModerationMatch = path.match(/^\/api\/admin\/moderation\/(hide|restore|delete)$/);
    if (adminModerationMatch && request.method === "POST") {
      const action = adminModerationMatch[1] as AdminModerationAction;
      await requireAdmin(request, env, action === "delete" ? "admin" : "moderator");
      return withHeaders(await moderateContent(request, env, action), sessionHeaders);
    }

    const realtimeResponse = routeRealtime(request, env, ctx, url, path);
    if (realtimeResponse) {
      return withHeaders(await realtimeResponse, sessionHeaders);
    }

    return errorResponse(404, "NOT_FOUND", "라우트를 찾을 수 없습니다.");
  } catch (error) {
    return errorToResponse(error);
  }
}

async function getRuntimeConfig(url: URL, env: Env): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        contractVersion: 2,
        dataMode: "demo" as const,
        featureFlags: { ...DEFAULT_FEATURE_FLAGS },
        dimensionSettings: INITIAL_DIMENSION_SETTINGS.map((setting) => ({ ...setting })),
      },
      { storage: "memory" },
    );
  }

  const regionCode = url.searchParams.get("regionCode")?.trim() ?? "";
  const [flagRows, settingRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        flag_key AS flagKey,
        enabled,
        scope_type AS scopeType,
        scope_key AS scopeKey
      FROM feature_flags
      WHERE scope_type = 'global' OR (scope_type = 'region' AND scope_key = ?)
    `)
      .bind(regionCode)
      .all<D1FeatureFlagRow>(),
    env.DB.prepare(`
      SELECT
        setting_key AS settingKey,
        dimension,
        default_ttl_seconds AS defaultTtlSeconds,
        current_eligible AS currentEligible
      FROM dimension_settings
      ORDER BY setting_key
    `).all<D1DimensionSettingRow>(),
  ]);
  const values = (flagRows.results ?? []).map<FeatureFlagValue>((row) => ({
    key: row.flagKey,
    enabled: row.enabled === 1,
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
  }));
  const featureFlags = Object.fromEntries(
    featureFlagKeys.map((key) => [key, resolveFeatureFlag(key, values, regionCode || undefined)]),
  ) as Record<FeatureFlagKey, boolean>;

  return json(
    {
      contractVersion: 2,
      dataMode: "live" as const,
      featureFlags,
      dimensionSettings: (settingRows.results ?? []).map((setting) => ({
        settingKey: setting.settingKey,
        dimension: setting.dimension,
        defaultTtlSeconds: setting.defaultTtlSeconds,
        currentEligible: setting.currentEligible === 1,
      })),
    },
    { storage: "d1" },
  );
}

async function listPublicDataSources(env: Env): Promise<Response> {
  if (!env.DB) {
    return json([], { storage: "memory", dataMode: "demo" });
  }

  const { results = [] } = await env.DB.prepare(`
    SELECT
      id,
      source_key AS sourceKey,
      source_name AS sourceName,
      provider_name AS providerName,
      source_type AS sourceType,
      documentation_url AS documentationUrl,
      terms_url AS termsUrl,
      attribution_text AS attributionText,
      commercial_use_status AS commercialUseStatus,
      agreement_required AS agreementRequired,
      refresh_interval_seconds AS refreshIntervalSeconds,
      default_ttl_seconds AS defaultTtlSeconds,
      enabled,
      enabled_regions_json AS enabledRegionsJson,
      last_terms_checked_at AS lastTermsCheckedAt,
      last_health_checked_at AS lastHealthCheckedAt,
      health_status AS healthStatus
    FROM data_sources
    ORDER BY source_key
  `).all<D1DataSourceRow>();

  return json(
    results.map((row) => ({
      id: row.id,
      sourceKey: row.sourceKey,
      sourceName: row.sourceName,
      providerName: row.providerName,
      sourceType: row.sourceType,
      ...(row.documentationUrl ? { documentationUrl: row.documentationUrl } : {}),
      ...(row.termsUrl ? { termsUrl: row.termsUrl } : {}),
      ...(row.attributionText ? { attributionText: row.attributionText } : {}),
      commercialUseStatus: row.commercialUseStatus,
      agreementRequired: row.agreementRequired === 1,
      ...(row.refreshIntervalSeconds === null ? {} : { refreshIntervalSeconds: row.refreshIntervalSeconds }),
      ...(row.defaultTtlSeconds === null ? {} : { defaultTtlSeconds: row.defaultTtlSeconds }),
      enabled: row.enabled === 1,
      enabledRegions: parseStringArray(row.enabledRegionsJson),
      ...(row.lastTermsCheckedAt ? { lastTermsCheckedAt: row.lastTermsCheckedAt } : {}),
      ...(row.lastHealthCheckedAt ? { lastHealthCheckedAt: row.lastHealthCheckedAt } : {}),
      healthStatus: row.healthStatus,
      activationStatus: publicSourceActivationStatus(row),
    })),
    { storage: "d1", dataMode: "live" },
  );
}

async function listSourceHealth(url: URL, env: Env): Promise<Response> {
  const db = requireD1(env);
  const limit = clampLimit(Number(url.searchParams.get("limit") ?? 50), 100, 50);
  const { results = [] } = await db.prepare(`
    SELECT
      shl.id,
      shl.source_id AS sourceId,
      ds.source_key AS sourceKey,
      shl.status,
      shl.message,
      shl.response_time_ms AS responseTimeMs,
      shl.checked_at AS checkedAt
    FROM source_health_logs shl
    JOIN data_sources ds ON ds.id = shl.source_id
    ORDER BY shl.checked_at DESC
    LIMIT ?
  `).bind(limit).all<D1SourceHealthLogRow>();

  return json(results, { storage: "d1", limit });
}

async function recordSourceHealth(sourceKey: string, request: Request, env: Env): Promise<Response> {
  const db = requireD1(env);
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(sourceKey)) {
    throw new HttpError(400, "VALIDATION_ERROR", "sourceKey 값이 올바르지 않습니다.");
  }

  const source = await db.prepare("SELECT id FROM data_sources WHERE source_key = ?").bind(sourceKey).first<{ id: string }>();
  if (!source) {
    throw new HttpError(404, "SOURCE_NOT_FOUND", "데이터 출처를 찾을 수 없습니다.");
  }

  const body = await readJson(request);
  const status = enumField(body, "status", ["healthy", "degraded", "down"] as const);
  const message = optionalStringField(body, "message", 500) ?? null;
  const responseTimeMs = body.responseTimeMs === undefined || body.responseTimeMs === null
    ? null
    : integerField(body, "responseTimeMs", 0, 120_000, 0);
  const checkedAtInput = optionalStringField(body, "checkedAt", 40);
  const checkedAtMs = checkedAtInput ? Date.parse(checkedAtInput) : Date.now();
  if (!Number.isFinite(checkedAtMs) || checkedAtMs > Date.now() + 60_000) {
    throw new HttpError(400, "VALIDATION_ERROR", "checkedAt 값이 올바르지 않습니다.");
  }
  const checkedAt = new Date(checkedAtMs).toISOString();
  const health = await persistD1SourceHealth(db, {
    sourceId: source.id,
    status,
    message,
    responseTimeMs,
    checkedAt,
  });

  return json({
    ...health,
    sourceKey,
  }, { storage: "d1" }, 201);
}

async function updateSourcePolicy(sourceKey: string, request: Request, env: Env): Promise<Response> {
  const db = requireD1(env);
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(sourceKey)) {
    throw new HttpError(400, "VALIDATION_ERROR", "sourceKey 값이 올바르지 않습니다.");
  }

  const source = await db.prepare(`
    SELECT
      id,
      source_type AS sourceType,
      health_status AS healthStatus
    FROM data_sources
    WHERE source_key = ?
  `).bind(sourceKey).first<{
    id: string;
    sourceType: LiveSignal["sourceType"];
    healthStatus: D1DataSourceRow["healthStatus"];
  }>();
  if (!source) {
    throw new HttpError(404, "SOURCE_NOT_FOUND", "데이터 출처를 찾을 수 없습니다.");
  }

  const body = await readJson(request);
  const commercialUseStatus = enumField(body, "commercialUseStatus", [
    "pending",
    "allowed",
    "allowed_with_attribution",
    "agreement_required",
    "prohibited",
    "unknown",
  ] as const);
  const enabled = booleanField(body, "enabled");
  const agreementRequired = booleanField(body, "agreementRequired");
  const imageUseAllowed = booleanField(body, "imageUseAllowed");
  const videoUseAllowed = booleanField(body, "videoUseAllowed");
  const enabledRegions = sourceRegionsField(body, "enabledRegions");
  const attributionText = optionalStringField(body, "attributionText", 300) ?? null;
  const ownerContact = stringField(body, "ownerContact", 120);
  const internalNote = optionalStringField(body, "internalNote", 500) ?? null;
  const rightsReviewedAt = sourceRightsReviewedAtField(body, "rightsReviewedAt");
  const defaultTtlSeconds = nullableIntegerField(body, "defaultTtlSeconds", 30, 86_400);

  if (enabled) {
    if (commercialUseStatus !== "allowed" && commercialUseStatus !== "allowed_with_attribution") {
      throw new HttpError(409, "SOURCE_RIGHTS_REQUIRED", "상업 이용 권리 확인 전에는 출처를 활성화할 수 없습니다.");
    }
    if (!(["healthy", "degraded"] as const).includes(source.healthStatus as "healthy" | "degraded")) {
      throw new HttpError(409, "SOURCE_HEALTH_REQUIRED", "health 확인 전에는 출처를 활성화할 수 없습니다.");
    }
    if (enabledRegions.length === 0) {
      throw new HttpError(409, "SOURCE_REGION_REQUIRED", "활성 출처에는 허용 지역이 필요합니다.");
    }
    if (source.sourceType !== "official_static" && defaultTtlSeconds === null) {
      throw new HttpError(409, "SOURCE_TTL_REQUIRED", "현재 상태 출처에는 TTL이 필요합니다.");
    }
    if (commercialUseStatus === "allowed_with_attribution" && !attributionText) {
      throw new HttpError(409, "SOURCE_ATTRIBUTION_REQUIRED", "출처표시 문구가 필요합니다.");
    }
    if (agreementRequired && !internalNote) {
      throw new HttpError(409, "SOURCE_AGREEMENT_EVIDENCE_REQUIRED", "계약 또는 승인 근거를 기록해야 합니다.");
    }
    if (sourceKey === "youtube_live" && !videoUseAllowed) {
      throw new HttpError(409, "SOURCE_VIDEO_RIGHTS_REQUIRED", "영상 권리 확인 전에는 라이브 출처를 활성화할 수 없습니다.");
    }
  }

  const updatedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE data_sources
    SET
      commercial_use_status = ?,
      agreement_required = ?,
      attribution_text = ?,
      image_use_allowed = ?,
      video_use_allowed = ?,
      default_ttl_seconds = ?,
      enabled = ?,
      enabled_regions_json = ?,
      last_terms_checked_at = ?,
      owner_contact = ?,
      internal_note = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    commercialUseStatus,
    agreementRequired ? 1 : 0,
    attributionText,
    imageUseAllowed ? 1 : 0,
    videoUseAllowed ? 1 : 0,
    defaultTtlSeconds,
    enabled ? 1 : 0,
    JSON.stringify(enabledRegions),
    rightsReviewedAt,
    ownerContact,
    internalNote,
    updatedAt,
    source.id,
  ).run();
  await recordAdminAction(
    db,
    request,
    "source_policy_updated",
    "data_source",
    source.id,
    `rights=${commercialUseStatus};enabled=${enabled ? 1 : 0}`,
  );

  return json({
    sourceKey,
    commercialUseStatus,
    enabled,
    agreementRequired,
    imageUseAllowed,
    videoUseAllowed,
    enabledRegions,
    defaultTtlSeconds,
    rightsReviewedAt,
    ownerContact,
    ...(attributionText ? { attributionText } : {}),
  }, { authz: "admin-role", auditPolicy: "admin_actions", storage: "d1" });
}

async function ingestOfficialSource(sourceKey: string, request: Request, env: Env): Promise<Response> {
  if (!new Set(["kma_weather", "tour_api", "national_parking", "national_traffic", "national_cctv"]).has(sourceKey)) {
    throw new HttpError(404, "SOURCE_ADAPTER_NOT_FOUND", "등록된 수집 어댑터를 찾을 수 없습니다.");
  }

  const db = requireD1(env);
  const source = await db.prepare(`
    SELECT
      id,
      source_key AS sourceKey,
      source_name AS sourceName,
      source_type AS sourceType,
      commercial_use_status AS commercialUseStatus,
      enabled,
      health_status AS healthStatus,
      default_ttl_seconds AS defaultTtlSeconds
    FROM data_sources
    WHERE source_key = ?
  `).bind(sourceKey).first<D1OperationalSourceRow>();
  if (!source) {
    throw new HttpError(404, "SOURCE_NOT_FOUND", "데이터 출처를 찾을 수 없습니다.");
  }
  if (
    source.enabled !== 1 ||
    !["allowed", "allowed_with_attribution"].includes(source.commercialUseStatus) ||
    !["healthy", "degraded"].includes(source.healthStatus)
  ) {
    throw new HttpError(409, "SOURCE_NOT_ACTIVE", "권리, 활성화, health 승인이 완료된 출처만 수집할 수 있습니다.");
  }
  if (source.sourceType !== "official_static" && !source.defaultTtlSeconds) {
    throw new HttpError(503, "SOURCE_TTL_REQUIRED", "데이터 출처 만료 설정이 필요합니다.");
  }

  if (sourceKey === "national_traffic") {
    return ingestNationalTrafficSource(source, request, env, db);
  }
  if (source.sourceType === "official_static") {
    return ingestOfficialStaticSource(source, request, env, db);
  }

  const sourceTtlSeconds = source.defaultTtlSeconds;
  if (!sourceTtlSeconds) {
    throw new HttpError(503, "SOURCE_TTL_REQUIRED", "데이터 출처 만료 설정이 필요합니다.");
  }

  const serviceKey = env.KMA_SERVICE_KEY?.trim();
  if (!serviceKey) {
    throw new HttpError(503, "SOURCE_CREDENTIAL_REQUIRED", "데이터 출처 인증 설정이 필요합니다.");
  }

  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const place = await resolvePlaceRecord(placeId, env);
  const query = {
    placeId: place.id,
    nx: integerField(body, "nx", 1, 200, 0),
    ny: integerField(body, "ny", 1, 200, 0),
    baseDate: stringField(body, "baseDate", 8),
    baseTime: stringField(body, "baseTime", 4),
  };
  const runId = `ingestion_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, source.id, place.regionId, startedAt).run();

  const adapter = createKmaWeatherAdapter({
    serviceKey,
    ttlSeconds: sourceTtlSeconds,
  });
  const gateway = new PublicDataGateway({ cache: env.CACHE });
  const requestStartedAt = Date.now();

  try {
    const result = await gateway.execute(adapter, query, {
      freshTtlSeconds: Math.min(sourceTtlSeconds, 300),
      staleTtlSeconds: sourceTtlSeconds,
      timeoutMs: 5_000,
      maxAttempts: 2,
    });
    if (!result.payloadHash) {
      throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "출처 응답 증거값을 생성하지 못했습니다.", false);
    }

    for (const signal of result.items) {
      const idempotencyKey = `${signal.externalObservationId}:${result.payloadHash}`;
      const stableId = await sha256Hex(`${source.id}:${place.id}:${idempotencyKey}`);
      const signalId = `official_signal_${stableId.slice(0, 48)}`;
      const metadata = {
        ...(signal.temperatureC === undefined ? {} : { temperatureC: signal.temperatureC }),
        ...(signal.precipitationMm === undefined ? {} : { precipitationMm: signal.precipitationMm }),
        ...(signal.windSpeedMps === undefined ? {} : { windSpeedMps: signal.windSpeedMps }),
      };
      await db.prepare(`
        INSERT OR IGNORE INTO live_signals (
          id,
          place_id,
          dimension,
          value_code,
          value_number,
          value_text,
          unit,
          source_id,
          source_type,
          source_name,
          attribution_text,
          observed_at,
          fetched_at,
          expires_at,
          confidence_score,
          is_estimated,
          is_publicly_visible,
          evidence_type,
          evidence_id,
          idempotency_key,
          metadata_json
        ) VALUES (?, ?, 'weather', ?, ?, ?, 'C', ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'api', ?, ?, ?)
      `).bind(
        signalId,
        place.id,
        signal.valueCode,
        signal.temperatureC ?? null,
        signal.valueText,
        source.id,
        signal.sourceType,
        signal.sourceName,
        signal.attributionText,
        signal.observedAt,
        signal.fetchedAt,
        signal.expiresAt,
        signal.confidenceScore,
        signal.externalObservationId,
        idempotencyKey,
        JSON.stringify(metadata),
      ).run();
      await db.prepare(`
        INSERT OR IGNORE INTO official_observations (
          id,
          live_signal_id,
          source_id,
          external_observation_id,
          raw_payload_hash,
          provider_observed_at,
          fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `official_observation_${stableId.slice(0, 48)}`,
        signalId,
        source.id,
        signal.externalObservationId,
        result.payloadHash,
        signal.observedAt,
        signal.fetchedAt,
      ).run();
    }

    const finishedAt = new Date().toISOString();
    const ingestionStatus = result.cacheStatus === "stale" ? "partial" : "succeeded";
    await db.prepare(`
      UPDATE api_ingestion_runs
      SET status = ?, fetched_count = 1, normalized_count = ?, finished_at = ?
      WHERE id = ?
    `).bind(ingestionStatus, result.items.length, finishedAt, runId).run();
    await persistD1SourceHealth(db, {
      sourceId: source.id,
      status: result.healthStatus,
      message: result.cacheStatus === "stale" ? "stale cache in use" : null,
      responseTimeMs: Date.now() - requestStartedAt,
      checkedAt: finishedAt,
    });
    const status = await recomputeD1PlaceStatus(db, place.id, new Date());

    return json({
      sourceKey,
      placeId: place.id,
      normalizedCount: result.items.length,
      cacheStatus: result.cacheStatus,
      observedAt: result.items[0]?.observedAt ?? null,
      status,
    }, { storage: "d1", ingestionRunId: runId }, 201);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorCode = error instanceof PublicDataGatewayError ? error.code : "INGESTION_FAILED";
    await db.prepare(`
      UPDATE api_ingestion_runs
      SET status = 'failed', error_code = ?, finished_at = ?
      WHERE id = ?
    `).bind(errorCode, finishedAt, runId).run();
    await persistD1SourceHealth(db, {
      sourceId: source.id,
      status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
      message: "official source ingestion failed",
      responseTimeMs: Date.now() - requestStartedAt,
      checkedAt: finishedAt,
    });
    if (error instanceof PublicDataGatewayError) {
      throw new HttpError(error.code === "SOURCE_QUOTA_EXCEEDED" ? 503 : 502, error.code, error.message);
    }
    throw error;
  }
}

type StaticSourceMetadata = {
  externalId: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  sourceUpdatedAt?: string;
};

async function ingestOfficialStaticSource(
  source: D1OperationalSourceRow,
  request: Request,
  env: Env,
  db: D1Database,
): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const place = await resolvePlaceRecord(placeId, env);
  const externalId = stringField(body, "externalId", 200);
  const matchMethod = enumField(body, "matchMethod", [
    "provider_id",
    "normalized_name",
    "address",
    "distance",
    "phone",
    "building",
    "manual",
  ] as const);
  const manuallyVerified = booleanField(body, "manuallyVerified");
  if (matchMethod === "manual" && !manuallyVerified) {
    throw new HttpError(400, "VALIDATION_ERROR", "manual 매핑은 manuallyVerified=true 여야 합니다.");
  }

  const gateway = new PublicDataGateway({ cache: env.CACHE });
  const policy = { freshTtlSeconds: 300, staleTtlSeconds: 86_400, timeoutMs: 5_000, maxAttempts: 2 };
  const runId = `ingestion_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, source.id, place.regionId, startedAt).run();
  const requestStartedAt = Date.now();

  try {
    let result: {
      items: StaticSourceMetadata[];
      fetchedAt: string;
      cacheStatus: "network" | "fresh" | "stale";
      healthStatus: "healthy" | "degraded" | "down";
    };

    if (source.sourceKey === "tour_api") {
      const serviceKey = requiredSourceCredential(env.TOUR_API_SERVICE_KEY);
      const areaCode = stringField(body, "areaCode", 3);
      const contentTypeId = optionalStringField(body, "contentTypeId", 3);
      const fetched = await gateway.execute(createTourApiAdapter({ serviceKey }), {
        areaCode,
        ...(contentTypeId ? { contentTypeId } : {}),
        pageNo: integerField(body, "pageNo", 1, 10_000, 1),
        numOfRows: integerField(body, "numOfRows", 1, 100, 20),
      }, policy);
      result = {
        ...fetched,
        items: fetched.items.map((item) => ({
          externalId: item.externalId,
          name: item.name,
          ...(item.address ? { address: item.address } : {}),
          ...(item.latitude === undefined ? {} : { latitude: item.latitude }),
          ...(item.longitude === undefined ? {} : { longitude: item.longitude }),
          ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
        })),
      };
    } else if (source.sourceKey === "national_parking") {
      const serviceKey = requiredSourceCredential(env.NATIONAL_PARKING_SERVICE_KEY);
      const endpointUrl = env.NATIONAL_PARKING_ENDPOINT_URL?.trim();
      if (!endpointUrl) throw new HttpError(503, "SOURCE_ENDPOINT_REQUIRED", "데이터 출처 endpoint 설정이 필요합니다.");
      const fetched = await gateway.execute(createNationalParkingAdapter({ serviceKey, endpointUrl }), {
        pageNo: integerField(body, "pageNo", 1, 10_000, 1),
        numOfRows: integerField(body, "numOfRows", 1, 1_000, 100),
      }, policy);
      result = {
        ...fetched,
        items: fetched.items.map((item) => ({
          externalId: item.externalId,
          name: item.name,
          ...(item.roadAddress ? { address: item.roadAddress } : {}),
          ...(item.latitude === undefined ? {} : { latitude: item.latitude }),
          ...(item.longitude === undefined ? {} : { longitude: item.longitude }),
          ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt } : {}),
        })),
      };
    } else if (source.sourceKey === "national_cctv") {
      const serviceKey = requiredSourceCredential(env.ITS_SERVICE_KEY);
      const fetched = await gateway.execute(createNationalCctvAdapter({ serviceKey }), {
        roadType: enumField(body, "roadType", ["ex", "its"] as const),
        cctvType: enumField(body, "cctvType", ["1", "2", "3", "4", "5"] as const),
        bbox: requiredSourceBbox(body),
      }, policy);
      result = {
        ...fetched,
        items: fetched.items.map((item) => ({
          externalId: item.externalId,
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          sourceUpdatedAt: item.sourceUpdatedAt,
        })),
      };
    } else {
      throw new HttpError(404, "SOURCE_ADAPTER_NOT_FOUND", "등록된 정적 수집 어댑터를 찾을 수 없습니다.");
    }

    const item = result.items.find((candidate) => candidate.externalId === externalId);
    if (!item) {
      throw new HttpError(422, "SOURCE_ITEM_NOT_FOUND", "응답에서 지정한 외부 장소를 찾을 수 없습니다.");
    }
    const existing = await db.prepare(`
      SELECT place_id AS placeId
      FROM place_source_mappings
      WHERE source_id = ? AND external_place_id = ?
    `).bind(source.id, externalId).first<{ placeId: string }>();
    if (existing && existing.placeId !== place.id) {
      throw new HttpError(409, "SOURCE_MAPPING_CONFLICT", "외부 장소가 다른 내부 장소에 이미 연결돼 있습니다.");
    }

    const mappingHash = await sha256Hex(`${source.id}:${externalId}`);
    const seenAt = result.fetchedAt;
    await db.prepare(`
      INSERT INTO place_source_mappings (
        id, place_id, source_id, external_place_id, external_name, external_address,
        external_lat, external_lng, match_score, match_method, manually_verified,
        first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, external_place_id) DO UPDATE SET
        external_name = excluded.external_name,
        external_address = excluded.external_address,
        external_lat = excluded.external_lat,
        external_lng = excluded.external_lng,
        match_score = excluded.match_score,
        match_method = excluded.match_method,
        manually_verified = excluded.manually_verified,
        last_seen_at = excluded.last_seen_at
    `).bind(
      `source_mapping_${mappingHash.slice(0, 48)}`,
      place.id,
      source.id,
      externalId,
      item.name,
      item.address ?? null,
      item.latitude ?? null,
      item.longitude ?? null,
      manuallyVerified ? 1 : null,
      matchMethod,
      manuallyVerified ? 1 : 0,
      seenAt,
      seenAt,
    ).run();

    const finishedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE api_ingestion_runs
      SET status = ?, fetched_count = ?, normalized_count = 1, rejected_count = ?, finished_at = ?
      WHERE id = ?
    `).bind(
      result.cacheStatus === "stale" ? "partial" : "succeeded",
      result.items.length,
      Math.max(0, result.items.length - 1),
      finishedAt,
      runId,
    ).run();
    await persistD1SourceHealth(db, {
      sourceId: source.id,
      status: result.healthStatus,
      message: result.cacheStatus === "stale" ? "stale cache in use" : null,
      responseTimeMs: Date.now() - requestStartedAt,
      checkedAt: finishedAt,
    });

    return json({
      sourceKey: source.sourceKey,
      placeId: place.id,
      externalId,
      metadataOnly: true,
      sourceUpdatedAt: item.sourceUpdatedAt ?? null,
      currentSignalCreated: false,
    }, { storage: "d1", ingestionRunId: runId }, 201);
  } catch (error) {
    await failOfficialIngestion(db, source, runId, error, requestStartedAt);
    throwOfficialIngestionError(error);
  }
}

async function ingestNationalTrafficSource(
  source: D1OperationalSourceRow,
  request: Request,
  env: Env,
  db: D1Database,
): Promise<Response> {
  const serviceKey = requiredSourceCredential(env.ITS_SERVICE_KEY);
  if (!source.defaultTtlSeconds) throw new HttpError(503, "SOURCE_TTL_REQUIRED", "데이터 출처 만료 설정이 필요합니다.");
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const place = await resolvePlaceRecord(placeId, env);
  const linkId = stringField(body, "linkId", 80);
  const roadType = enumField(body, "roadType", ["all", "ex", "its"] as const);
  const bbox = optionalSourceBbox(body);
  const routeNo = optionalStringField(body, "routeNo", 6);
  const direction = optionalEnumField(body, "direction", ["all", "up", "down", "start", "end"] as const);
  const query = {
    placeId: place.id,
    roadType,
    ...(routeNo ? { routeNo } : {}),
    ...(direction ? { direction } : {}),
    ...(bbox ? { bbox } : {}),
  };
  const runId = `ingestion_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, source.id, place.regionId, startedAt).run();
  const requestStartedAt = Date.now();

  try {
    const result = await new PublicDataGateway({ cache: env.CACHE }).execute(
      createNationalTrafficAdapter({ serviceKey, ttlSeconds: source.defaultTtlSeconds }),
      query,
      {
        freshTtlSeconds: Math.min(source.defaultTtlSeconds, 300),
        staleTtlSeconds: source.defaultTtlSeconds,
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    );
    if (!result.payloadHash) {
      throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "출처 응답 증거값을 생성하지 못했습니다.", false);
    }
    const signal = result.items.find((candidate) => candidate.externalObservationId.startsWith(`${linkId}:`));
    if (!signal) throw new HttpError(422, "SOURCE_ITEM_NOT_FOUND", "응답에서 지정한 교통 링크를 찾을 수 없습니다.");

    const idempotencyKey = `${signal.externalObservationId}:${result.payloadHash}`;
    const stableId = await sha256Hex(`${source.id}:${place.id}:${idempotencyKey}`);
    const signalId = `official_signal_${stableId.slice(0, 48)}`;
    await db.prepare(`
      INSERT OR IGNORE INTO live_signals (
        id, place_id, dimension, value_code, value_number, value_text, unit,
        source_id, source_type, source_name, attribution_text,
        observed_at, fetched_at, expires_at, confidence_score, is_estimated,
        is_publicly_visible, evidence_type, evidence_id, idempotency_key, metadata_json
      ) VALUES (?, ?, 'road_traffic', ?, ?, ?, 'km/h', ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'api', ?, ?, ?)
    `).bind(
      signalId,
      place.id,
      signal.valueCode,
      signal.speedKph,
      signal.valueText,
      source.id,
      signal.sourceType,
      signal.sourceName,
      signal.attributionText,
      signal.observedAt,
      signal.fetchedAt,
      signal.expiresAt,
      signal.confidenceScore,
      signal.externalObservationId,
      idempotencyKey,
      JSON.stringify({ roadName: signal.roadName, speedKph: signal.speedKph, classification: "speed_threshold" }),
    ).run();
    await db.prepare(`
      INSERT OR IGNORE INTO official_observations (
        id, live_signal_id, source_id, external_observation_id,
        raw_payload_hash, provider_observed_at, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `official_observation_${stableId.slice(0, 48)}`,
      signalId,
      source.id,
      signal.externalObservationId,
      result.payloadHash,
      signal.observedAt,
      signal.fetchedAt,
    ).run();

    const finishedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE api_ingestion_runs
      SET status = ?, fetched_count = ?, normalized_count = 1, rejected_count = ?, finished_at = ?
      WHERE id = ?
    `).bind(
      result.cacheStatus === "stale" ? "partial" : "succeeded",
      result.items.length,
      Math.max(0, result.items.length - 1),
      finishedAt,
      runId,
    ).run();
    await persistD1SourceHealth(db, {
      sourceId: source.id,
      status: result.healthStatus,
      message: result.cacheStatus === "stale" ? "stale cache in use" : null,
      responseTimeMs: Date.now() - requestStartedAt,
      checkedAt: finishedAt,
    });
    const status = await recomputeD1PlaceStatus(db, place.id, new Date());

    return json({
      sourceKey: source.sourceKey,
      placeId: place.id,
      linkId,
      normalizedCount: 1,
      observedAt: signal.observedAt,
      isEstimated: true,
      status,
    }, { storage: "d1", ingestionRunId: runId }, 201);
  } catch (error) {
    await failOfficialIngestion(db, source, runId, error, requestStartedAt);
    throwOfficialIngestionError(error);
  }
}

function requiredSourceCredential(raw: string | undefined): string {
  const credential = raw?.trim();
  if (!credential) throw new HttpError(503, "SOURCE_CREDENTIAL_REQUIRED", "데이터 출처 인증 설정이 필요합니다.");
  return credential;
}

function requiredSourceBbox(body: JsonObject): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const bbox = optionalSourceBbox(body);
  if (!bbox) throw new HttpError(400, "VALIDATION_ERROR", "bbox 좌표가 필요합니다.");
  return bbox;
}

function optionalSourceBbox(body: JsonObject): { minLng: number; maxLng: number; minLat: number; maxLat: number } | undefined {
  const fields = ["minLng", "maxLng", "minLat", "maxLat"] as const;
  const present = fields.filter((field) => body[field] !== undefined && body[field] !== null);
  if (present.length === 0) return undefined;
  if (present.length !== fields.length) throw new HttpError(400, "VALIDATION_ERROR", "bbox 좌표가 올바르지 않습니다.");
  const bbox = {
    minLng: coordinateField(body, "minLng", -180, 180),
    maxLng: coordinateField(body, "maxLng", -180, 180),
    minLat: coordinateField(body, "minLat", -90, 90),
    maxLat: coordinateField(body, "maxLat", -90, 90),
  };
  if (bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) {
    throw new HttpError(400, "VALIDATION_ERROR", "bbox 좌표가 올바르지 않습니다.");
  }
  return bbox;
}

async function failOfficialIngestion(
  db: D1Database,
  source: D1OperationalSourceRow,
  runId: string,
  error: unknown,
  requestStartedAt: number,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const errorCode = error instanceof PublicDataGatewayError || error instanceof HttpError ? error.code : "INGESTION_FAILED";
  await db.prepare(`
    UPDATE api_ingestion_runs
    SET status = 'failed', error_code = ?, finished_at = ?
    WHERE id = ?
  `).bind(errorCode, finishedAt, runId).run();
  if (!(error instanceof HttpError)) {
    await persistD1SourceHealth(db, {
      sourceId: source.id,
      status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
      message: "official source ingestion failed",
      responseTimeMs: Date.now() - requestStartedAt,
      checkedAt: finishedAt,
    });
  }
}

function throwOfficialIngestionError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof PublicDataGatewayError) {
    throw new HttpError(error.code === "SOURCE_QUOTA_EXCEEDED" ? 503 : 502, error.code, error.message);
  }
  throw error;
}

async function persistD1SourceHealth(
  db: D1Database,
  input: {
    sourceId: string;
    status: "healthy" | "degraded" | "down";
    message: string | null;
    responseTimeMs: number | null;
    checkedAt: string;
  },
): Promise<Omit<D1SourceHealthLogRow, "sourceKey">> {
  const logId = `source_health_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO source_health_logs (id, source_id, status, message, response_time_ms, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(logId, input.sourceId, input.status, input.message, input.responseTimeMs, input.checkedAt).run();
  await db.prepare(`
    UPDATE data_sources
    SET health_status = ?, last_health_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(input.status, input.checkedAt, input.checkedAt, input.sourceId).run();

  return {
    id: logId,
    sourceId: input.sourceId,
    status: input.status,
    message: input.message,
    responseTimeMs: input.responseTimeMs,
    checkedAt: input.checkedAt,
  };
}

function publicSourceActivationStatus(row: D1DataSourceRow): "active" | "awaiting_rights" | "unhealthy" | "inactive" {
  if (["pending", "agreement_required", "unknown"].includes(row.commercialUseStatus)) {
    return "awaiting_rights";
  }
  if (row.enabled !== 1 || row.commercialUseStatus === "prohibited") {
    return "inactive";
  }
  if (row.healthStatus !== "healthy" && row.healthStatus !== "degraded") {
    return "unhealthy";
  }
  return "active";
}

async function getTtlSettings(env: Env, settingKeys: readonly string[]): Promise<Record<string, number>> {
  const requestedKeys = [...new Set(settingKeys)];
  const initialSettings = new Map<string, number>(
    INITIAL_DIMENSION_SETTINGS.map((setting) => [setting.settingKey, setting.defaultTtlSeconds]),
  );

  if (!env.DB) {
    return Object.fromEntries(
      requestedKeys.map((settingKey) => {
        const ttlSeconds = initialSettings.get(settingKey);
        if (!ttlSeconds) {
          throw new HttpError(503, "DIMENSION_SETTING_REQUIRED", "필수 만료 설정을 찾을 수 없습니다.");
        }
        return [settingKey, ttlSeconds];
      }),
    );
  }

  const placeholders = requestedKeys.map(() => "?").join(", ");
  const { results = [] } = await env.DB
    .prepare(
      `SELECT setting_key AS settingKey, default_ttl_seconds AS defaultTtlSeconds
       FROM dimension_settings
       WHERE setting_key IN (${placeholders})`,
    )
    .bind(...requestedKeys)
    .all<Pick<D1DimensionSettingRow, "settingKey" | "defaultTtlSeconds">>();
  const ttlByKey = Object.fromEntries(results.map((setting) => [setting.settingKey, setting.defaultTtlSeconds]));
  for (const settingKey of requestedKeys) {
    if (!ttlByKey[settingKey]) {
      throw new HttpError(503, "DIMENSION_SETTING_REQUIRED", "필수 만료 설정을 찾을 수 없습니다.");
    }
  }
  return ttlByKey;
}

function requiresPersistentStore(env: Env): boolean {
  return env.ENVIRONMENT === "staging" || env.ENVIRONMENT === "production";
}

function requireD1(env: Env): D1Database {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "이 작업에는 D1 바인딩이 필요합니다.");
  }
  return env.DB;
}

export class PlaceRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "place");
  }
}

export class RegionRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "region");
  }
}

export class GlobalRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "global");
  }
}

class InMemoryRoom {
  private readonly sockets = new Set<WorkerWebSocket>();
  private readonly eventsByRoom = new Map<string, RoomBroadcast[]>();

  async fetch(request: Request, scope: RoomBroadcast["scope"]): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId") ?? "global";

    if (request.method === "POST" && url.pathname === "/api/realtime/broadcast") {
      const event = roomBroadcastFromUnknown(await readJson(request), scope, roomId);
      const key = roomKey(scope, roomId);
      this.eventsByRoom.set(key, [event, ...(this.eventsByRoom.get(key) ?? [])].slice(0, 50));
      this.broadcast(JSON.stringify(event));

      return json({
        mode: "durable-object",
        scope,
        roomId,
        delivered: this.sockets.size,
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets.add(server);
      server.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        this.broadcast(
          JSON.stringify({
            type: "heartbeat",
            scope,
            roomId,
            payload: { echo: data.slice(0, 256) },
            createdAt: new Date().toISOString(),
          }),
        );
      });
      server.addEventListener("close", () => this.sockets.delete(server));
      server.addEventListener("error", () => this.sockets.delete(server));

      const responseInit: WorkerResponseInit = {
        status: 101,
        webSocket: client,
      };

      return createWebSocketResponse(client, responseInit);
    }

    return json({ mode: "durable-object-polling", scope, roomId, events: this.eventsByRoom.get(roomKey(scope, roomId)) ?? [] });
  }

  private broadcast(message: string) {
    for (const socket of this.sockets) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }
}

function createWebSocketResponse(client: WorkerWebSocket, responseInit: WorkerResponseInit): Response {
  try {
    return new Response(null, responseInit);
  } catch (error) {
    if (!isNodeStatus101ResponseError(error)) {
      throw error;
    }

    const response = new Response(null);
    Object.defineProperty(response, "status", { value: 101 });
    Object.defineProperty(response, "webSocket", { value: client });
    return response;
  }
}

function isNodeStatus101ResponseError(error: unknown): boolean {
  return error instanceof RangeError && error.message.includes("status") && error.message.includes("200 to 599");
}

function roomBroadcastFromUnknown(value: unknown, scope: RoomBroadcast["scope"], roomId: string): RoomBroadcast {
  if (!isRecord(value)) {
    throw new HttpError(400, "REALTIME_EVENT_INVALID", "실시간 이벤트 형식이 올바르지 않습니다.");
  }

  const type = value.type;
  const eventScope = value.scope;
  const eventRoomId = value.roomId;
  const payload = value.payload;
  const createdAt = value.createdAt;
  const allowedTypes = new Set<RoomBroadcast["type"]>(["place.liked", "comment.created", "photo.ready", "report.created", "heartbeat"]);

  if (!allowedTypes.has(type as RoomBroadcast["type"]) || eventScope !== scope || eventRoomId !== roomId || !isRecord(payload) || typeof createdAt !== "string") {
    throw new HttpError(400, "REALTIME_EVENT_INVALID", "실시간 이벤트 형식이 올바르지 않습니다.");
  }

  return {
    type: type as RoomBroadcast["type"],
    scope,
    roomId,
    payload,
    createdAt,
  };
}

async function listPlaces(url: URL, env: Env): Promise<Response> {
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);
  const bbox = parseBBox(url.searchParams.get("bbox"));
  const radiusSearch = parseRadiusSearch(url.searchParams.get("lat"), url.searchParams.get("lng"), url.searchParams.get("radius"));
  const spatialBBox = intersectBBoxes(bbox, radiusSearch?.bbox ?? null);
  const spatialConflict = Boolean(bbox && radiusSearch && !spatialBBox);
  const d1Limit = radiusSearch ? Math.min(200, Math.max(limit * 4, limit)) : limit;
  const regionId = url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const areaId = url.searchParams.get("area") ?? url.searchParams.get("areaId");
  const categoryId = url.searchParams.get("category") ?? url.searchParams.get("categoryId");
  const query = url.searchParams.get("q")?.trim().toLocaleLowerCase("ko-KR");

  if (spatialConflict) {
    return json([], {
      limit,
      bboxApplied: true,
      radiusApplied: true,
      radiusMeters: radiusSearch?.radiusMeters,
      storage: env.DB ? "d1" : "memory-fallback",
    });
  }

  if (env.DB) {
    const { sql, values } = d1PlacesQuery({
      bbox: spatialBBox,
      regionId,
      areaId,
      categoryId,
      query,
      limit: d1Limit,
    });
    const { results = [] } = await env.DB.prepare(sql).bind(...values).all<D1PlaceRow>();
    const filtered = filterPlacesByRadius(results.map(d1PlaceRowToRecord), radiusSearch).slice(0, limit);

    return json(filtered, {
      limit,
      bboxApplied: Boolean(bbox),
      radiusApplied: Boolean(radiusSearch),
      radiusMeters: radiusSearch?.radiusMeters,
      storage: "d1",
    });
  }

  const filtered = filterPlacesByRadius(filterPlacesByBBox(seedPlaces, spatialBBox), radiusSearch)
    .filter((place) => !regionId || place.regionId === regionId)
    .filter((place) => !areaId || place.areaId === areaId)
    .filter((place) => !categoryId || place.categoryId === categoryId)
    .filter((place) => !query || place.name.toLocaleLowerCase("ko-KR").includes(query))
    .slice(0, limit);

  return json(filtered, {
    limit,
    bboxApplied: Boolean(bbox),
    radiusApplied: Boolean(radiusSearch),
    radiusMeters: radiusSearch?.radiusMeters,
    storage: "memory-fallback",
  });
}

async function getPlace(placeId: string, env: Env): Promise<Response> {
  if (env.DB) {
    const row = await env.DB
      .prepare(
        `${d1PlaceSelectSql()}
         WHERE p.id = ? AND p.is_active = 1 AND p.coordinate_status = 'verified' AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         LIMIT 1`,
      )
      .bind(placeId)
      .first<D1PlaceRow>();

    if (!row) {
      throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
    }

    return json(d1PlaceRowToRecord(row), { source: "d1" });
  }

  return json(findPlaceRecord(placeId), { source: "memory-fallback" });
}

async function getPlaceLive(placeId: string, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  const placeStatus = await resolvePlaceStatusData(place.id, env);

  if (env.DB) {
    const [likeCount, clickCount, commentCount, photoCount, recentReportCount] = await Promise.all([
      countD1Interactions(env.DB, "place", place.id),
      countD1Events(env.DB, place.id, "click"),
      countD1VisibleComments(env.DB, place.id),
      countD1VisiblePhotos(env.DB, place.id),
      countD1OpenReportsForTarget(env.DB, "place", place.id),
    ]);

    return json(
      {
        placeId: place.id,
        statusSummary: d1PlaceStatusSummary(commentCount, photoCount),
        likeCount,
        clickCount,
        commentCount,
        photoCount,
        recentReportCount,
        status: placeStatus.status,
        statusDetail: placeStatus,
        observedAt: placeStatus.observedAt,
        updatedAt: new Date().toISOString(),
        policy: "실시간 사용자 제보 기반이며 정보가 없으면 정보 없음으로 표시합니다.",
      },
      { source: "d1-user-reports-not-sensor-data" },
    );
  }

  return json(
    {
      placeId: place.id,
      statusSummary: placeStatusSummary(place),
      likeCount: placeLikeCounts.get(place.id) ?? 0,
      clickCount: placeClickCounts.get(place.id) ?? 0,
      commentCount: comments.filter((comment) => comment.placeId === place.id && !comment.hiddenAt && isActiveRecentContent(comment.createdAt)).length,
      photoCount: photos.filter((photo) => photo.placeId === place.id && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt)).length,
      recentReportCount: reports.filter((report) => report.targetId === place.id && report.status === "open").length,
      status: placeStatus.status,
      statusDetail: placeStatus,
      observedAt: placeStatus.observedAt,
      updatedAt: new Date().toISOString(),
      policy: "실시간 사용자 제보 기반이며 정보가 없으면 정보 없음으로 표시합니다.",
    },
    { source: "user-reports-not-sensor-data" },
  );
}

async function getPlaceStatus(placeId: string, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  return json(await resolvePlaceStatusData(place.id, env), {
    storage: env.DB ? "d1" : "memory",
    contractVersion: 2,
  });
}

async function resolvePlaceStatusData(placeId: string, env: Env): Promise<PlaceStatusData> {
  const now = new Date();
  if (env.DB) {
    return recomputeD1PlaceStatus(env.DB, placeId, now);
  }

  const currentSignals = liveSignals
    .filter((signal) => signal.placeId === placeId && isLiveSignalCurrent(signal, now))
    .map(publicLiveSignal);
  return {
    contractVersion: 2,
    placeId,
    dataMode: "demo",
    status: "insufficient",
    currentSignals,
    missingRequiredDimensions: [],
    conflictingDimensions: [],
    independentSourceCount: 0,
    confidenceScore: 0,
    reasonCodes: ["demo_data_not_eligible"],
    observedAt: latestObservedAt(currentSignals),
    computedAt: now.toISOString(),
  };
}

async function recomputeD1PlaceStatus(db: D1Database, placeId: string, now: Date): Promise<PlaceStatusData> {
  const [profileAssignment, currentSignals] = await Promise.all([
    loadD1DecisionProfile(db, placeId),
    loadD1CurrentSignals(db, placeId, now),
  ]);

  if (!profileAssignment) {
    return {
      contractVersion: 2,
      placeId,
      dataMode: "live",
      status: "insufficient",
      currentSignals: currentSignals.map(publicLiveSignal),
      missingRequiredDimensions: [],
      conflictingDimensions: [],
      independentSourceCount: 0,
      confidenceScore: 0,
      reasonCodes: ["decision_profile_missing"],
      observedAt: latestObservedAt(currentSignals),
      computedAt: now.toISOString(),
    };
  }

  const aggregated = aggregatePlaceSignals(currentSignals, profileAssignment.profile, now);
  const publicSignals = aggregated.currentSignals.map(publicLiveSignal);
  const signalExpiries = aggregated.currentSignals
    .map((signal) => signal.expiresAt)
    .filter((expiresAt): expiresAt is string => Boolean(expiresAt))
    .sort();
  await db
    .prepare(
      `INSERT INTO aggregated_place_status (
        place_id,
        decision_profile_id,
        status,
        confidence_score,
        current_signals_json,
        missing_dimensions_json,
        conflicting_dimensions_json,
        reason_codes_json,
        computed_at,
        expires_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(place_id) DO UPDATE SET
        decision_profile_id = excluded.decision_profile_id,
        status = excluded.status,
        confidence_score = excluded.confidence_score,
        current_signals_json = excluded.current_signals_json,
        missing_dimensions_json = excluded.missing_dimensions_json,
        conflicting_dimensions_json = excluded.conflicting_dimensions_json,
        reason_codes_json = excluded.reason_codes_json,
        computed_at = excluded.computed_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      placeId,
      profileAssignment.profileId,
      aggregated.status,
      aggregated.confidenceScore,
      JSON.stringify(publicSignals),
      JSON.stringify(aggregated.missingRequiredDimensions),
      JSON.stringify(aggregated.conflictingDimensions),
      JSON.stringify(aggregated.reasonCodes),
      aggregated.computedAt,
      signalExpiries[0] ?? null,
      aggregated.computedAt,
    )
    .run();

  return {
    contractVersion: 2,
    placeId,
    dataMode: "live",
    status: aggregated.status,
    currentSignals: publicSignals,
    missingRequiredDimensions: aggregated.missingRequiredDimensions,
    conflictingDimensions: aggregated.conflictingDimensions,
    independentSourceCount: aggregated.independentSourceCount,
    confidenceScore: aggregated.confidenceScore,
    reasonCodes: aggregated.reasonCodes,
    observedAt: latestObservedAt(aggregated.currentSignals),
    computedAt: aggregated.computedAt,
  };
}

async function loadD1DecisionProfile(
  db: D1Database,
  placeId: string,
): Promise<{ profileId: string; profile: DecisionProfile } | null> {
  const { results = [] } = await db
    .prepare(
      `SELECT
        dp.id AS profileId,
        dp.profile_key AS profileKey,
        dpd.dimension,
        dpd.required,
        dpd.importance,
        dpd.positive_value_codes_json AS positiveValueCodesJson,
        dpd.negative_value_codes_json AS negativeValueCodesJson
      FROM place_decision_profiles pdp
      JOIN decision_profiles dp ON dp.id = pdp.profile_id AND dp.enabled = 1
      JOIN decision_profile_dimensions dpd ON dpd.profile_id = dp.id
      WHERE pdp.place_id = ?
      ORDER BY dpd.dimension`,
    )
    .bind(placeId)
    .all<D1DecisionProfileDimensionRow>();
  const first = results[0];
  if (!first) {
    return null;
  }

  return {
    profileId: first.profileId,
    profile: {
      key: first.profileKey,
      dimensions: results.map((row) => ({
        dimension: row.dimension,
        required: row.required === 1,
        importance: row.importance,
        positiveValueCodes: parseStringArray(row.positiveValueCodesJson),
        negativeValueCodes: parseStringArray(row.negativeValueCodesJson),
      })),
    },
  };
}

async function loadD1CurrentSignals(db: D1Database, placeId: string, now: Date): Promise<LiveSignal[]> {
  const nowIso = now.toISOString();
  const { results = [] } = await db
    .prepare(
      `SELECT
        ls.id,
        ls.place_id AS placeId,
        ls.dimension,
        ls.value_code AS valueCode,
        ls.value_number AS valueNumber,
        ls.value_text AS valueText,
        ls.unit,
        ls.source_id AS sourceId,
        ls.source_type AS sourceType,
        ls.source_name AS sourceName,
        ls.attribution_text AS attributionText,
        ls.observed_at AS observedAt,
        ls.fetched_at AS fetchedAt,
        ls.expires_at AS expiresAt,
        ls.confidence_score AS confidenceScore,
        ls.is_estimated AS isEstimated,
        ls.evidence_type AS evidenceType,
        ls.evidence_id AS evidenceId,
        ls.actor_id AS actorId
      FROM live_signals ls
      JOIN data_sources ds ON ds.id = ls.source_id
      WHERE ls.place_id = ?
        AND ls.is_publicly_visible = 1
        AND ls.observed_at <= ?
        AND (ls.expires_at IS NULL OR ls.expires_at > ?)
        AND ls.source_type != 'official_static'
        AND ds.enabled = 1
        AND ds.commercial_use_status IN ('allowed', 'allowed_with_attribution')
        AND ds.health_status IN ('healthy', 'degraded')
      ORDER BY ls.observed_at DESC`,
    )
    .bind(placeId, nowIso, nowIso)
    .all<D1LiveSignalRow>();

  return results.map((row) => ({
    id: row.id,
    placeId: row.placeId,
    dimension: row.dimension,
    valueCode: row.valueCode,
    ...(row.valueNumber === null ? {} : { valueNumber: row.valueNumber }),
    ...(row.valueText === null ? {} : { valueText: row.valueText }),
    ...(row.unit === null ? {} : { unit: row.unit }),
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    ...(row.attributionText === null ? {} : { attributionText: row.attributionText }),
    observedAt: row.observedAt,
    fetchedAt: row.fetchedAt,
    ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt }),
    confidenceScore: row.confidenceScore,
    isEstimated: row.isEstimated === 1,
    isPubliclyVisible: true,
    ...(row.evidenceType === null ? {} : { evidenceType: row.evidenceType }),
    ...(row.evidenceId === null ? {} : { evidenceId: row.evidenceId }),
    ...(row.actorId === null ? {} : { metadata: { actorKey: row.actorId } }),
  }));
}

function publicLiveSignal(signal: LiveSignal): PublicLiveSignal {
  return {
    id: signal.id,
    placeId: signal.placeId,
    dimension: signal.dimension,
    valueCode: signal.valueCode,
    ...(signal.valueNumber === undefined ? {} : { valueNumber: signal.valueNumber }),
    ...(signal.valueText === undefined ? {} : { valueText: signal.valueText }),
    ...(signal.unit === undefined ? {} : { unit: signal.unit }),
    sourceId: signal.sourceId,
    sourceType: signal.sourceType,
    sourceName: signal.sourceName,
    ...(signal.attributionText === undefined ? {} : { attributionText: signal.attributionText }),
    observedAt: signal.observedAt,
    fetchedAt: signal.fetchedAt,
    ...(signal.expiresAt === undefined ? {} : { expiresAt: signal.expiresAt }),
    confidenceScore: signal.confidenceScore,
    isEstimated: signal.isEstimated,
    ...(signal.evidenceType === undefined ? {} : { evidenceType: signal.evidenceType }),
    isExpired: false,
  };
}

function latestObservedAt(signals: readonly Pick<LiveSignal, "observedAt">[]): string | null {
  return signals.map((signal) => signal.observedAt).sort().at(-1) ?? null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

async function clickPlace(request: Request, placeId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  const source = await placeClickSource(request);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = !(await hasRecentD1PlaceClick(env.DB, place.id, anonymousUserId));
    if (created) {
      await recordD1PlaceEvent(env.DB, place, anonymousUserId, "click", { source });
    }
    const clickCount = await countD1Events(env.DB, place.id, "click");

    return json(
      {
        placeId: place.id,
        clickCount,
        created,
      },
      { duplicatePolicy: "same-anonymous-user-place-counts-once-per-5-minutes", source, storage: "d1" },
    );
  }

  const now = Date.now();
  const userWindows = placeClickWindowsFor(session.id);
  const previous = userWindows.get(place.id);
  const created = !previous || now - previous >= 5 * 60_000;

  if (created) {
    userWindows.set(place.id, now);
    placeClickCounts.set(place.id, (placeClickCounts.get(place.id) ?? 0) + 1);
  }

  return json(
    {
      placeId: place.id,
      clickCount: placeClickCounts.get(place.id) ?? 0,
      created,
    },
    { duplicatePolicy: "same-anonymous-user-place-counts-once-per-5-minutes", source },
  );
}

async function placeClickSource(request: Request): Promise<PlaceClickSource> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return "worker_api";
  }

  const body = await readJson(request);
  const source = body.source;

  return isPlaceClickSource(source) ? source : "worker_api";
}

function isPlaceClickSource(value: unknown): value is PlaceClickSource {
  return value === "worker_api" || value === "detail" || value === "map_marker" || value === "ranking" || value === "search_result";
}

async function likePlace(placeId: string, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "place", place.id);
    if (created) {
      await recordD1PlaceEvent(env.DB, place, anonymousUserId, "like");
    }
    const likeCount = await countD1Interactions(env.DB, "place", place.id);
    if (created) {
      ctx.waitUntil(
        broadcastPlaceActivity(env, "place.liked", place, {
          placeId: place.id,
          regionId: place.regionId,
          areaId: place.areaId,
          likeCount,
        }),
      );
    }

    return json({ placeId: place.id, likeCount, created }, { storage: "d1" });
  }

  const created = registerUniquePlaceLike(likeStateFor(session.id), place.id);
  if (created) {
    placeLikeCounts.set(place.id, (placeLikeCounts.get(place.id) ?? 0) + 1);
    ctx.waitUntil(
      broadcastPlaceActivity(env, "place.liked", place, {
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
        likeCount: placeLikeCounts.get(place.id) ?? 0,
      }),
    );
  }

  return json({ placeId: place.id, likeCount: placeLikeCounts.get(place.id) ?? 0, created });
}

async function unlikePlace(placeId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    const existing = await getD1InteractionId(env.DB, anonymousUserId, "place", place.id);
    if (existing) {
      await env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(existing).run();
    }
    const likeCount = await countD1Interactions(env.DB, "place", place.id);

    return json({ placeId: place.id, likeCount, deleted: Boolean(existing) }, { storage: "d1" });
  }

  const deleted = unregisterUniquePlaceLike(likeStateFor(session.id), place.id);
  if (deleted) {
    placeLikeCounts.set(place.id, Math.max(0, (placeLikeCounts.get(place.id) ?? 0) - 1));
  }

  return json({ placeId: place.id, likeCount: placeLikeCounts.get(place.id) ?? 0, deleted });
}

async function rankingCacheKey(
  env: Env,
  route: RankingRoute["kind"],
  regionId: string | null,
  areaId: string | null,
  categoryId: string | null,
  bbox: BBox | null,
  limit: number,
): Promise<string | null> {
  if (!env.CACHE) {
    return null;
  }

  const version = (await env.CACHE.get(RANKING_CACHE_VERSION_KEY)) ?? DEFAULT_RANKING_CACHE_VERSION;
  const bboxPart = bbox ? `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}` : "none";
  const parts = [
    "rankings",
    "v",
    version,
    `route=${route}`,
    `region=${regionId ?? "all"}`,
    `area=${areaId ?? "all"}`,
    `category=${categoryId ?? "all"}`,
    `bbox=${bboxPart}`,
    `limit=${limit}`,
  ];

  return parts.map((part) => encodeURIComponent(part)).join(":");
}

async function readRankingCache(env: Env, cacheKey: string | null): Promise<RankingCacheEntry | null> {
  if (!cacheKey || !env.CACHE) {
    return null;
  }

  const raw = await env.CACHE.get(cacheKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return rankingCacheEntry(parsed);
  } catch {
    return null;
  }
}

async function writeRankingCache(
  env: Env,
  cacheKey: string | null,
  data: RankingRecord[],
  meta: Record<string, unknown>,
): Promise<void> {
  if (!cacheKey || !env.CACHE) {
    return;
  }

  await env.CACHE.put(cacheKey, JSON.stringify({ data, meta }), {
    expirationTtl: RANKING_CACHE_TTL_SECONDS,
  });
}

function rankingCacheEntry(value: unknown): RankingCacheEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const data = value.data;
  const meta = value.meta;
  if (!Array.isArray(data) || !data.every(isRankingRecord) || !isRecord(meta)) {
    return null;
  }

  return { data, meta };
}

function isRankingRecord(value: unknown): value is RankingRecord {
  return (
    isRecord(value) &&
    typeof value.placeId === "string" &&
    typeof value.name === "string" &&
    typeof value.regionId === "string" &&
    typeof value.regionCode === "string" &&
    typeof value.areaCode === "string" &&
    typeof value.category === "string" &&
    typeof value.score === "number" &&
    typeof value.rank === "number" &&
    typeof value.windowHours === "number" &&
    typeof value.clickCount === "number" &&
    typeof value.likeCount === "number" &&
    typeof value.commentCount === "number" &&
    typeof value.photoCount === "number" &&
    typeof value.reportCount === "number" &&
    typeof value.uniqueUserCount === "number" &&
    (value.trend === "up" || value.trend === "down" || value.trend === "same") &&
    typeof value.summary === "string"
  );
}

async function listRankings(url: URL, path: string, env: Env): Promise<Response> {
  const route = parseRankingRoute(path);
  const regionId = route.regionId ?? url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const areaId = route.areaId ?? url.searchParams.get("area") ?? url.searchParams.get("areaId");
  const categoryId = route.categoryId ?? url.searchParams.get("category") ?? url.searchParams.get("categoryId");
  const bbox = parseBBox(url.searchParams.get("bbox"));
  const limit = clampLimit(url.searchParams.get("limit"), MAX_REGION_RANKING_LIMIT, 10);
  const cacheKey = await rankingCacheKey(env, route.kind, regionId, areaId, categoryId, bbox, limit);
  const cached = await readRankingCache(env, cacheKey);
  if (cached) {
    return json(cached.data, {
      ...cached.meta,
      cacheStatus: "hit",
      cacheTtlSeconds: RANKING_CACHE_TTL_SECONDS,
    });
  }

  if (env.DB) {
    const db = env.DB;
    const { sql, values, limit: d1Limit } = d1PlacesQuery({
      bbox,
      regionId,
      areaId,
      categoryId,
      query: null,
      limit,
      requireRankingSignal: true,
    });
    const { results = [] } = await db.prepare(sql).bind(...values).all<D1PlaceRow>();
    const rankings: RankingRecord[] = await Promise.all(
      results.map(async (row, index) => rankingRecordForPlace(d1PlaceRowToRecord(row), index + 1, await d1RankingCounts(db, row.id))),
    );
    const meta = {
      limit: d1Limit,
      regionId: regionId ?? "all",
      areaId: areaId ?? null,
      categoryId: categoryId ?? null,
      route: route.kind,
      storage: "d1",
      cachePolicy: "60s ranking KV cache",
    };
    await writeRankingCache(env, cacheKey, rankings, meta);

    return json(rankings, { ...meta, cacheStatus: cacheKey ? "miss" : "disabled", cacheTtlSeconds: cacheKey ? RANKING_CACHE_TTL_SECONDS : null });
  }

  const scopedPlaces = filterPlacesByBBox(seedPlaces, bbox)
    .filter((place) => !areaId || place.areaId === areaId)
    .filter((place) => !categoryId || place.categoryId === categoryId);
  const ranked = rankRegionPlaces(scopedPlaces, regionId, limit);
  const rankings: RankingRecord[] = ranked.map((place, index) => rankingRecordForPlace(place, index + 1, memoryRankingCounts(place.id)));
  const meta = {
    limit: rankings.length,
    regionId: regionId ?? "all",
    areaId: areaId ?? null,
    categoryId: categoryId ?? null,
    route: route.kind,
    cachePolicy: "60s ranking KV cache",
  };
  await writeRankingCache(env, cacheKey, rankings, meta);

  return json(rankings, { ...meta, cacheStatus: cacheKey ? "miss" : "disabled", cacheTtlSeconds: cacheKey ? RANKING_CACHE_TTL_SECONDS : null });
}

async function listPosts(url: URL, session: AnonymousSession, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const regionId = url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const hashtagName = normalizeHashtagName(url.searchParams.get("hashtagName") ?? "");
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);

  if (env.DB) {
    const currentAnonymousUserId = await anonymousUserIdForSession(session);
    const where = [
      "po.status = 'visible'",
      "po.hidden_at IS NULL",
      "pl.is_active = 1",
      "pl.coordinate_status = 'verified'",
      `NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_anonymous_user_id = ?
          AND ub.blocked_anonymous_user_id = po.anonymous_user_id
      )`,
    ];
    const values: D1Value[] = [currentAnonymousUserId];
    if (placeId) {
      where.push("po.place_id = ?");
      values.push(placeId);
    }
    if (regionId) {
      where.push("pl.region_id = ?");
      values.push(regionId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          po.id,
          po.place_id AS placeId,
          po.anonymous_user_id AS anonymousUserId,
          po.creator_name AS creatorName,
          po.creator_badge AS creatorBadge,
          po.caption,
          po.crowd_level AS crowdLevel,
          po.parking_status AS parkingStatus,
          po.line_status AS lineStatus,
          po.weather_feel AS weatherFeel,
          po.location_verified AS locationVerified,
          po.verified_radius_m AS verifiedRadiusM,
          po.photo_count AS photoCount,
          po.photo_label AS photoLabel,
          po.helpful_count AS helpfulCount,
          po.comment_count AS commentCount,
          po.hashtag_names AS hashtagNames,
          po.hidden_at AS hiddenAt,
          po.created_at AS createdAt
        FROM posts po
        INNER JOIN places pl ON pl.id = po.place_id
        WHERE ${where.join(" AND ")}
        ORDER BY po.created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1PostRow>();
    const filtered = results.map(d1PostRowToRecord).filter((post) => !hashtagName || post.hashtagNames.includes(hashtagName));
    const data = await Promise.all(filtered.map((post) => publicPostWithResolvedPlace(post, env)));

    return json(rankPostsForFeed(data).slice(0, limit), { limit, regionId: regionId ?? "all", storage: "d1" });
  }

  const filtered = posts
    .filter((post) => !post.hiddenAt)
    .filter((post) => !placeId || post.placeId === placeId)
    .filter((post) => !regionId || findPlaceRecord(post.placeId).regionId === regionId)
    .filter((post) => !hashtagName || post.hashtagNames.includes(hashtagName));
  const data = filtered.map((post) => publicPost(post, findPlaceRecord(post.placeId)));

  return json(rankPostsForFeed(data).slice(0, limit), { limit, regionId: regionId ?? "all", storage: "memory-fallback" });
}

async function createPost(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const crowdLevel = enumField(body, "crowdLevel", fieldReportCrowdLevels);
  const lineStatus = enumField(body, "lineStatus", fieldReportLineStatuses);
  const parkingStatus = enumField(body, "parkingStatus", fieldReportParkingStatuses);
  const weatherFeel = enumField(body, "weatherFeel", fieldReportWeatherFeels);
  const caption = optionalStringField(body, "caption", 120) ?? null;
  const photoCount = integerField(body, "photoCount", 0, 4, 0);
  const requestedHashtags = hashtagNamesField(body, "hashtagNames", 5);
  const clientLocation = optionalClientLocationField(body);
  if (caption) {
    const rejectionReason = commentBodyRejectionReason(caption);
    if (rejectionReason) {
      throw new HttpError(400, "POST_CAPTION_REJECTED", "제보 글에 공개할 수 없는 정보나 스팸 패턴이 포함되어 있습니다.", { reason: rejectionReason });
    }
  }

  const place = await resolvePlaceRecord(placeId, env);
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }
  const verifiedRadiusM = verifiedRadiusForFieldReport(place, clientLocation);
  const createdAt = new Date().toISOString();
  const recommendedHashtags = recommendPostHashtags({ place, crowdLevel, parkingStatus, lineStatus, weatherFeel });
  const hashtagNames = uniqueHashtagNames([...requestedHashtags, ...recommendedHashtags]).slice(0, 5);
  const post: PostRecord = {
    id: `post_${crypto.randomUUID()}`,
    placeId: place.id,
    anonymousUserId,
    creatorName: "익명 현장러",
    creatorBadge: creatorBadgeForPlace(place),
    caption,
    crowdLevel,
    parkingStatus,
    lineStatus,
    weatherFeel,
    locationVerified: Boolean(verifiedRadiusM),
    verifiedRadiusM,
    photoCount,
    photoLabel: photoCount > 0 ? `${place.name} 현장 사진` : "상태 제보",
    helpfulCount: 0,
    commentCount: 0,
    hashtagNames,
    hiddenAt: null,
    createdAt,
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO posts
          (id, place_id, anonymous_user_id, creator_name, creator_badge, caption, crowd_level, parking_status, line_status, weather_feel, location_verified, verified_radius_m, photo_count, photo_label, helpful_count, comment_count, hashtag_names, status, hidden_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'visible', NULL, ?, ?)`,
      )
      .bind(
        post.id,
        post.placeId,
        post.anonymousUserId,
        post.creatorName,
        post.creatorBadge,
        post.caption,
        post.crowdLevel,
        post.parkingStatus,
        post.lineStatus,
        post.weatherFeel,
        post.locationVerified ? 1 : 0,
        post.verifiedRadiusM,
        post.photoCount,
        post.photoLabel,
        JSON.stringify(post.hashtagNames),
        post.createdAt,
        post.createdAt,
      )
      .run();
    await recordD1PlaceEvent(env.DB, place, anonymousUserId, "report", {
      source: "field_report",
      crowdLevel,
      lineStatus,
      parkingStatus,
      verifiedRadiusM,
      createdAt,
      expiresAt: new Date(new Date(createdAt).getTime() + REPORT_TTL_MS).toISOString(),
    });
    ctx.waitUntil(
      broadcastPlaceActivity(env, "report.created", place, {
        id: post.id,
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
      }),
    );

    return json(postSubmitResponse(post, place, recommendedHashtags), { anonymousUserPolicy: "hashed-session-id", storage: "d1" }, 201);
  }

  posts.unshift(post);
  ctx.waitUntil(
    broadcastPlaceActivity(env, "report.created", place, {
      id: post.id,
      placeId: place.id,
      regionId: place.regionId,
      areaId: place.areaId,
    }),
  );

  return json(postSubmitResponse(post, place, recommendedHashtags), { anonymousUserPolicy: "header-or-cookie-session", storage: "memory-fallback" }, 201);
}

async function listHashtags(env: Env): Promise<Response> {
  const sourcePosts = env.DB
    ? await listD1PostsForHashtags(env.DB)
    : posts.filter((post) => !post.hiddenAt);
  const data = hashtagRecordsForPosts(sourcePosts);

  return json(data, { limit: data.length, storage: env.DB ? "d1" : "memory-fallback" });
}

async function listQuestions(url: URL, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const regionId = url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);

  if (env.DB) {
    const where = ["pl.is_active = 1", "pl.coordinate_status = 'verified'"];
    const values: D1Value[] = [];
    if (placeId) {
      where.push("q.place_id = ?");
      values.push(placeId);
    }
    if (regionId) {
      where.push("pl.region_id = ?");
      values.push(regionId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          q.id,
          q.place_id AS placeId,
          q.anonymous_user_id AS anonymousUserId,
          q.question_type AS questionType,
          q.body,
          q.credit_cost AS creditCost,
          q.answered_report_id AS answeredReportId,
          q.status,
          q.created_at AS createdAt
        FROM questions q
        INNER JOIN places pl ON pl.id = q.place_id
        WHERE ${where.join(" AND ")}
        ORDER BY q.created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1QuestionRow>();

    return json(results.map(publicQuestion), { limit, regionId: regionId ?? "all", storage: "d1" });
  }

  const data = questions
    .filter((question) => !placeId || question.placeId === placeId)
    .filter((question) => !regionId || findPlaceRecord(question.placeId).regionId === regionId)
    .slice(0, limit)
    .map(publicQuestion);

  return json(data, { limit, regionId: regionId ?? "all", storage: "memory-fallback" });
}

async function createQuestion(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const questionType = enumField(body, "questionType", questionTypes);
  const questionBody = stringField(body, "body", 160);
  const availableCredits = integerField(body, "availableCredits", 0, 999, 3);
  if (questionBody.length < 4) {
    throw new HttpError(400, "VALIDATION_ERROR", "body 값이 올바르지 않습니다.");
  }
  const rejectionReason = commentBodyRejectionReason(questionBody);
  if (rejectionReason) {
    throw new HttpError(400, "QUESTION_BODY_REJECTED", "질문에 공개할 수 없는 정보나 스팸 패턴이 포함되어 있습니다.", { reason: rejectionReason });
  }

  const place = await resolvePlaceRecord(placeId, env);
  const creditCost = questionCreditCost(questionType);
  if (availableCredits < creditCost) {
    throw new HttpError(402, "INSUFFICIENT_CREDITS", "질문권이 부족합니다.", {
      requiredCredits: creditCost,
      availableCredits,
    });
  }
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const question: QuestionRecord = {
    id: `question_${crypto.randomUUID()}`,
    placeId: place.id,
    anonymousUserId,
    questionType,
    body: questionBody,
    creditCost,
    answeredReportId: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO questions
          (id, place_id, anonymous_user_id, question_type, body, credit_cost, answered_report_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      )
      .bind(question.id, question.placeId, question.anonymousUserId, question.questionType, question.body, question.creditCost, question.createdAt)
      .run();

    return json(questionSubmitResponse(question, availableCredits), { anonymousUserPolicy: "hashed-session-id", storage: "d1" }, 201);
  }

  questions.unshift(question);

  return json(questionSubmitResponse(question, availableCredits), { anonymousUserPolicy: "header-or-cookie-session", storage: "memory-fallback" }, 201);
}

async function listMyQuestions(session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          anonymous_user_id AS anonymousUserId,
          question_type AS questionType,
          body,
          credit_cost AS creditCost,
          answered_report_id AS answeredReportId,
          status,
          created_at AS createdAt
        FROM questions
        WHERE anonymous_user_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      )
      .bind(anonymousUserId)
      .all<D1QuestionRow>();

    return json(results.map(publicMyQuestion), { limit: results.length, storage: "d1" });
  }

  const data = questions.filter((question) => question.anonymousUserId === session.id).map(publicMyQuestion);

  return json(data, { limit: data.length, storage: "memory-fallback" });
}

async function listComments(url: URL, session: AnonymousSession, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const limit = clampLimit(url.searchParams.get("limit"));
  if (env.DB) {
    const currentAnonymousUserId = await anonymousUserIdForSession(session);
    const where = [
      "c.status = 'visible'",
      "c.hidden_at IS NULL",
      "c.deleted_at IS NULL",
      `c.created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`,
      `NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_anonymous_user_id = ?
          AND ub.blocked_anonymous_user_id = c.anonymous_user_id
      )`,
    ];
    const values: D1Value[] = [currentAnonymousUserId];
    if (placeId) {
      where.push("c.place_id = ?");
      values.push(placeId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          anonymous_user_id AS anonymousUserId,
          body,
          like_count AS likeCount,
          hidden_at AS hiddenAt,
          created_at AS createdAt
        FROM comments c
        WHERE ${where.join(" AND ")}
        ORDER BY c.created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1CommentRow>();

    return json(results.map((comment) => publicComment(comment, currentAnonymousUserId)), { limit, storage: "d1" });
  }

  const data = comments
    .filter((comment) => !comment.hiddenAt)
    .filter((comment) => isActiveRecentContent(comment.createdAt))
    .filter((comment) => !placeId || comment.placeId === placeId)
    .slice(0, limit);

  return json(data.map((comment) => publicComment(comment, session.id)), { limit });
}

async function createComment(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const commentBody = commentBodyField(body);
  const place = await resolvePlaceRecord(placeId, env);

  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const comment: CommentRecord = {
    id: `comment_${crypto.randomUUID()}`,
    placeId,
    anonymousUserId,
    body: commentBody,
    likeCount: 0,
    hiddenAt: null,
    createdAt: new Date().toISOString(),
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO comments
          (id, place_id, anonymous_user_id, body, status, like_count, hidden_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'visible', 0, NULL, ?, ?)`,
      )
      .bind(comment.id, place.id, comment.anonymousUserId, comment.body, comment.createdAt, comment.createdAt)
      .run();
    await recordD1PlaceEvent(env.DB, place, comment.anonymousUserId, "comment");
    ctx.waitUntil(
      broadcastPlaceActivity(env, "comment.created", place, {
        id: comment.id,
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
      }),
    );

    return json(publicComment(comment, anonymousUserId), { anonymousUserPolicy: "server-only-hashed-session-id", storage: "d1" }, 201);
  }

  comments.unshift(comment);
  ctx.waitUntil(
    broadcastPlaceActivity(env, "comment.created", place, {
      id: comment.id,
      placeId: place.id,
      regionId: place.regionId,
      areaId: place.areaId,
    }),
  );

  return json(publicComment(comment, session.id), { anonymousUserPolicy: "server-only-session" }, 201);
}

async function likeComment(commentId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const comment = await getD1VisibleComment(env.DB, commentId);
    if (!comment) {
      return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "comment", commentId);
    const likeCount = await countD1Interactions(env.DB, "comment", commentId);
    if (created) {
      await env.DB.prepare("UPDATE comments SET like_count = ?, updated_at = ? WHERE id = ?").bind(likeCount, new Date().toISOString(), commentId).run();
    }

    return json({ commentId, likeCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once", storage: "d1" });
  }

  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment || comment.hiddenAt) {
    return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  }

  const state = likeStateFor(session.id);
  const created = registerUniqueCommentLike(state, commentId);
  if (created) {
    comment.likeCount += 1;
  }

  return json({ commentId, likeCount: comment.likeCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once" });
}

async function deleteComment(commentId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const comment = await getD1VisibleComment(env.DB, commentId);
    if (!comment) {
      return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    if (comment.anonymousUserId !== anonymousUserId) {
      return errorResponse(403, "COMMENT_DELETE_FORBIDDEN", "내가 작성한 댓글만 삭제할 수 있습니다.");
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE comments SET status = 'deleted', hidden_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, now, commentId).run();

    return json({ commentId, deleted: true }, { storage: "d1" });
  }

  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment || comment.hiddenAt) {
    return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  }

  if (comment.anonymousUserId !== session.id) {
    return errorResponse(403, "COMMENT_DELETE_FORBIDDEN", "내가 작성한 댓글만 삭제할 수 있습니다.");
  }

  comment.hiddenAt = new Date().toISOString();

  return json({ commentId, deleted: true });
}

async function listPhotos(url: URL, session: AnonymousSession, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const limit = clampLimit(url.searchParams.get("limit"), 20, 20);
  if (env.DB) {
    const currentAnonymousUserId = await anonymousUserIdForSession(session);
    const where = ["status = 'ready'", "deleted_at IS NULL", "hidden_at IS NULL", `created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`];
    const values: D1Value[] = [];
    if (placeId) {
      where.push("place_id = ?");
      values.push(placeId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          anonymous_user_id AS anonymousUserId,
          r2_key AS storageKey,
          mime_type AS mimeType,
          byte_size AS byteSize,
          width,
          height,
          COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
          status,
          deleted_at AS deletedAt,
          created_at AS createdAt
        FROM photos
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1PhotoRow>();

    return json(results.map((photo) => photoToPublicPhoto(photo, url, env, currentAnonymousUserId)), { limit, order: "latest", storage: "d1" });
  }

  const data = photos
    .filter((photo) => photo.status === "ready" && !photo.deletedAt)
    .filter((photo) => isActiveRecentContent(photo.createdAt))
    .filter((photo) => !placeId || photo.placeId === placeId)
    .slice(0, limit);

  return json(data.map((photo) => photoToPublicPhoto(photo, url, env, session.id)), { limit, order: "latest" });
}

function photoToPublicPhoto(photo: PhotoRecord, requestUrl: URL, env: Env, currentAnonymousUserId: string): PublicPhotoRecord {
  return {
    id: photo.id,
    placeId: photo.placeId,
    mimeType: photo.mimeType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    clickCount: photo.clickCount,
    status: photo.status,
    createdAt: photo.createdAt,
    ownedByCurrentSession: photo.anonymousUserId === currentAnonymousUserId,
    previewUrl: env.PHOTOS ? new URL(`/api/photos/${encodeURIComponent(photo.id)}/file`, requestUrl.origin).toString() : null,
  };
}

async function createPhotoUploadUrl(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const mimeType = stringField(body, "mimeType", 40);
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }
  if (mimeType !== "image/webp" && mimeType !== "image/jpeg") {
    throw new HttpError(400, "PHOTO_MIME_TYPE", "WebP 또는 JPEG 사진만 업로드할 수 있습니다.");
  }

  const now = new Date();
  const uploadId = `upload_${crypto.randomUUID()}`;
  const extension = mimeType === "image/jpeg" ? "jpg" : "webp";
  const storageKey = `photos/${place.regionId}/${place.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extension}`;

  return json(
    {
      uploadId,
      method: "PUT",
      uploadUrl: "/api/photos/complete",
      storageKey,
      headers: {
        "content-type": mimeType,
        "x-silsigan-anon-id": session.id,
      },
    },
    {
      r2Policy: {
        maxBytes: 3 * 1024 * 1024,
        maxDimension: 1280,
        originalFilenameStored: false,
        gpsExifStripped: true,
        processing: "worker-strips-metadata-before-r2-put",
      },
    },
    201,
  );
}

async function completePhoto(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const uploadId = stringField(body, "uploadId", 100);
  const placeId = stringField(body, "placeId", 80);
  const place = await resolvePlaceRecord(placeId, env);
  const requestedMimeType = stringField(body, "mimeType", 40) as PhotoRecord["mimeType"];
  const requestedByteSize = numberField(body, "byteSize");
  const requestedWidth = numberField(body, "width");
  const requestedHeight = numberField(body, "height");
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const result = validatePhotoComplete({
    uploadId,
    placeId,
    regionCode: place.regionId,
    byteSize: requestedByteSize,
    mimeType: requestedMimeType,
    width: requestedWidth,
    height: requestedHeight,
    clientReencoded: booleanField(body, "clientReencoded"),
    originalFilename: optionalStringField(body, "originalFilename", 255),
  });
  const sanitizedPhoto = env.PHOTOS
    ? await processPhotoForR2(
        optionalStringField(body, "imageBase64", Math.ceil(PHOTO_MAX_BYTES * 1.4)) ?? null,
        result.storageKey,
        requestedMimeType,
        requestedWidth,
        requestedHeight,
        env,
      )
    : null;
  const byteSize = sanitizedPhoto?.sanitizedBytes ?? requestedByteSize;
  const mimeType = sanitizedPhoto?.mimeType ?? requestedMimeType;
  const imageHash = sanitizedPhoto ? await photoContentHash(sanitizedPhoto) : null;
  const moderationRequired = Boolean(env.DB);

  const photo: PhotoRecord = {
    id: `photo_${crypto.randomUUID()}`,
    placeId,
    anonymousUserId,
    storageKey: result.storageKey,
    mimeType,
    byteSize,
    width: requestedWidth,
    height: requestedHeight,
    clickCount: 0,
    status: moderationRequired ? "pending" : "ready",
    deletedAt: null,
    createdAt: new Date().toISOString(),
  };

  if (env.PHOTOS) {
    if (!sanitizedPhoto) {
      throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "R2 저장에는 정화할 이미지 파일이 필요합니다.");
    }

    if (imageHash) {
      const duplicate = env.DB ? await findD1DuplicatePhoto(env.DB, imageHash) : findMemoryDuplicatePhoto(imageHash);
      if (duplicate) {
        throw duplicatePhotoError(duplicate);
      }
    }

    await env.PHOTOS.put(result.storageKey, arrayBufferForBytes(sanitizedPhoto.bytes), {
      httpMetadata: { contentType: photo.mimeType },
      customMetadata: {
        placeId,
        uploadId,
        originalFilenameStored: "false",
        metadataRemoved: sanitizedPhoto.metadataRemoved ? "true" : "none-found",
        serverPixelReencoded: sanitizedPhoto.pixelsReencoded ? "true" : "false",
        gpsExifStripped: "true",
        processing: sanitizedPhoto.processing,
        originalBytes: String(sanitizedPhoto.originalBytes),
        sanitizedBytes: String(sanitizedPhoto.sanitizedBytes),
      },
    });
  }

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO photos
          (id, place_id, anonymous_user_id, r2_key, mime_type, byte_size, width, height, image_hash, duplicate_status, status, deleted_at, hidden_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(
        photo.id,
        photo.placeId,
        photo.anonymousUserId,
        photo.storageKey,
        photo.mimeType,
        photo.byteSize,
        photo.width,
        photo.height,
        imageHash,
        imageHash ? "unique" : "unchecked",
        photo.status,
        photo.createdAt,
      )
      .run();
    await env.DB.prepare(`
      INSERT INTO photo_moderation_states (
        photo_id,
        status,
        automated_checks_json,
        risk_flags_json,
        created_at,
        updated_at
      ) VALUES (?, 'pending_moderation', ?, ?, ?, ?)
    `).bind(
      photo.id,
      JSON.stringify({
        mimeAndMagicBytes: "passed",
        sizeAndDimensions: "passed",
        metadataRemoved: sanitizedPhoto?.metadataRemoved ?? false,
        pixelsReencoded: sanitizedPhoto?.pixelsReencoded ?? false,
        duplicateCheck: imageHash ? "passed" : "not_available",
        malwareScan: "manual_required",
      }),
      JSON.stringify(["face_review_required", "plate_review_required", "content_safety_review_required"]),
      photo.createdAt,
      photo.createdAt,
    ).run();
  } else {
    photos.unshift(photo);
    if (imageHash) {
      photoContentHashes.set(photo.id, imageHash);
    }
  }
  if (photo.status === "ready") {
    ctx.waitUntil(
      broadcastPlaceActivity(env, "photo.ready", place, {
        id: photo.id,
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
      }),
    );
  }

  return json(
    {
      photo,
      storageKey: result.storageKey,
    },
    {
      r2Policy: result.policy,
      storage: env.DB ? "d1" : "memory-fallback",
      duplicatePolicy: imageHash ? "exact-sanitized-content-sha256-blocks-active-duplicates" : "metadata-only-not-checked",
      moderation: moderationRequired ? "pending_moderation" : "demo_auto_ready",
      photoSanitization: sanitizedPhoto
        ? {
            metadataRemoved: sanitizedPhoto.metadataRemoved,
            pixelsReencoded: sanitizedPhoto.pixelsReencoded,
            processing: sanitizedPhoto.processing,
            originalBytes: sanitizedPhoto.originalBytes,
            sanitizedBytes: sanitizedPhoto.sanitizedBytes,
            exifGpsStored: false,
          }
        : {
            metadataOnlyMode: true,
            exifGpsStored: false,
          },
    },
    201,
  );
}

async function processPhotoForR2(
  imageBase64: string | null,
  storageKey: string,
  mimeType: PhotoRecord["mimeType"],
  width: number,
  height: number,
  env: Env,
): Promise<SanitizedPhoto> {
  const metadataStripped = sanitizePhotoForR2(imageBase64, storageKey, mimeType);
  if (!env.IMAGES) {
    return metadataStripped;
  }

  return reencodePhotoWithImagesBinding(metadataStripped, env.IMAGES, width, height);
}

async function photoContentHash(photo: SanitizedPhoto): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferForBytes(photo.bytes));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

async function findD1DuplicatePhoto(db: D1Database, imageHash: string): Promise<DuplicatePhotoRecord | null> {
  return db
    .prepare(
      `SELECT id, place_id AS placeId
       FROM photos
       WHERE image_hash = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(imageHash)
    .first<DuplicatePhotoRecord>();
}

function findMemoryDuplicatePhoto(imageHash: string): DuplicatePhotoRecord | null {
  for (const [photoId, candidateHash] of photoContentHashes.entries()) {
    if (candidateHash !== imageHash) {
      continue;
    }

    const photo = photos.find((candidate) => candidate.id === photoId && !candidate.deletedAt);
    if (photo) {
      return { id: photo.id, placeId: photo.placeId };
    }
  }

  return null;
}

function duplicatePhotoError(duplicate: DuplicatePhotoRecord): HttpError {
  return new HttpError(409, "PHOTO_DUPLICATE", "이미 등록된 사진과 동일한 이미지입니다.", {
    duplicateOfPhotoId: duplicate.id,
    duplicatePlaceId: duplicate.placeId,
    policy: "exact-sanitized-content-sha256",
  });
}

function sanitizePhotoForR2(imageBase64: string | null, storageKey: string, mimeType: PhotoRecord["mimeType"]): SanitizedPhoto {
  if (!imageBase64) {
    throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "R2 저장에는 정화할 이미지 파일이 필요합니다.");
  }

  const original = decodeImageBase64(imageBase64);
  if (original.byteLength < 4 || original.byteLength > PHOTO_MAX_BYTES) {
    throw new HttpError(400, "PHOTO_SIZE_LIMIT", "사진 크기 제한을 초과했습니다.");
  }

  if (mimeType === "image/jpeg") {
    assertJpegBytes(original);
    const sanitized = stripJpegMetadata(original);
    return {
      bytes: sanitized.bytes,
      mimeType,
      originalBytes: original.byteLength,
      sanitizedBytes: sanitized.bytes.byteLength,
      metadataRemoved: sanitized.metadataRemoved,
      pixelsReencoded: false,
      processing: "worker-metadata-stripped",
    };
  }

  if (mimeType === "image/webp") {
    assertWebpBytes(original);
    const sanitized = stripWebpMetadata(original);
    return {
      bytes: sanitized.bytes,
      mimeType,
      originalBytes: original.byteLength,
      sanitizedBytes: sanitized.bytes.byteLength,
      metadataRemoved: sanitized.metadataRemoved,
      pixelsReencoded: false,
      processing: "worker-metadata-stripped",
    };
  }

  throw new HttpError(400, "PHOTO_MIME_TYPE", `${storageKey} 사진 형식을 처리할 수 없습니다.`);
}

async function reencodePhotoWithImagesBinding(
  photo: SanitizedPhoto,
  images: ImagesBinding,
  width: number,
  height: number,
): Promise<SanitizedPhoto> {
  const output = await images
    .input(arrayBufferForBytes(photo.bytes))
    .transform({
      width: Math.min(width, 1280),
      height: Math.min(height, 1280),
      fit: "scale-down",
    })
    .output({
      format: photo.mimeType === "image/jpeg" ? "image/jpeg" : "image/webp",
      quality: 82,
      anim: false,
    });
  const response = await output.response();
  if (!response.ok) {
    throw new HttpError(502, "PHOTO_REENCODE_FAILED", "서버 이미지 재인코딩에 실패했습니다.");
  }

  const reencoded = new Uint8Array(await response.arrayBuffer());
  if (reencoded.byteLength < 4 || reencoded.byteLength > PHOTO_MAX_BYTES) {
    throw new HttpError(400, "PHOTO_REENCODE_SIZE_LIMIT", "서버 재인코딩 사진 크기 제한을 초과했습니다.");
  }

  if (photo.mimeType === "image/jpeg") {
    assertJpegBytes(reencoded);
  } else {
    assertWebpBytes(reencoded);
  }

  return {
    bytes: reencoded,
    mimeType: photo.mimeType,
    originalBytes: photo.originalBytes,
    sanitizedBytes: reencoded.byteLength,
    metadataRemoved: photo.metadataRemoved,
    pixelsReencoded: true,
    processing: "cloudflare-images-reencoded",
  };
}

function decodeImageBase64(value: string): Uint8Array {
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const normalized = base64.replace(/\s/g, "");
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(normalized)) {
    throw new HttpError(400, "PHOTO_BASE64_INVALID", "사진 파일 인코딩이 올바르지 않습니다.");
  }

  let binary = "";
  try {
    binary = atob(normalized);
  } catch {
    throw new HttpError(400, "PHOTO_BASE64_INVALID", "사진 파일 인코딩이 올바르지 않습니다.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function assertJpegBytes(bytes: Uint8Array): void {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new HttpError(400, "PHOTO_MIME_SNIFF_FAILED", "JPEG 파일 헤더가 올바르지 않습니다.");
  }
}

function assertWebpBytes(bytes: Uint8Array): void {
  if (bytesToAscii(bytes, 0, 4) !== "RIFF" || bytesToAscii(bytes, 8, 12) !== "WEBP") {
    throw new HttpError(400, "PHOTO_MIME_SNIFF_FAILED", "WebP 파일 헤더가 올바르지 않습니다.");
  }
}

function stripJpegMetadata(bytes: Uint8Array): { bytes: Uint8Array; metadataRemoved: boolean } {
  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  let metadataRemoved = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.slice(offset));
      break;
    }

    let markerOffset = offset;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) {
      markerOffset += 1;
    }

    if (markerOffset >= bytes.length) {
      break;
    }

    const marker = bytes[markerOffset];
    const segmentStart = offset;
    const markerEnd = markerOffset + 1;
    offset = markerEnd;

    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.slice(segmentStart, markerEnd));
      continue;
    }

    if (markerEnd + 2 > bytes.length) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment가 올바르지 않습니다.");
    }

    const segmentLength = readUint16BE(bytes, markerEnd);
    if (segmentLength < 2) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment 길이가 올바르지 않습니다.");
    }

    const segmentEnd = markerEnd + segmentLength;
    if (segmentEnd > bytes.length) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment가 파일 범위를 벗어났습니다.");
    }

    if (marker === 0xda) {
      chunks.push(bytes.slice(segmentStart));
      break;
    }

    if (shouldStripJpegMarker(marker)) {
      metadataRemoved = true;
      offset = segmentEnd;
      continue;
    }

    chunks.push(bytes.slice(segmentStart, segmentEnd));
    offset = segmentEnd;
  }

  return { bytes: concatBytes(chunks), metadataRemoved };
}

function shouldStripJpegMarker(marker: number): boolean {
  if (marker === 0xfe) {
    return true;
  }

  if (marker >= 0xe1 && marker <= 0xed) {
    return true;
  }

  return marker === 0xef;
}

function stripWebpMetadata(bytes: Uint8Array): { bytes: Uint8Array; metadataRemoved: boolean } {
  const chunks: Uint8Array[] = [];
  let offset = 12;
  let metadataRemoved = false;

  while (offset + 8 <= bytes.length) {
    const chunkType = bytesToAscii(bytes, offset, offset + 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) {
      throw new HttpError(400, "PHOTO_WEBP_INVALID", "WebP chunk가 파일 범위를 벗어났습니다.");
    }

    if (chunkType === "EXIF" || chunkType === "XMP ") {
      metadataRemoved = true;
    } else {
      chunks.push(bytes.slice(offset, paddedEnd));
    }

    offset = paddedEnd;
  }

  if (offset !== bytes.length) {
    throw new HttpError(400, "PHOTO_WEBP_INVALID", "WebP 파일 끝이 올바르지 않습니다.");
  }

  const payload = concatBytes(chunks);
  const sanitized = new Uint8Array(12 + payload.byteLength);
  sanitized.set(asciiBytes("RIFF"), 0);
  writeUint32LE(sanitized, 4, sanitized.byteLength - 8);
  sanitized.set(asciiBytes("WEBP"), 8);
  sanitized.set(payload, 12);

  return { bytes: sanitized, metadataRemoved };
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }

  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function arrayBufferForBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function clickPhoto(photoId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const photo = await getD1VisiblePhoto(env.DB, photoId);
    if (!photo) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "photo", photoId);
    const clickCount = await countD1Interactions(env.DB, "photo", photoId);

    return json({ photoId, clickCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once", storage: "d1" });
  }

  const photo = photos.find((candidate) => candidate.id === photoId);
  if (!photo || photo.status !== "ready" || photo.deletedAt) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  const state = likeStateFor(session.id);
  const created = registerUniquePhotoClick(state, photoId);
  if (created) {
    photo.clickCount += 1;
  }

  return json({ photoId, clickCount: photo.clickCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once" });
}

async function servePhotoFile(photoId: string, env: Env): Promise<Response> {
  if (!env.PHOTOS) {
    return errorResponse(404, "PHOTO_FILE_NOT_AVAILABLE", "사진 파일을 찾을 수 없습니다.");
  }

  const photo = env.DB
    ? await getD1PublicRecentPhoto(env.DB, photoId)
    : photos.find((candidate) => candidate.id === photoId && candidate.status === "ready" && !candidate.deletedAt && isActiveRecentContent(candidate.createdAt));
  if (!photo) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  const object = await env.PHOTOS.get(photo.storageKey);
  if (!object) {
    return errorResponse(404, "PHOTO_FILE_NOT_FOUND", "사진 파일을 찾을 수 없습니다.");
  }

  return new Response(object.body, {
    headers: {
      ...corsHeaders(),
      "content-type": object.httpMetadata?.contentType ?? photo.mimeType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function deletePhoto(photoId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const photo = await getD1VisiblePhoto(env.DB, photoId);
    if (!photo) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    if (photo.anonymousUserId !== anonymousUserId) {
      return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
    }

    await env.DB.prepare("UPDATE photos SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), photoId).run();

    return json({ photoId, deleted: true }, { storage: "d1" });
  }

  const photo = photos.find((candidate) => candidate.id === photoId);
  if (!photo || photo.deletedAt) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  if (photo.anonymousUserId !== session.id) {
    return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
  }

  photo.deletedAt = new Date().toISOString();

  return json({ photoId, deleted: true });
}

async function createPublicReport(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  if (isModerationReportBody(body)) {
    return createModerationReportFromBody(body, session, env, ctx);
  }

  return createFieldReportFromBody(body, session, env, ctx);
}

async function voteOnFieldReport(
  reportId: string,
  request: Request,
  session: AnonymousSession,
  env: Env,
): Promise<Response> {
  const db = requireD1(env);
  if (!/^field_report_[a-zA-Z0-9-]{8,100}$/.test(reportId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "reportId 값이 올바르지 않습니다.");
  }
  const body = await readJson(request);
  const voteType = enumField(body, "voteType", ["agree", "changed"] as const);
  const anonymousUserId = await ensureD1AnonymousUser(db, session);
  await assertD1AnonymousUserCanWrite(db, anonymousUserId);
  const report = await db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        verified_radius_m AS verifiedRadiusM,
        expires_at AS expiresAt
      FROM place_events
      WHERE id = ? AND event_type = 'report' AND source = 'field_report'
      LIMIT 1`,
    )
    .bind(reportId)
    .first<D1FieldReportEventRow>();
  if (!report) {
    throw new HttpError(404, "FIELD_REPORT_NOT_FOUND", "현장 제보를 찾을 수 없습니다.");
  }
  if (report.anonymousUserId === anonymousUserId) {
    throw new HttpError(403, "SELF_REPORT_VOTE_FORBIDDEN", "내 제보에는 상태 확인 투표를 할 수 없습니다.");
  }
  if (!report.expiresAt || Date.parse(report.expiresAt) <= Date.now()) {
    throw new HttpError(409, "FIELD_REPORT_EXPIRED", "이미 만료된 제보에는 투표할 수 없습니다.");
  }
  const duplicate = await db
    .prepare("SELECT id FROM report_votes WHERE report_id = ? AND anonymous_user_id = ? LIMIT 1")
    .bind(report.id, anonymousUserId)
    .first<{ id: string }>();
  if (duplicate) {
    throw new HttpError(409, "REPORT_VOTE_ALREADY_EXISTS", "제보별 상태 확인 투표는 한 번만 할 수 있습니다.");
  }

  const place = await resolvePlaceRecord(report.placeId, env);
  const locationVerified = Boolean(verifiedRadiusForFieldReport(place, optionalClientLocationField(body)));
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO report_votes
        (id, report_id, anonymous_user_id, vote_type, location_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(`vote_${crypto.randomUUID()}`, report.id, anonymousUserId, voteType, locationVerified ? 1 : 0, createdAt)
    .run();

  const counts = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN vote_type = 'agree' THEN 1 ELSE 0 END) AS agreeCount,
        SUM(CASE WHEN vote_type = 'changed' THEN 1 ELSE 0 END) AS changedCount,
        SUM(CASE WHEN vote_type = 'changed' AND location_verified = 1 THEN 1 ELSE 0 END) AS verifiedChangedCount
      FROM report_votes
      WHERE report_id = ?`,
    )
    .bind(report.id)
    .first<{ agreeCount: number | null; changedCount: number | null; verifiedChangedCount: number | null }>();
  const agreeCount = counts?.agreeCount ?? 0;
  const changedCount = counts?.changedCount ?? 0;
  const verifiedChangedCount = counts?.verifiedChangedCount ?? 0;
  const invalidated = changedCount >= reportChangedVoteThreshold && verifiedChangedCount >= 1;
  if (invalidated) {
    await db.prepare("UPDATE place_events SET expires_at = ? WHERE id = ?").bind(createdAt, report.id).run();
    await db
      .prepare("UPDATE live_signals SET expires_at = ?, is_publicly_visible = 0 WHERE evidence_id = ?")
      .bind(createdAt, report.id)
      .run();
    await recomputeD1PlaceStatus(db, report.placeId, new Date(createdAt));
  }

  return json(
    {
      reportId: report.id,
      voteType,
      agreeCount,
      changedCount,
      invalidated,
    },
    {
      duplicatePolicy: "one-vote-per-anonymous-user-and-report",
      invalidationPolicy: "three-changed-votes-with-at-least-one-location-verified",
      locationPolicy: "clientLocation-used-only-for-distance-and-not-stored",
      storage: "d1",
    },
    201,
  );
}

async function listUserBlocks(session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const anonymousUserId = await anonymousUserIdForSession(session);
  const { results = [] } = await db
    .prepare(
      `SELECT id, created_at AS createdAt
       FROM user_blocks
       WHERE blocker_anonymous_user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .bind(anonymousUserId)
    .all<{ id: string; createdAt: string }>();

  return json(
    results.map((block) => ({ ...block, label: "차단한 사용자" })),
    { identityPolicy: "blocked-identities-are-never-exposed", storage: "d1" },
  );
}

async function blockContentCreator(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  const targetType = enumField(body, "targetType", ["post", "comment"] as const);
  const targetId = stringField(body, "targetId", 100);
  const blockerAnonymousUserId = await ensureD1AnonymousUser(db, session);
  await assertD1AnonymousUserCanWrite(db, blockerAnonymousUserId);
  const blockedAnonymousUserId = await resolveBlockTargetAnonymousUserId(db, targetType, targetId);
  if (!blockedAnonymousUserId) {
    throw new HttpError(404, "BLOCK_TARGET_NOT_FOUND", "차단할 콘텐츠를 찾을 수 없습니다.");
  }
  if (blockedAnonymousUserId === blockerAnonymousUserId) {
    throw new HttpError(400, "SELF_BLOCK_FORBIDDEN", "내 콘텐츠 작성자는 차단할 수 없습니다.");
  }
  const existing = await db
    .prepare(
      `SELECT id, created_at AS createdAt
       FROM user_blocks
       WHERE blocker_anonymous_user_id = ? AND blocked_anonymous_user_id = ?
       LIMIT 1`,
    )
    .bind(blockerAnonymousUserId, blockedAnonymousUserId)
    .first<{ id: string; createdAt: string }>();
  if (existing) {
    return json(
      { ...existing, targetType, targetId, blocked: true },
      { duplicatePolicy: "same-creator-block-counts-once", identityPolicy: "target-content-id-only", storage: "d1" },
    );
  }

  const block = {
    id: `block_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  await db
    .prepare(
      `INSERT INTO user_blocks
        (id, blocker_anonymous_user_id, blocked_anonymous_user_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(block.id, blockerAnonymousUserId, blockedAnonymousUserId, block.createdAt)
    .run();

  return json(
    { ...block, targetType, targetId, blocked: true },
    { identityPolicy: "target-content-id-only", storage: "d1" },
    201,
  );
}

async function unblockContentCreator(blockId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  if (!/^block_[a-zA-Z0-9-]{8,100}$/.test(blockId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "blockId 값이 올바르지 않습니다.");
  }
  const blockerAnonymousUserId = await anonymousUserIdForSession(session);
  const existing = await db
    .prepare("SELECT id FROM user_blocks WHERE id = ? AND blocker_anonymous_user_id = ? LIMIT 1")
    .bind(blockId, blockerAnonymousUserId)
    .first<{ id: string }>();
  if (!existing) {
    throw new HttpError(404, "USER_BLOCK_NOT_FOUND", "차단 내역을 찾을 수 없습니다.");
  }
  await db.prepare("DELETE FROM user_blocks WHERE id = ? AND blocker_anonymous_user_id = ?").bind(blockId, blockerAnonymousUserId).run();

  return json({ blockId, blocked: false }, { identityPolicy: "owner-only", storage: "d1" });
}

async function resolveBlockTargetAnonymousUserId(
  db: D1Database,
  targetType: "post" | "comment",
  targetId: string,
): Promise<string | null> {
  const table = targetType === "post" ? "posts" : "comments";
  const row = await db
    .prepare(
      `SELECT anonymous_user_id AS anonymousUserId
       FROM ${table}
       WHERE id = ? AND status = 'visible' AND hidden_at IS NULL
       LIMIT 1`,
    )
    .bind(targetId)
    .first<{ anonymousUserId: string }>();

  return row?.anonymousUserId ?? null;
}

async function deleteAnonymousAccount(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  if (stringField(body, "confirmation", 40) !== "DELETE_MY_ACCOUNT") {
    throw new HttpError(400, "ACCOUNT_DELETION_CONFIRMATION_REQUIRED", "계정 삭제 확인 문구가 올바르지 않습니다.");
  }
  const anonymousUserId = await ensureD1AnonymousUser(db, session);
  const completed = await db
    .prepare(
      `SELECT id
       FROM account_deletion_requests
       WHERE anonymous_user_id = ? AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
    )
    .bind(anonymousUserId)
    .first<{ id: string }>();
  if (completed) {
    return json({ deleted: true, actorType: "anonymous", alreadyCompleted: true }, { storage: "d1" });
  }
  await assertD1AnonymousUserCanWrite(db, anonymousUserId);

  const linkedProfile = await db
    .prepare(
      `SELECT p.id, p.status
       FROM identity_links il
       JOIN profiles p ON p.id = il.profile_id
       WHERE il.anonymous_user_id = ?
       LIMIT 1`,
    )
    .bind(anonymousUserId)
    .first<{ id: string; status: "active" | "restricted" | "deletion_requested" | "deleted" }>();
  let actorType: "anonymous" | "member" = "anonymous";
  if (linkedProfile) {
    const memberSubject = stringField(body, "memberSubject", 200);
    const expectedProfileId = await verifiedMemberProfileId(request, session, memberSubject, env, "account-deletion");
    if (expectedProfileId !== linkedProfile.id) {
      throw new HttpError(403, "MEMBER_IDENTITY_MISMATCH", "연결된 회원 계정 확인에 실패했습니다.");
    }
    actorType = "member";
  }

  const requestId = `deletion_${crypto.randomUUID()}`;
  const requestedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO account_deletion_requests
        (id, actor_type, anonymous_user_id, profile_id, status, requested_at)
       VALUES (?, ?, ?, ?, 'processing', ?)`,
    )
    .bind(requestId, actorType, anonymousUserId, linkedProfile?.id ?? null, requestedAt)
    .run();

  try {
    const { results: photoRows = [] } = await db
      .prepare("SELECT r2_key AS storageKey FROM photos WHERE anonymous_user_id = ?")
      .bind(anonymousUserId)
      .all<{ storageKey: string }>();
    const { results: placeRows = [] } = await db
      .prepare(
        `SELECT DISTINCT place_id AS placeId FROM place_events WHERE anonymous_user_id = ?
         UNION
         SELECT DISTINCT place_id AS placeId FROM live_signals WHERE actor_type = 'anonymous' AND actor_id = ?`,
      )
      .bind(anonymousUserId, anonymousUserId)
      .all<{ placeId: string }>();
    const now = new Date().toISOString();

    await db.prepare("UPDATE photos SET status = 'rejected', hidden_at = ?, deleted_at = ? WHERE anonymous_user_id = ?").bind(now, now, anonymousUserId).run();
    if (env.PHOTOS && photoRows.length > 0) {
      await env.PHOTOS.delete(photoRows.map((photo) => photo.storageKey));
    }
    await db.prepare("DELETE FROM report_votes WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM likes WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM user_blocks WHERE blocker_anonymous_user_id = ? OR blocked_anonymous_user_id = ?").bind(anonymousUserId, anonymousUserId).run();
    await db.prepare("DELETE FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM identity_links WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM consents WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM terms_acceptances WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM live_signals WHERE actor_type = 'anonymous' AND actor_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM place_events WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM reports WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM questions WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM posts WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM comments WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM photos WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    if (linkedProfile) {
      await db
        .prepare("UPDATE profiles SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, linkedProfile.id)
        .run();
    }
    await db
      .prepare("UPDATE account_deletion_requests SET status = 'completed', completed_at = ?, failure_code = NULL WHERE id = ?")
      .bind(now, requestId)
      .run();
    for (const place of placeRows) {
      await recomputeD1PlaceStatus(db, place.placeId, new Date(now));
    }

    return json(
      {
        deleted: true,
        actorType,
        removedPhotoCount: photoRows.length,
        alreadyCompleted: false,
      },
      {
        deletionPolicy: "owned-content-and-private-photo-objects-purged",
        storage: "d1",
      },
    );
  } catch {
    await db
      .prepare("UPDATE account_deletion_requests SET status = 'failed', failure_code = ? WHERE id = ?")
      .bind("ACCOUNT_DELETION_FAILED", requestId)
      .run();
    throw new HttpError(500, "ACCOUNT_DELETION_FAILED", "계정 삭제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function linkAnonymousIdentity(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  const memberSubject = stringField(body, "memberSubject", 200);
  const profileId = await verifiedMemberProfileId(request, session, memberSubject, env, "identity-link");
  const anonymousUserId = await ensureD1AnonymousUser(db, session);
  await assertD1AnonymousUserCanWrite(db, anonymousUserId);
  const existing = await db
    .prepare("SELECT profile_id AS profileId FROM identity_links WHERE anonymous_user_id = ? LIMIT 1")
    .bind(anonymousUserId)
    .first<{ profileId: string }>();
  if (existing && existing.profileId !== profileId) {
    throw new HttpError(409, "IDENTITY_ALREADY_LINKED", "이 익명 세션은 다른 회원 계정에 이미 연결되어 있습니다.");
  }
  if (existing) {
    return json({ linked: true, alreadyLinked: true }, { authn: "server-hmac", subjectStorage: "sha256-only", storage: "d1" });
  }

  const subjectHash = await memberSubjectHash(memberSubject);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO profiles (id, auth_subject, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)
       ON CONFLICT(auth_subject) DO NOTHING`,
    )
    .bind(profileId, subjectHash, now, now)
    .run();
  const profile = await db
    .prepare("SELECT id, status FROM profiles WHERE auth_subject = ? LIMIT 1")
    .bind(subjectHash)
    .first<{ id: string; status: string }>();
  if (!profile || profile.id !== profileId || profile.status === "deleted") {
    throw new HttpError(409, "MEMBER_PROFILE_UNAVAILABLE", "연결할 회원 계정을 사용할 수 없습니다.");
  }
  await db
    .prepare("INSERT INTO identity_links (anonymous_user_id, profile_id, linked_at) VALUES (?, ?, ?)")
    .bind(anonymousUserId, profile.id, now)
    .run();
  await db
    .prepare(
      `INSERT INTO identity_link_events
        (id, anonymous_user_id, profile_id, event_type, server_subject_hash, created_at)
       VALUES (?, ?, ?, 'linked', ?, ?)`,
    )
    .bind(`identity_event_${crypto.randomUUID()}`, anonymousUserId, profile.id, subjectHash, now)
    .run();

  return json(
    { linked: true, alreadyLinked: false },
    { authn: "server-hmac", subjectStorage: "sha256-only", storage: "d1" },
    201,
  );
}

async function verifiedMemberProfileId(
  request: Request,
  session: AnonymousSession,
  memberSubject: string,
  env: Env,
  action: "identity-link" | "account-deletion",
): Promise<string> {
  const secret = env.MEMBER_LINK_HMAC_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new HttpError(503, "MEMBER_LINK_SECRET_NOT_CONFIGURED", "회원 연결 서버 인증이 설정되지 않았습니다.");
  }
  const timestamp = request.headers.get("x-silsigan-link-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-silsigan-link-signature")?.trim().toLowerCase() ?? "";
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new HttpError(403, "MEMBER_LINK_SIGNATURE_INVALID", "회원 연결 서버 인증에 실패했습니다.");
  }
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > identityLinkMaxClockSkewMs) {
    throw new HttpError(403, "MEMBER_LINK_SIGNATURE_EXPIRED", "회원 연결 서버 인증 시간이 만료되었습니다.");
  }
  const expected = await hmacSha256Hex(secret, `${action}.${timestamp}.${session.id}.${memberSubject}`);
  if (!(await timingSafeEqualString(signature, expected))) {
    throw new HttpError(403, "MEMBER_LINK_SIGNATURE_INVALID", "회원 연결 서버 인증에 실패했습니다.");
  }

  const hash = await sha256Hex(`silsigan-member:${memberSubject}`);
  return `profile_${hash.slice(0, 48)}`;
}

async function memberSubjectHash(memberSubject: string): Promise<string> {
  return `sha256:${await sha256Hex(`silsigan-member:${memberSubject}`)}`;
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createModerationReport(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  return createModerationReportFromBody(await readJson(request), session, env, ctx);
}

async function createModerationReportFromBody(body: JsonObject, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const targetType = enumField(body, "targetType", ["place", "post", "comment", "photo"] as const);
  const targetId = stringField(body, "targetId", 100);
  const reason = enumField(body, "reason", ["false_content", "spam", "privacy_face", "privacy_plate", "sensitive_info", "other"] as const);
  const note = optionalStringField(body, "note", 200);
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  if (env.DB) {
    const duplicate = await env.DB
      .prepare(
        `SELECT
          id,
          target_type AS targetType,
          target_id AS targetId,
          reason,
          anonymous_user_id AS anonymousUserId,
          note,
          status,
          created_at AS createdAt
        FROM reports
        WHERE anonymous_user_id = ? AND target_type = ? AND target_id = ? AND reason = ? AND status = 'open'
        LIMIT 1`,
      )
      .bind(anonymousUserId, targetType, targetId, reason)
      .first<D1ReportRow>();
    if (duplicate) {
      return json(duplicate, { duplicatePolicy: "same-anonymous-user-open-report-counts-once", storage: "d1" }, 200);
    }
  }

  const place = await resolveReportTarget(targetType, targetId, env);

  const report: ReportRecord = {
    id: `report_${crypto.randomUUID()}`,
    targetType,
    targetId,
    reason,
    anonymousUserId,
    note: note ?? null,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO reports
          (id, target_type, target_id, anonymous_user_id, reason, note, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .bind(report.id, report.targetType, report.targetId, report.anonymousUserId, report.reason, report.note, report.createdAt)
      .run();
    const priority = d1ModerationPriority(reason);
    await env.DB
      .prepare("INSERT INTO moderation_reports (id, report_id, priority, decision, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
      .bind(`mod_${crypto.randomUUID()}`, report.id, priority, report.createdAt, report.createdAt)
      .run();
    await incrementD1ReportCounter(env.DB, targetType, targetId);
    await applyD1ProtectionForReport(env.DB, report);
    if (place) {
      await recordD1PlaceEvent(env.DB, place, report.anonymousUserId, "report");
    }
    ctx.waitUntil(
      place
        ? broadcastPlaceActivity(env, "report.created", place, {
            id: report.id,
            targetType,
            targetId,
            placeId: place.id,
            regionId: place.regionId,
            areaId: place.areaId,
          })
        : broadcastToRooms(env, "report.created", "global", "global", { id: report.id, targetType, targetId }),
    );
    const alertChannel = enqueueModerationAlert(ctx, env, report, priority);

    return json(report, { moderationPolicy: "open-reports-enter-d1-moderation-queue", storage: "d1", alertChannel }, 201);
  }

  reports.unshift(report);
  ctx.waitUntil(
    place
      ? broadcastPlaceActivity(env, "report.created", place, {
          id: report.id,
          targetType,
          targetId,
          placeId: place.id,
          regionId: place.regionId,
          areaId: place.areaId,
        })
      : broadcastToRooms(env, "report.created", "global", "global", { id: report.id, targetType, targetId }),
  );
  const alertChannel = enqueueModerationAlert(ctx, env, report, d1ModerationPriority(reason));

  return json(report, { moderationPolicy: "open-reports-require-admin-token", alertChannel }, 201);
}

async function createFieldReportFromBody(body: JsonObject, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const placeId = stringField(body, "placeId", 80);
  const category = enumField(body, "category", fieldReportCategories);
  const crowdLevel = optionalEnumField(body, "crowdLevel", fieldReportCrowdLevels);
  const legacyLineStatus = optionalEnumField(body, "lineStatus", fieldReportLineStatuses);
  const queueStatus = optionalEnumField(body, "queueStatus", fieldReportQueueStatuses);
  const legacyParkingStatus = optionalEnumField(body, "parkingStatus", fieldReportParkingStatuses);
  const parkingObservation = optionalEnumField(body, "parkingObservation", fieldReportParkingObservations);
  const lineStatus = legacyLineStatus ?? (queueStatus ? lineStatusFromQueueValue(queueStatus) : undefined);
  const parkingStatus = legacyParkingStatus ?? (parkingObservation ? legacyParkingStatusFromObservation(parkingObservation) : undefined);
  const weatherFeel = optionalEnumField(body, "weatherFeel", fieldReportWeatherFeels);
  const localConditions = optionalEnumArrayField(body, "localConditions", fieldReportLocalConditions);
  if (weatherFeel === "rainy" && !localConditions.includes("rain")) {
    localConditions.push("rain");
  }
  if (weatherFeel === "windy" && !localConditions.includes("strong_wind")) {
    localConditions.push("strong_wind");
  }
  const normalizedObservations = listObservedReportSignals({
    crowd: crowdLevel,
    queue: queueStatus ?? (lineStatus ? queueValueFromLineStatus(lineStatus) : undefined),
    parking: parkingObservation ?? parkingStatus,
    localConditions,
  });
  if (normalizedObservations.length === 0) {
    throw new HttpError(400, "REPORT_OBSERVATION_REQUIRED", "실제로 확인한 현장 상태를 하나 이상 선택해 주세요.");
  }
  const comment = optionalStringField(body, "comment", 120);
  const photoUrl = optionalHttpUrlField(body, "photoUrl", 2_048);
  const clientLocation = optionalClientLocationField(body);
  if (comment) {
    const rejectionReason = commentBodyRejectionReason(comment);
    if (rejectionReason) {
      throw new HttpError(400, "COMMENT_BODY_REJECTED", "제보 코멘트에 공개할 수 없는 정보나 스팸 패턴이 포함되어 있습니다.", { reason: rejectionReason });
    }
  }

  const place = await resolvePlaceRecord(placeId, env);
  if (category !== place.categoryId) {
    throw new HttpError(400, "CATEGORY_MISMATCH", "제보 카테고리가 장소 카테고리와 일치하지 않습니다.");
  }

  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const verifiedRadiusM = verifiedRadiusForFieldReport(place, clientLocation);
  const createdAt = new Date().toISOString();
  const ttlSettings = await getTtlSettings(env, [
    ...new Set(normalizedObservations.map((observation) => observation.dimension)),
    "report_current",
  ]);
  const ttlSecondsByDimension: Partial<Record<LiveSignalDimension, number>> = {};
  for (const observation of normalizedObservations) {
    ttlSecondsByDimension[observation.dimension] = ttlSettings[observation.dimension];
  }
  const observations = normalizedObservations.map<FieldReportObservation>((observation) => ({
    ...observation,
    expiresAt: resolveSignalExpiry({
      observedAt: createdAt,
      dimension: observation.dimension,
      ttlSecondsByDimension,
    }),
  }));
  const expiresAt = new Date(new Date(createdAt).getTime() + ttlSettings.report_current * 1_000).toISOString();
  const report: FieldReportRecord = {
    id: `field_report_${crypto.randomUUID()}`,
    placeId: place.id,
    category,
    crowdLevel,
    lineStatus,
    parkingStatus,
    weatherFeel,
    localConditions,
    observations,
    anonymousUserId,
    verifiedRadiusM,
    createdAt,
    expiresAt,
    hasPhoto: Boolean(photoUrl),
  };

  if (env.DB) {
    await recordD1PlaceEvent(env.DB, place, anonymousUserId, "report", {
      id: report.id,
      source: "field_report",
      crowdLevel,
      lineStatus,
      parkingStatus,
      verifiedRadiusM,
      createdAt,
      expiresAt,
    });
    await insertD1LiveSignals(env.DB, liveSignalsForFieldReport(report), report.anonymousUserId);
    await recomputeD1PlaceStatus(env.DB, place.id, new Date(createdAt));
    ctx.waitUntil(broadcastFieldReportCreated(env, place, report));

    return json(fieldReportResponse(report), fieldReportMeta("d1", report), 201);
  }

  fieldReports.unshift(report);
  liveSignals.unshift(...liveSignalsForFieldReport(report));
  ctx.waitUntil(broadcastFieldReportCreated(env, place, report));

  return json(fieldReportResponse(report), fieldReportMeta("memory-fallback", report), 201);
}

function isModerationReportBody(body: JsonObject): boolean {
  return typeof body["targetType"] === "string";
}

function optionalHttpUrlField(body: JsonObject, field: string, maxLength: number): string | undefined {
  const value = optionalStringField(body, field, maxLength);
  if (!value) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return url.toString();
}

function optionalClientLocationField(body: JsonObject): ClientLocation | null {
  const value = body["clientLocation"];
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "clientLocation 값이 올바르지 않습니다.");
  }

  return {
    latitude: coordinateField(value, "latitude", 33, 39),
    longitude: coordinateField(value, "longitude", 124, 132),
  };
}

function verifiedRadiusForFieldReport(place: PlaceRecord, clientLocation: ClientLocation | null): FieldReportRecord["verifiedRadiusM"] {
  if (!clientLocation) {
    return null;
  }

  const distanceM = distanceMeters(clientLocation, {
    latitude: place.latitude,
    longitude: place.longitude,
  });
  if (distanceM <= 50) {
    return 50;
  }

  if (distanceM <= 150) {
    return 150;
  }

  if (distanceM <= 300) {
    return 300;
  }

  throw new HttpError(400, "LOCATION_NOT_VERIFIED", "장소 300m 밖에서는 현장 인증 제보를 만들 수 없습니다.");
}

function fieldReportResponse(report: FieldReportRecord): {
  report: ReturnType<typeof publicFieldReport>;
  credits: FieldReportCredit[];
  safetyWarning: string | null;
  privacyNotice: string;
} {
  return {
    report: publicFieldReport(report),
    credits: fieldReportCredits(report),
    safetyWarning: fieldReportSafetyWarning(report.category),
    privacyNotice: "클라이언트 좌표는 반경 검증에만 사용되며 D1과 응답 본문에 저장하지 않습니다.",
  };
}

function publicFieldReport(report: FieldReportRecord) {
  return {
    id: report.id,
    placeId: report.placeId,
    category: report.category,
    ...(report.crowdLevel ? { crowdLevel: report.crowdLevel } : {}),
    ...(report.lineStatus ? { lineStatus: report.lineStatus } : {}),
    ...(report.parkingStatus ? { parkingStatus: report.parkingStatus } : {}),
    ...(report.weatherFeel ? { weatherFeel: report.weatherFeel } : {}),
    localConditions: report.localConditions,
    observations: report.observations,
    verifiedRadiusM: report.verifiedRadiusM,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
  };
}

function publicD1FieldReport(report: D1FieldReportRow): PublicFieldReportRecord {
  return {
    id: report.id,
    placeId: report.placeId,
    category: report.category,
    crowdLevel: report.crowdLevel ?? undefined,
    lineStatus: report.lineStatus ?? undefined,
    parkingStatus: report.parkingStatus ?? undefined,
    localConditions: [],
    observations: [],
    verifiedRadiusM: report.verifiedRadiusM,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
  };
}

function queueValueFromLineStatus(lineStatus: LineStatus): "none" | "under_10" | "10_to_30" | "30_to_60" {
  if (lineStatus === "none") return "none";
  if (lineStatus === "short") return "under_10";
  if (lineStatus === "medium") return "10_to_30";
  return "30_to_60";
}

function lineStatusFromQueueValue(
  queueStatus: (typeof fieldReportQueueStatuses)[number],
): LineStatus | undefined {
  if (queueStatus === "not_observed") return undefined;
  if (queueStatus === "none") return "none";
  if (queueStatus === "under_10") return "short";
  if (queueStatus === "10_to_30") return "medium";
  return "long";
}

function legacyParkingStatusFromObservation(
  parkingObservation: (typeof fieldReportParkingObservations)[number],
): ParkingStatus | undefined {
  if (parkingObservation === "not_observed") return undefined;
  if (parkingObservation === "available") return "available";
  if (parkingObservation === "limited" || parkingObservation === "almost_full") return "limited";
  return "full";
}

function liveSignalsForFieldReport(report: FieldReportRecord): LiveSignal[] {
  const verified = report.verifiedRadiusM !== null;
  return report.observations.map((observation, index) => ({
    id: `signal_${report.id}_${index + 1}`,
    placeId: report.placeId,
    dimension: observation.dimension,
    valueCode: observation.valueCode,
    sourceId: "source-user-report",
    sourceType: verified ? "verified_ugc" : "ugc",
    sourceName: verified ? "현장 인증 사용자" : "사용자 제보",
    observedAt: report.createdAt,
    fetchedAt: report.createdAt,
    expiresAt: observation.expiresAt,
    confidenceScore: verified ? 0.8 : 0.55,
    isEstimated: false,
    isPubliclyVisible: true,
    evidenceType: "user_report",
    evidenceId: report.id,
    metadata: {
      actorKey: report.anonymousUserId,
      verifiedRadiusM: report.verifiedRadiusM,
    },
  }));
}

async function insertD1LiveSignals(
  db: D1Database,
  signalsToInsert: readonly LiveSignal[],
  actorId: string,
): Promise<void> {
  for (const signal of signalsToInsert) {
    await db
      .prepare(
        `INSERT INTO live_signals (
          id,
          place_id,
          dimension,
          value_code,
          source_id,
          source_type,
          source_name,
          observed_at,
          fetched_at,
          expires_at,
          confidence_score,
          is_estimated,
          is_publicly_visible,
          evidence_type,
          evidence_id,
          actor_type,
          actor_id,
          idempotency_key,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'anonymous', ?, ?, ?)`,
      )
      .bind(
        signal.id,
        signal.placeId,
        signal.dimension,
        signal.valueCode,
        signal.sourceId,
        signal.sourceType,
        signal.sourceName,
        signal.observedAt,
        signal.fetchedAt,
        signal.expiresAt ?? null,
        signal.confidenceScore,
        signal.isEstimated ? 1 : 0,
        signal.isPubliclyVisible ? 1 : 0,
        signal.evidenceType ?? null,
        signal.evidenceId ?? null,
        actorId,
        `${signal.evidenceId}:${signal.dimension}:${signal.id}`,
        JSON.stringify(signal.metadata ?? {}),
      )
      .run();
  }
}

function publicQuestion(question: Pick<QuestionRecord, "id" | "placeId" | "questionType" | "body" | "creditCost" | "answeredReportId" | "createdAt">) {
  return {
    id: question.id,
    placeId: question.placeId,
    questionType: question.questionType,
    body: question.body,
    creditCost: question.creditCost,
    answeredReportId: question.answeredReportId,
    createdAt: question.createdAt,
  };
}

function publicMyQuestion(question: QuestionRecord | D1QuestionRow) {
  return {
    ...publicQuestion(question),
    status: question.status,
  };
}

async function publicPostWithResolvedPlace(post: PostRecord, env: Env) {
  return publicPost(post, await resolvePlaceRecord(post.placeId, env));
}

function publicPost(post: PostRecord, place: PlaceRecord) {
  return {
    id: post.id,
    userId: publicPostUserId(post.id),
    creatorName: post.creatorName,
    creatorBadge: post.creatorBadge,
    placeId: post.placeId,
    caption: post.caption,
    crowdLevel: post.crowdLevel,
    parkingStatus: post.parkingStatus,
    lineStatus: post.lineStatus,
    weatherFeel: post.weatherFeel,
    locationVerified: post.locationVerified,
    verifiedRadiusM: post.verifiedRadiusM,
    photoCount: post.photoCount,
    photoLabel: post.photoLabel,
    helpfulCount: post.helpfulCount,
    commentCount: post.commentCount,
    hashtagNames: post.hashtagNames,
    hashtags: post.hashtagNames.map((name) => publicHashtag(name, 1, post.createdAt)),
    shareCard: buildPostShareCard(post, place),
    judgement: judgementFromPostStatus(post.crowdLevel, post.parkingStatus),
    safetyWarning: placeSafetyWarning(place.categoryId),
    hiddenAt: post.hiddenAt,
    createdAt: post.createdAt,
  };
}

function publicComment(comment: CommentRecord | D1CommentRow, currentAnonymousUserId: string): PublicCommentRecord {
  return {
    id: comment.id,
    placeId: comment.placeId,
    body: comment.body,
    likeCount: comment.likeCount,
    hiddenAt: comment.hiddenAt,
    createdAt: comment.createdAt,
    ownedByCurrentSession: comment.anonymousUserId === currentAnonymousUserId,
  };
}

function postSubmitResponse(post: PostRecord, place: PlaceRecord, recommendedHashtags: string[]) {
  return {
    post: publicPost(post, place),
    credits: postCredits(post),
    recommendedHashtags,
    safetyWarning: placeSafetyWarning(place.categoryId),
    privacyNotice: "정확한 좌표는 저장하지 않고 장소 반경 검증 결과만 남깁니다.",
  };
}

function publicPostUserId(postId: string): string {
  return `public_${postId}`;
}

function questionSubmitResponse(question: QuestionRecord, availableCredits: number) {
  return {
    question: publicQuestion(question),
    creditEvent: questionCreditEvent(question.questionType),
    balance: Math.max(0, availableCredits - question.creditCost),
  };
}

function d1PostRowToRecord(row: D1PostRow): PostRecord {
  return {
    id: row.id,
    placeId: row.placeId,
    anonymousUserId: row.anonymousUserId,
    creatorName: row.creatorName,
    creatorBadge: row.creatorBadge,
    caption: row.caption,
    crowdLevel: row.crowdLevel,
    parkingStatus: row.parkingStatus,
    lineStatus: row.lineStatus,
    weatherFeel: row.weatherFeel,
    locationVerified: row.locationVerified === 1,
    verifiedRadiusM: row.verifiedRadiusM,
    photoCount: row.photoCount,
    photoLabel: row.photoLabel,
    helpfulCount: row.helpfulCount,
    commentCount: row.commentCount,
    hashtagNames: parseHashtagNames(row.hashtagNames),
    hiddenAt: row.hiddenAt,
    createdAt: row.createdAt,
  };
}

async function listD1PostsForHashtags(db: D1Database): Promise<PostRecord[]> {
  const { results = [] } = await db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        creator_name AS creatorName,
        creator_badge AS creatorBadge,
        caption,
        crowd_level AS crowdLevel,
        parking_status AS parkingStatus,
        line_status AS lineStatus,
        weather_feel AS weatherFeel,
        location_verified AS locationVerified,
        verified_radius_m AS verifiedRadiusM,
        photo_count AS photoCount,
        photo_label AS photoLabel,
        helpful_count AS helpfulCount,
        comment_count AS commentCount,
        hashtag_names AS hashtagNames,
        hidden_at AS hiddenAt,
        created_at AS createdAt
      FROM posts
      WHERE status = 'visible' AND hidden_at IS NULL
      ORDER BY created_at DESC
      LIMIT 500`,
    )
    .all<D1PostRow>();

  return results.map(d1PostRowToRecord);
}

function hashtagRecordsForPosts(sourcePosts: PostRecord[]): HashtagRecord[] {
  const counts = new Map<string, { postCount: number; createdAt: string }>();
  for (const post of sourcePosts) {
    if (post.hiddenAt) {
      continue;
    }
    for (const name of post.hashtagNames) {
      const current = counts.get(name);
      counts.set(name, {
        postCount: (current?.postCount ?? 0) + 1,
        createdAt: current?.createdAt ?? post.createdAt,
      });
    }
  }

  return [...counts.entries()]
    .map(([name, value]) => publicHashtag(name, value.postCount, value.createdAt))
    .sort((left, right) => right.postCount - left.postCount || left.name.localeCompare(right.name, "ko"));
}

function publicHashtag(name: string, postCount: number, createdAt: string): HashtagRecord {
  return {
    id: `hashtag_${name}`,
    name,
    tagType: classifyHashtag(name),
    postCount,
    createdAt,
  };
}

function rankPostsForFeed<TPost extends Pick<PostRecord, "createdAt" | "locationVerified" | "photoCount" | "helpfulCount" | "commentCount" | "hiddenAt">>(sourcePosts: TPost[]): TPost[] {
  return [...sourcePosts]
    .filter((post) => !post.hiddenAt)
    .sort((left, right) => postScore(right) - postScore(left));
}

function postScore(post: Pick<PostRecord, "createdAt" | "locationVerified" | "photoCount" | "helpfulCount" | "commentCount">): number {
  const ageMinutes = Math.max(0, (Date.now() - new Date(post.createdAt).getTime()) / 60_000);
  const recentScore = Math.max(0, 240 - ageMinutes);

  return recentScore + Number(post.locationVerified) * 80 + Math.min(post.photoCount, 3) * 24 + post.helpfulCount * 3 + post.commentCount * 2;
}

function buildPostShareCard(post: PostRecord, place: PlaceRecord): ShareCardRecord {
  const judgement = judgementFromPostStatus(post.crowdLevel, post.parkingStatus);
  const statusText = [crowdStatusLabel(post.crowdLevel), `주차 ${parkingStatusLabel(post.parkingStatus)}`, `줄 ${lineStatusLabel(post.lineStatus)}`].join(" · ");

  return {
    headline: `${place.name} ${judgement}`,
    body: `${statusText}\n${minutesAgoLabel(post.createdAt)} 현장 인증 제보\n${post.caption ?? "지금 현장 상태를 확인해 보세요."}`,
    url: `${publicSiteUrl}/place/${place.id}`,
    hashtags: post.hashtagNames.slice(0, 5),
    variant: shareCardVariant(post, judgement),
  };
}

function shareCardVariant(
  post: Pick<PostRecord, "crowdLevel" | "parkingStatus" | "lineStatus" | "photoCount" | "weatherFeel">,
  judgement: "가도 좋음" | "주의" | "지금은 비추",
): ShareCardRecord["variant"] {
  if (post.parkingStatus === "full") return "parking_full";
  if (post.lineStatus === "medium" || post.lineStatus === "long") return "waiting";
  if (judgement === "지금은 비추") return "avoid";
  if (post.photoCount > 0 && post.weatherFeel === "good") return "photo_spot";
  return "good";
}

function postCredits(post: PostRecord): Array<{ type: "verified_report" | "photo_report"; amount: 1 }> {
  const credits: Array<{ type: "verified_report" | "photo_report"; amount: 1 }> = [];
  if (post.verifiedRadiusM) {
    credits.push({ type: "verified_report", amount: 1 });
  }
  if (post.photoCount > 0) {
    credits.push({ type: "photo_report", amount: 1 });
  }

  return credits;
}

function questionCreditEvent(questionType: QuestionType): { type: "ask_question" | "ask_photo_request"; amount: -1 | -2 } {
  return questionType === "photo_request" ? { type: "ask_photo_request", amount: -2 } : { type: "ask_question", amount: -1 };
}

function questionCreditCost(questionType: QuestionType): 1 | 2 {
  return questionType === "photo_request" ? 2 : 1;
}

function normalizeHashtagName(input: string): string {
  return input
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 24);
}

function uniqueHashtagNames(names: string[]): string[] {
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

function classifyHashtag(name: string): HashtagRecord["tagType"] {
  if (/주차|웨이팅|사람|한산|만차|줄/.test(name)) {
    return "status";
  }
  if (/아이랑|데이트|산책|사진|노을|혼자|비오는날|피크닉/.test(name)) {
    return "purpose";
  }
  if (/지금|오늘|주말|야경|오후/.test(name)) {
    return "time";
  }
  if (/울산|부산|경주|대구|창원|김해|양산|포항|서울|제주|강릉|전주|여수|속초/.test(name)) {
    return "region";
  }

  return "place";
}

function recommendPostHashtags(input: {
  place: PlaceRecord;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
}): string[] {
  return uniqueHashtagNames([
    `${input.place.name}지금`,
    statusHashtag(input.crowdLevel, input.parkingStatus, input.lineStatus),
    purposeHashtag(input.place.name, input.weatherFeel),
    regionHashtag(input.place.regionId),
    "지금",
  ]).slice(0, 5);
}

function statusHashtag(
  crowdLevel: CrowdLevel,
  parkingStatus: ParkingStatus,
  lineStatus: LineStatus,
): string {
  if (parkingStatus === "full") return "주차만차";
  if (parkingStatus === "limited") return "주차거의없음";
  if (lineStatus === "long" || lineStatus === "medium") return "웨이팅있음";
  if (crowdLevel === "packed" || crowdLevel === "busy") return "사람많음";
  return "한산함";
}

function purposeHashtag(placeName: string, weatherFeel: WeatherFeel): string {
  if (weatherFeel === "rainy") return "비오는날";
  if (placeName.includes("태화강")) return "태화강산책";
  if (placeName.includes("광안리")) return "광안리노을";
  if (placeName.includes("황리단길")) return "황리단길웨이팅";
  if (placeName.includes("한강")) return "한강피크닉";
  return "사진스팟";
}

function regionHashtag(regionId: string): string {
  const labels: Record<string, string> = {
    busan: "부산",
    ulsan: "울산",
    gyeongju: "경주",
    daegu: "대구",
    changwon: "창원",
    gimhae: "김해",
    yangsan: "양산",
    pohang: "포항",
    seoul: "서울",
    jeju: "제주",
    gangneung: "강릉",
    jeonju: "전주",
    yeosu: "여수",
    sokcho: "속초",
  };

  return labels[regionId] ?? regionId;
}

function judgementFromPostStatus(
  crowdLevel: CrowdLevel,
  parkingStatus: ParkingStatus,
): "가도 좋음" | "주의" | "지금은 비추" {
  if (crowdLevel === "packed" || parkingStatus === "full") {
    return "지금은 비추";
  }
  if (crowdLevel === "busy" || parkingStatus === "limited") {
    return "주의";
  }

  return "가도 좋음";
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

function placeSafetyWarning(categoryId: string): string | null {
  if (categoryId === "hospital") {
    return "병원 제보에는 환자 얼굴, 접수번호, 진료 정보, 의료진 개인정보가 보이지 않게 촬영해 주세요.";
  }
  if (categoryId === "public_office") {
    return "관공서 제보에는 민원인 얼굴, 서류, 차량번호, 창구 개인정보가 보이지 않게 촬영해 주세요.";
  }

  return null;
}

function creatorBadgeForPlace(place: PlaceRecord): string {
  const region = regionHashtag(place.regionId);
  return `${region} 현장 제보`;
}

function parseHashtagNames(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return uniqueHashtagNames(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}

function seedPost(input: {
  id: string;
  placeId: string;
  creatorName: string;
  creatorBadge: string;
  caption: string;
  crowdLevel: CrowdLevel;
  parkingStatus: ParkingStatus;
  lineStatus: LineStatus;
  weatherFeel: WeatherFeel;
  photoCount: number;
  photoLabel: string;
  helpfulCount: number;
  commentCount: number;
  hashtagNames: string[];
  minutesAgo: number;
}): PostRecord {
  return {
    id: input.id,
    placeId: input.placeId,
    anonymousUserId: "anon_seed_public",
    creatorName: input.creatorName,
    creatorBadge: input.creatorBadge,
    caption: input.caption,
    crowdLevel: input.crowdLevel,
    parkingStatus: input.parkingStatus,
    lineStatus: input.lineStatus,
    weatherFeel: input.weatherFeel,
    locationVerified: true,
    verifiedRadiusM: 150,
    photoCount: input.photoCount,
    photoLabel: input.photoLabel,
    helpfulCount: input.helpfulCount,
    commentCount: input.commentCount,
    hashtagNames: uniqueHashtagNames(input.hashtagNames),
    hiddenAt: null,
    createdAt: new Date(Date.now() - input.minutesAgo * 60_000).toISOString(),
  };
}

function seedQuestion(input: {
  id: string;
  placeId: string;
  questionType: QuestionType;
  body: string;
  minutesAgo: number;
}): QuestionRecord {
  return {
    id: input.id,
    placeId: input.placeId,
    anonymousUserId: "anon_seed_public",
    questionType: input.questionType,
    body: input.body,
    creditCost: questionCreditCost(input.questionType),
    answeredReportId: null,
    status: "pending",
    createdAt: new Date(Date.now() - input.minutesAgo * 60_000).toISOString(),
  };
}

function fieldReportCredits(report: FieldReportRecord): FieldReportCredit[] {
  const credits: FieldReportCredit[] = [];
  if (report.verifiedRadiusM) {
    credits.push({ type: "verified_report", amount: 1 });
  }

  if (report.hasPhoto) {
    credits.push({ type: "photo_report", amount: 1 });
  }

  return credits;
}

function fieldReportSafetyWarning(category: FieldReportRecord["category"]): string | null {
  if (category === "hospital") {
    return "병원 제보에는 환자 얼굴, 접수번호, 진료 정보, 의료진 개인정보가 보이지 않게 촬영해 주세요.";
  }

  if (category === "public_office") {
    return "관공서 제보에는 민원인 얼굴, 서류, 차량번호, 창구 개인정보가 보이지 않게 촬영해 주세요.";
  }

  return null;
}

function fieldReportMeta(storage: "d1" | "memory-fallback", report: FieldReportRecord): Record<string, unknown> {
  return {
    storage,
    contractVersion: 2,
    reportTtlSeconds: Math.round((new Date(report.expiresAt).getTime() - new Date(report.createdAt).getTime()) / 1_000),
    signalCount: report.observations.length,
    locationPolicy: "clientLocation-used-only-for-distance-and-not-stored",
    verifiedLocation: Boolean(report.verifiedRadiusM),
  };
}

function broadcastFieldReportCreated(env: Env, place: PlaceRecord, report: FieldReportRecord): Promise<void> {
  return broadcastPlaceActivity(env, "report.created", place, {
    id: report.id,
    placeId: place.id,
    regionId: place.regionId,
    areaId: place.areaId,
    category: report.category,
    crowdLevel: report.crowdLevel,
    lineStatus: report.lineStatus,
    parkingStatus: report.parkingStatus,
    weatherFeel: report.weatherFeel,
    verifiedRadiusM: report.verifiedRadiusM,
    expiresAt: report.expiresAt,
  });
}

async function listFieldReports(url: URL, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const regionId = url.searchParams.get("regionId") ?? url.searchParams.get("region");
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);

  if (env.DB) {
    const where = ["event_type = 'report'", "source = 'field_report'"];
    const values: D1Value[] = [];
    if (placeId) {
      where.push("place_id = ?");
      values.push(placeId);
    }

    if (regionId) {
      where.push("region_code = ?");
      values.push(regionId);
    }

    where.push(`expires_at > ${D1_NOW_SQL}`);

    values.push(limit);
    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          category,
          crowd_level AS crowdLevel,
          line_status AS lineStatus,
          parking_status AS parkingStatus,
          verified_radius_m AS verifiedRadiusM,
          created_at AS createdAt,
          expires_at AS expiresAt
        FROM place_events
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1FieldReportRow>();

    return json(results.map(publicD1FieldReport), {
      limit,
      includeExpired: false,
      storage: "d1",
      privacy: "clientLocation and photoUrl are not persisted in place_events or returned",
    });
  }

  const now = new Date();
  const data = fieldReports
    .filter((report) => !placeId || report.placeId === placeId)
    .filter((report) => !regionId || findPlaceRecord(report.placeId).regionId === regionId)
    .filter((report) => new Date(report.expiresAt).getTime() > now.getTime())
    .slice(0, limit)
    .map(publicFieldReport);

  return json(data, {
    limit,
    includeExpired: false,
    storage: "memory-fallback",
    privacy: "clientLocation and photoUrl are not persisted in field report responses",
  });
}

async function listModerationReports(url: URL, env: Env): Promise<Response> {
  const status = url.searchParams.get("status");
  const limit = clampLimit(url.searchParams.get("limit"));
  if (env.DB) {
    const values: D1Value[] = [];
    const where = [];
    if (status) {
      where.push("r.status = ?");
      values.push(status);
    }
    values.push(limit);
    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          r.id,
          r.target_type AS targetType,
          r.target_id AS targetId,
          r.reason,
          r.anonymous_user_id AS anonymousUserId,
          r.note,
          r.status,
          r.created_at AS createdAt
        FROM reports r
        LEFT JOIN moderation_reports mr ON mr.report_id = r.id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY
          CASE mr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
          r.created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1ReportRow>();

    return json(results, { limit, authz: "moderator-role", storage: "d1" });
  }

  const data = reports.filter((report) => !status || report.status === status).slice(0, limit);

  return json(data, { limit, authz: "moderator-role" });
}

async function moderateReport(reportId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const status = enumField(body, "status", ["accepted", "rejected"] as const);
  const reason = optionalStringField(body, "reason", 500) ?? null;

  if (env.DB) {
    const report = await getD1Report(env.DB, reportId);
    if (!report) {
      return errorResponse(404, "REPORT_NOT_FOUND", "신고를 찾을 수 없습니다.");
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE reports SET status = ?, resolved_at = ? WHERE id = ?").bind(status, now, reportId).run();
    await env.DB
      .prepare("UPDATE moderation_reports SET decision = ?, decision_note = ?, updated_at = ? WHERE report_id = ?")
      .bind(status === "accepted" ? "accept" : "reject", reason, now, reportId)
      .run();
    await env.DB
      .prepare("INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        `admin_${crypto.randomUUID()}`,
        adminSubject(request),
        `report_${status}`,
        report.targetType,
        report.targetId,
        reason,
        now,
      )
      .run();

    const updated: ReportRecord = { ...report, status };
    if (status === "accepted") {
      await applyD1ProtectionForReport(env.DB, updated);
    }

    return json(updated, { auditPolicy: "admin_actions", storage: "d1" });
  }

  const report = reports.find((candidate) => candidate.id === reportId);
  if (!report) {
    return errorResponse(404, "REPORT_NOT_FOUND", "신고를 찾을 수 없습니다.");
  }

  report.status = status;

  return json(report, { auditPolicy: "admin_actions table records this in D1 migration" });
}

async function moderatePhoto(
  photoId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const db = requireD1(env);
  if (!/^photo_[a-zA-Z0-9-]{8,100}$/.test(photoId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "photoId 값이 올바르지 않습니다.");
  }
  const body = await readJson(request);
  const decision = enumField(body, "decision", ["approved", "rejected"] as const);
  const reason = stringField(body, "reason", 500);
  const photo = await db.prepare(`
    SELECT
      id,
      place_id AS placeId,
      anonymous_user_id AS anonymousUserId,
      r2_key AS storageKey,
      status,
      deleted_at AS deletedAt
    FROM photos
    WHERE id = ?
  `).bind(photoId).first<{
    id: string;
    placeId: string;
    anonymousUserId: string;
    storageKey: string;
    status: PhotoRecord["status"];
    deletedAt: string | null;
  }>();
  if (!photo || photo.deletedAt) {
    throw new HttpError(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }
  if (decision === "approved" && photo.status === "rejected") {
    throw new HttpError(409, "PHOTO_FILE_REMOVED", "거절되어 삭제된 사진은 승인할 수 없습니다.");
  }

  const now = new Date().toISOString();
  const wasReady = photo.status === "ready";
  let r2Deleted = false;
  if (decision === "rejected" && env.PHOTOS) {
    await env.PHOTOS.delete(photo.storageKey);
    r2Deleted = true;
  }
  await db.prepare(`
    UPDATE photos
    SET status = ?, hidden_at = ?
    WHERE id = ?
  `).bind(decision === "approved" ? "ready" : "rejected", decision === "approved" ? null : now, photo.id).run();
  await db.prepare(`
    INSERT INTO photo_moderation_states (
      photo_id,
      status,
      automated_checks_json,
      risk_flags_json,
      reviewer_subject,
      decision_reason,
      decided_at,
      created_at,
      updated_at
    ) VALUES (?, ?, '{}', '[]', ?, ?, ?, ?, ?)
    ON CONFLICT(photo_id) DO UPDATE SET
      status = excluded.status,
      reviewer_subject = excluded.reviewer_subject,
      decision_reason = excluded.decision_reason,
      decided_at = excluded.decided_at,
      updated_at = excluded.updated_at
  `).bind(photo.id, decision, adminSubject(request), reason, now, now, now).run();
  await recordAdminAction(db, request, `photo_${decision}`, "photo", photo.id, reason);

  if (decision === "approved" && !wasReady) {
    const place = await resolvePlaceRecord(photo.placeId, env);
    await recordD1PlaceEvent(db, place, photo.anonymousUserId, "photo");
    ctx.waitUntil(
      broadcastPlaceActivity(env, "photo.ready", place, {
        id: photo.id,
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
      }),
    );
  }

  return json({
    photoId: photo.id,
    decision,
    public: decision === "approved",
    r2Deleted,
  }, {
    authz: "moderator-role",
    auditPolicy: "admin_actions",
    storage: "d1",
  });
}

async function moderateContent(request: Request, env: Env, action: AdminModerationAction): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "운영 조치에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const targetType = enumField(body, "targetType", ["place", "post", "comment", "photo"] as const);
  const targetId = stringField(body, "targetId", 100);
  const reason = action === "restore" ? optionalStringField(body, "reason", 500) ?? null : stringField(body, "reason", 500);
  const target = await getD1ModerationTarget(env.DB, targetType, targetId);
  if (!target.exists) {
    return errorResponse(404, "MODERATION_TARGET_NOT_FOUND", "운영 조치 대상을 찾을 수 없습니다.");
  }

  let r2Deleted = false;
  if (action === "delete" && targetType === "photo" && target.storageKey && env.PHOTOS) {
    await env.PHOTOS.delete(target.storageKey);
    r2Deleted = true;
  }

  await applyD1ModerationAction(env.DB, targetType, targetId, action, reason);
  await recordAdminAction(env.DB, request, action, targetType, targetId, reason);
  const cacheInvalidation = await invalidateModerationCache(env, targetType, targetId, target);

  return json(
    {
      targetType,
      targetId,
      action,
      r2Deleted,
    },
    {
      auditPolicy: "admin_actions",
      storage: "d1",
      r2Policy: targetType === "photo" && action === "delete" ? "delete-r2-object-before-public-removal-complete" : "not-applicable",
      cacheInvalidation,
    },
  );
}

async function bulkModerateContent(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "운영 조치에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const action = enumField(body, "action", ["hide", "restore"] as const);
  const reason = action === "restore" ? optionalStringField(body, "reason", 500) ?? null : stringField(body, "reason", 500);
  const targets = bulkModerationTargetsField(body, 20);
  const results: AdminBulkModerationResult[] = [];
  const cacheKeys = new Set<string>();
  const deletedCacheKeys = new Set<string>();

  for (const item of targets) {
    const target = await getD1ModerationTarget(env.DB, item.targetType, item.targetId);
    if (!target.exists) {
      results.push({ ...item, status: "not_found" });
      continue;
    }

    await applyD1ModerationAction(env.DB, item.targetType, item.targetId, action, reason);
    await recordAdminAction(env.DB, request, `bulk_${action}`, item.targetType, item.targetId, reason);
    const cacheInvalidation = await invalidateModerationCache(env, item.targetType, item.targetId, target);
    for (const key of cacheInvalidation.keys) {
      cacheKeys.add(key);
    }
    for (const key of cacheInvalidation.deletedKeys) {
      deletedCacheKeys.add(key);
    }
    results.push({ ...item, status: "ok" });
  }

  const succeeded = results.filter((result) => result.status === "ok").length;

  return json(
    {
      action,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    },
    {
      auditPolicy: "admin_actions",
      storage: "d1",
      bulkLimit: 20,
      cacheInvalidation: {
        binding: env.CACHE ? "CACHE" : "none",
        keys: [...cacheKeys],
        deletedKeys: [...deletedCacheKeys],
      },
    },
  );
}

async function updatePlaceCoordinateStatus(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "장소 좌표 상태 변경에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const coordinateStatus = enumField(body, "coordinateStatus", ["verified", "TODO_COORDINATE_VERIFY", "rejected"] as const);
  const source = stringField(body, "source", 160);
  const reason = stringField(body, "reason", 300);
  const target = await getD1ModerationTarget(env.DB, "place", placeId);
  if (!target.exists) {
    return errorResponse(404, "PLACE_NOT_FOUND", "좌표 상태를 변경할 장소를 찾을 수 없습니다.");
  }

  const latitude = coordinateStatus === "verified" ? coordinateField(body, "latitude", -90, 90) : null;
  const longitude = coordinateStatus === "verified" ? coordinateField(body, "longitude", -180, 180) : null;
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE places
       SET coordinate_status = ?,
           latitude = ?,
           longitude = ?,
           is_active = CASE WHEN ? = 'rejected' THEN 0 ELSE is_active END,
           launch_stage = CASE WHEN ? = 'verified' AND launch_stage = 'seed' THEN 'beta' ELSE launch_stage END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(coordinateStatus, latitude, longitude, coordinateStatus, coordinateStatus, now, placeId)
    .run();

  await recordAdminAction(env.DB, request, "place_coordinate_status", "place", placeId, `status=${coordinateStatus}; source=${source}; reason=${reason}`);
  const cacheInvalidation = await invalidateModerationCache(env, "place", placeId, target);

  return json(
    {
      placeId,
      coordinateStatus,
      latitude,
      longitude,
    },
    {
      authz: "operator-role",
      auditPolicy: "admin_actions",
      storage: "d1",
      cacheInvalidation,
    },
  );
}

async function restrictUser(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "사용자 제한에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const anonymousUserId = anonymousUserIdField(body, "anonymousUserId");
  const reason = stringField(body, "reason", 200);
  const blockedUntil = optionalFutureIsoDateField(body, "blockedUntil");
  const existing = await getD1AnonymousUser(env.DB, anonymousUserId);
  if (!existing) {
    return errorResponse(404, "ANONYMOUS_USER_NOT_FOUND", "제한할 사용자를 찾을 수 없습니다.");
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO blocked_users (id, anonymous_user_id, reason, blocked_until, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(anonymous_user_id) DO UPDATE SET
         reason = excluded.reason,
         blocked_until = excluded.blocked_until,
         created_at = excluded.created_at`,
    )
    .bind(`block_${crypto.randomUUID()}`, anonymousUserId, reason, blockedUntil, now)
    .run();
  await recordAdminAction(env.DB, request, "user_restrict", "anonymous_user", anonymousUserId, reason);

  return json(
    {
      anonymousUserId,
      restricted: true,
      blockedUntil,
    },
    {
      authz: "admin-role",
      auditPolicy: "admin_actions",
      storage: "d1",
    },
  );
}

async function unrestrictUser(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "사용자 제한 해제에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const anonymousUserId = anonymousUserIdField(body, "anonymousUserId");
  const reason = optionalStringField(body, "reason", 500) ?? null;
  const existing = await getD1AnonymousUser(env.DB, anonymousUserId);
  if (!existing) {
    return errorResponse(404, "ANONYMOUS_USER_NOT_FOUND", "제한 해제할 사용자를 찾을 수 없습니다.");
  }

  await env.DB.prepare("DELETE FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
  await recordAdminAction(env.DB, request, "user_unrestrict", "anonymous_user", anonymousUserId, reason);

  return json(
    {
      anonymousUserId,
      restricted: false,
    },
    {
      authz: "admin-role",
      auditPolicy: "admin_actions",
      storage: "d1",
    },
  );
}

async function invalidateModerationCache(
  env: Env,
  targetType: ReportRecord["targetType"],
  targetId: string,
  target: D1ModerationTarget,
): Promise<CacheInvalidationResult> {
  const keys = moderationCacheKeys(targetType, targetId, target);
  if (!env.CACHE) {
    return { binding: "none", keys, deletedKeys: [] };
  }

  for (const key of keys) {
    await env.CACHE.delete(key);
  }
  await env.CACHE.put(RANKING_CACHE_VERSION_KEY, String(Date.now()));

  return { binding: "CACHE", keys, deletedKeys: keys };
}

function moderationCacheKeys(targetType: ReportRecord["targetType"], targetId: string, target: D1ModerationTarget): string[] {
  const keys = new Set<string>(["rankings:nationwide", "rankings:map-bounds"]);

  if (target.regionId) {
    keys.add(`rankings:region:${target.regionId}`);
    keys.add(`rankings:area:${target.regionId}`);
    keys.add(`rankings:category:${target.regionId}`);
  }

  if (target.placeId) {
    keys.add(`places:${target.placeId}`);
    keys.add(`place-live:${target.placeId}`);
    keys.add(`rankings:place:${target.placeId}`);
  }

  if (targetType === "comment" && target.placeId) {
    keys.add(`comments:${target.placeId}`);
  }

  if (targetType === "post" && target.placeId) {
    keys.add(`posts:${target.placeId}`);
    keys.add("posts:feed");
  }

  if (targetType === "photo" && target.placeId) {
    keys.add(`photos:${target.placeId}`);
  }

  if (targetType === "place") {
    keys.add(`places:${targetId}`);
  }

  return [...keys];
}

function routeRealtime(request: Request, env: Env, _ctx: ExecutionContext, url: URL, path: string): Promise<Response> | Response | null {
  if (!path.startsWith("/api/realtime")) {
    return null;
  }

  const pathMatch = path.match(/^\/api\/realtime\/(place|region|global)(?:\/([^/]+))?$/);
  const scope = pathMatch
    ? (pathMatch[1] as "place" | "region" | "global")
    : enumFromSearch(url, "scope", ["place", "region", "global"] as const, "global");
  const roomId = pathMatch?.[2] ? decodeURIComponent(pathMatch[2]) : url.searchParams.get("roomId") ?? (scope === "global" ? "global" : "");
  if (!roomId) {
    return errorResponse(400, "ROOM_ID_REQUIRED", "실시간 roomId가 필요합니다.");
  }

  const namespace = scope === "place" ? env.PLACE_ROOM : scope === "region" ? env.REGION_ROOM : env.GLOBAL_ROOM;
  if (namespace) {
    const stub = namespace.get(namespace.idFromName(roomId));
    return stub.fetch(requestWithRoomId(request, roomId));
  }

  return json(
    {
      mode: "polling",
      scope,
      roomId,
      events: getRoomEvents(roomKey(scope, roomId)),
    },
    {
      fallback: "Durable Object binding이 없으면 최근 이벤트 polling으로 대체합니다.",
    },
  );
}

function requestWithRoomId(request: Request, roomId: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("roomId", roomId);
  return new Request(url, request);
}

function broadcastPlaceActivity(env: Env, type: RoomBroadcast["type"], place: PlaceRecord, payload: JsonObject): Promise<void> {
  return Promise.all([
    broadcastToRooms(env, type, "place", place.id, payload),
    broadcastToRooms(env, type, "region", place.regionId, payload),
    broadcastToRooms(env, type, "global", "global", payload),
  ]).then(() => undefined);
}

async function broadcastToRooms(
  env: Env,
  type: RoomBroadcast["type"],
  scope: RoomBroadcast["scope"],
  roomId: string,
  payload: JsonObject,
): Promise<void> {
  const event: RoomBroadcast = {
    type,
    scope,
    roomId,
    payload,
    createdAt: new Date().toISOString(),
  };
  const key = roomKey(scope, roomId);
  const events = [event, ...getRoomEvents(key)].slice(0, 50);
  roomEvents.set(key, events);

  const namespace = scope === "place" ? env.PLACE_ROOM : scope === "region" ? env.REGION_ROOM : env.GLOBAL_ROOM;
  if (!namespace) {
    return;
  }

  const stub = namespace.get(namespace.idFromName(roomId));
  await stub.fetch(
    new Request(`https://silsigan.internal/api/realtime/broadcast?roomId=${encodeURIComponent(roomId)}`, {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "content-type": "application/json" },
    }),
  );
}

async function enforceRateLimit(scope: string, request: Request, anonymousUserId: string, limit: number, windowMs: number): Promise<void> {
  const key = `${scope}:${anonymousUserId}:${clientIpHint(request)}`;
  const current = rateBuckets.get(key);
  const { state, result } = applySlidingWindowRateLimit(current, Date.now(), limit, windowMs);
  rateBuckets.set(key, state);

  if (!result.allowed) {
    throw new HttpError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

function getAnonymousSession(request: Request): AnonymousSession {
  const headerId = request.headers.get("x-silsigan-anon-id")?.trim();
  const cookieId = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("silsigan_anon_id="))
    ?.split("=")[1];
  const candidate = headerId || cookieId;

  if (candidate && /^[a-zA-Z0-9_-]{12,80}$/.test(candidate)) {
    return { id: candidate, isNew: false };
  }

  return { id: `anon_${crypto.randomUUID()}`, isNew: true };
}

function sessionHeadersFor(session: AnonymousSession): Headers {
  const headers = new Headers();
  headers.set("x-silsigan-anon-id", session.id);
  if (session.isNew) {
    headers.append("set-cookie", `silsigan_anon_id=${session.id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
  }

  return headers;
}

function likeStateFor(anonymousUserId: string): LikePolicyState {
  const existing = likeStateByAnon.get(anonymousUserId);
  if (existing) {
    return existing;
  }

  const state = { likedPlaceIds: new Set<string>(), likedCommentIds: new Set<string>(), clickedPhotoIds: new Set<string>() };
  likeStateByAnon.set(anonymousUserId, state);
  return state;
}

async function requireAdmin(request: Request, env: Env, minimumRole: AdminRole): Promise<AdminRole> {
  const provided = request.headers.get("x-silsigan-admin-token") ?? "";
  const credentials = adminCredentials(env);

  let matchedRole: AdminRole | null = null;
  for (const credential of credentials) {
    if (await timingSafeEqualString(provided, credential.token)) {
      matchedRole = credential.role;
      break;
    }
  }

  if (!matchedRole) {
    throw new HttpError(403, "FORBIDDEN", "운영 API 권한이 없습니다.");
  }

  if (adminRoleRank[matchedRole] < adminRoleRank[minimumRole]) {
    throw new HttpError(403, "INSUFFICIENT_ADMIN_ROLE", `${minimumRole} 권한이 필요한 작업입니다.`);
  }

  return matchedRole;
}

function adminCredentials(env: Env): AdminCredential[] {
  const credentials: AdminCredential[] = [];
  if (env.ADMIN_TOKENS) {
    credentials.push(...parseAdminTokens(env.ADMIN_TOKENS));
  }

  if (env.ADMIN_TOKEN) {
    credentials.push({ role: "admin", token: env.ADMIN_TOKEN, source: "ADMIN_TOKEN" });
  }

  if (credentials.length === 0) {
    throw new HttpError(503, "ADMIN_TOKEN_NOT_CONFIGURED", "운영 API 토큰이 설정되지 않았습니다.");
  }

  return credentials;
}

function parseAdminTokens(raw: string): AdminCredential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰 설정이 올바른 JSON이 아닙니다.");
  }

  if (!isRecord(parsed)) {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰 설정은 JSON 객체여야 합니다.");
  }

  const credentials: AdminCredential[] = [];
  for (const role of adminRoles) {
    const value = parsed[role];
    if (typeof value === "string" && value.length > 0) {
      credentials.push({ role, token: value, source: "ADMIN_TOKENS" });
      continue;
    }

    if (Array.isArray(value) && value.every((item): item is string => typeof item === "string" && item.length > 0)) {
      credentials.push(...value.map((token) => ({ role, token, source: "ADMIN_TOKENS" as const })));
      continue;
    }

    if (value !== undefined) {
      throw new HttpError(503, "ADMIN_TOKENS_INVALID", `${role} 운영 토큰 설정이 올바르지 않습니다.`);
    }
  }

  if (credentials.length === 0) {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰이 하나 이상 필요합니다.");
  }

  return credentials;
}

async function timingSafeEqualString(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([sha256Bytes(provided), sha256Bytes(expected)]);
  let difference = providedDigest.length ^ expectedDigest.length;
  const length = Math.max(providedDigest.length, expectedDigest.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (providedDigest[index] ?? 0) ^ (expectedDigest[index] ?? 0);
  }

  return difference === 0;
}

function findPlaceRecord(placeId: string): PlaceRecord {
  const place = seedPlaces.find((candidate) => candidate.id === placeId);
  if (!place) {
    throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
  }

  return place;
}

async function resolvePlaceRecord(placeId: string, env: Env): Promise<PlaceRecord> {
  if (!env.DB) {
    return findPlaceRecord(placeId);
  }

  const row = await env.DB
    .prepare(
      `${d1PlaceSelectSql()}
       WHERE p.id = ? AND p.is_active = 1 AND p.coordinate_status = 'verified' AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       LIMIT 1`,
    )
    .bind(placeId)
    .first<D1PlaceRow>();
  if (!row) {
    throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
  }

  return d1PlaceRowToRecord(row);
}

async function resolveReportTarget(targetType: ReportRecord["targetType"], targetId: string, env: Env): Promise<PlaceRecord | null> {
  if (targetType === "place") {
    return resolvePlaceRecord(targetId, env);
  }

  if (env.DB) {
    if (targetType === "post") {
      const post = await getD1VisiblePost(env.DB, targetId);
      if (post) {
        return resolvePlaceRecord(post.placeId, env);
      }
    }

    if (targetType === "comment") {
      const comment = await getD1VisibleComment(env.DB, targetId);
      if (comment) {
        return resolvePlaceRecord(comment.placeId, env);
      }
    }

    if (targetType === "photo") {
      const photo = await getD1VisiblePhoto(env.DB, targetId);
      if (photo) {
        return resolvePlaceRecord(photo.placeId, env);
      }
    }

    throw new HttpError(404, "REPORT_TARGET_NOT_FOUND", "신고 대상을 찾을 수 없습니다.");
  }

  if (targetType === "post" && posts.some((post) => post.id === targetId && !post.hiddenAt)) {
    const post = posts.find((candidate) => candidate.id === targetId && !candidate.hiddenAt);
    return post ? findPlaceRecord(post.placeId) : null;
  }

  if (targetType === "comment" && comments.some((comment) => comment.id === targetId)) {
    const comment = comments.find((candidate) => candidate.id === targetId);
    return comment ? findPlaceRecord(comment.placeId) : null;
  }

  if (targetType === "photo" && photos.some((photo) => photo.id === targetId && !photo.deletedAt)) {
    const photo = photos.find((candidate) => candidate.id === targetId && !candidate.deletedAt);
    return photo ? findPlaceRecord(photo.placeId) : null;
  }

  throw new HttpError(404, "REPORT_TARGET_NOT_FOUND", "신고 대상을 찾을 수 없습니다.");
}

async function ensureD1AnonymousUser(db: D1Database, session: AnonymousSession): Promise<string> {
  const sessionHash = await anonymousSessionHash(session);
  const anonymousUserId = anonymousUserIdFromHash(sessionHash);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO anonymous_users (id, session_hash, trust_score, created_at, last_seen_at)
       VALUES (?, ?, 50, ?, ?)
       ON CONFLICT(session_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(anonymousUserId, sessionHash, now, now)
    .run();

  return anonymousUserId;
}

async function anonymousUserIdForSession(session: AnonymousSession): Promise<string> {
  const sessionHash = await anonymousSessionHash(session);
  return anonymousUserIdFromHash(sessionHash);
}

async function anonymousSessionHash(session: AnonymousSession): Promise<string> {
  return sha256Hex(`silsigan-anon:${session.id}`);
}

function anonymousUserIdFromHash(sessionHash: string): string {
  return `anon_${sessionHash.slice(0, 48)}`;
}

async function getD1AnonymousUser(db: D1Database, anonymousUserId: string): Promise<{ id: string } | null> {
  return db.prepare("SELECT id FROM anonymous_users WHERE id = ? LIMIT 1").bind(anonymousUserId).first<{ id: string }>();
}

async function assertD1AnonymousUserCanWrite(db: D1Database, anonymousUserId: string): Promise<void> {
  const deletion = await db
    .prepare(
      `SELECT id
       FROM account_deletion_requests
       WHERE anonymous_user_id = ? AND status = 'completed'
       LIMIT 1`,
    )
    .bind(anonymousUserId)
    .first<{ id: string }>();
  if (deletion) {
    throw new HttpError(403, "ACCOUNT_DELETED", "삭제가 완료된 계정에서는 새 활동을 만들 수 없습니다.");
  }

  const block = await db
    .prepare(
      `SELECT reason, blocked_until AS blockedUntil
       FROM blocked_users
       WHERE anonymous_user_id = ?
         AND (blocked_until IS NULL OR blocked_until > ?)
       LIMIT 1`,
    )
    .bind(anonymousUserId, new Date().toISOString())
    .first<D1BlockedUserRow>();

  if (!block) {
    return;
  }

  throw new HttpError(403, "USER_RESTRICTED", "운영 정책 위반으로 일시 제한된 사용자입니다.", {
    blockedUntil: block.blockedUntil,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Bytes(value);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function getD1VisibleComment(db: D1Database, commentId: string): Promise<D1CommentRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        body,
        like_count AS likeCount,
        hidden_at AS hiddenAt,
        created_at AS createdAt
      FROM comments
      WHERE id = ? AND status = 'visible' AND hidden_at IS NULL AND deleted_at IS NULL
      LIMIT 1`,
    )
    .bind(commentId)
    .first<D1CommentRow>();
}

async function getD1VisiblePhoto(db: D1Database, photoId: string): Promise<D1PhotoRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        r2_key AS storageKey,
        mime_type AS mimeType,
        byte_size AS byteSize,
        width,
        height,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
        status,
        deleted_at AS deletedAt,
        created_at AS createdAt
      FROM photos
      WHERE id = ? AND status = 'ready' AND deleted_at IS NULL AND hidden_at IS NULL
      LIMIT 1`,
    )
    .bind(photoId)
    .first<D1PhotoRow>();
}

async function getD1VisiblePost(db: D1Database, postId: string): Promise<PostRecord | null> {
  const row = await db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        creator_name AS creatorName,
        creator_badge AS creatorBadge,
        caption,
        crowd_level AS crowdLevel,
        parking_status AS parkingStatus,
        line_status AS lineStatus,
        weather_feel AS weatherFeel,
        location_verified AS locationVerified,
        verified_radius_m AS verifiedRadiusM,
        photo_count AS photoCount,
        photo_label AS photoLabel,
        helpful_count AS helpfulCount,
        comment_count AS commentCount,
        hashtag_names AS hashtagNames,
        hidden_at AS hiddenAt,
        created_at AS createdAt
      FROM posts
      WHERE id = ? AND status = 'visible' AND hidden_at IS NULL
      LIMIT 1`,
    )
    .bind(postId)
    .first<D1PostRow>();

  return row ? d1PostRowToRecord(row) : null;
}

async function getD1PublicRecentPhoto(db: D1Database, photoId: string): Promise<D1PhotoRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        r2_key AS storageKey,
        mime_type AS mimeType,
        byte_size AS byteSize,
        width,
        height,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
        status,
        deleted_at AS deletedAt,
        created_at AS createdAt
      FROM photos
      WHERE id = ?
        AND status = 'ready'
        AND deleted_at IS NULL
        AND hidden_at IS NULL
        AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}
      LIMIT 1`,
    )
    .bind(photoId)
    .first<D1PhotoRow>();
}

async function getD1Report(db: D1Database, reportId: string): Promise<D1ReportRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        target_type AS targetType,
        target_id AS targetId,
        reason,
        anonymous_user_id AS anonymousUserId,
        note,
        status,
        created_at AS createdAt
      FROM reports
      WHERE id = ?
      LIMIT 1`,
    )
    .bind(reportId)
    .first<D1ReportRow>();
}

async function getD1ModerationTarget(
  db: D1Database,
  targetType: ReportRecord["targetType"],
  targetId: string,
): Promise<D1ModerationTarget> {
  if (targetType === "place") {
    const row = await db.prepare("SELECT id, region_id AS regionId FROM places WHERE id = ? LIMIT 1").bind(targetId).first<{ id: string; regionId: string }>();
    return { exists: Boolean(row), storageKey: null, placeId: row?.id ?? null, regionId: row?.regionId ?? null };
  }

  if (targetType === "comment") {
    const row = await db
      .prepare(
        `SELECT c.id, c.place_id AS placeId, p.region_id AS regionId
         FROM comments c
         LEFT JOIN places p ON p.id = c.place_id
         WHERE c.id = ?
         LIMIT 1`,
      )
      .bind(targetId)
      .first<{ id: string; placeId: string; regionId: string | null }>();
    return { exists: Boolean(row), storageKey: null, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
  }

  if (targetType === "post") {
    const row = await db
      .prepare(
        `SELECT po.id, po.place_id AS placeId, p.region_id AS regionId
         FROM posts po
         LEFT JOIN places p ON p.id = po.place_id
         WHERE po.id = ?
         LIMIT 1`,
      )
      .bind(targetId)
      .first<{ id: string; placeId: string; regionId: string | null }>();
    return { exists: Boolean(row), storageKey: null, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
  }

  const row = await db
    .prepare(
      `SELECT ph.id, ph.place_id AS placeId, p.region_id AS regionId, ph.r2_key AS storageKey
       FROM photos ph
       LEFT JOIN places p ON p.id = ph.place_id
       WHERE ph.id = ?
       LIMIT 1`,
    )
    .bind(targetId)
    .first<{ id: string; placeId: string; regionId: string | null; storageKey: string }>();
  return { exists: Boolean(row), storageKey: row?.storageKey ?? null, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
}

async function applyD1ModerationAction(
  db: D1Database,
  targetType: ReportRecord["targetType"],
  targetId: string,
  action: AdminModerationAction,
  reason: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  if (targetType === "place") {
    const isActive = action === "restore" ? 1 : 0;
    const launchStage = action === "delete" ? "paused" : action === "restore" ? "active" : "paused";
    await db.prepare("UPDATE places SET is_active = ?, launch_stage = ?, updated_at = ? WHERE id = ?").bind(isActive, launchStage, now, targetId).run();
    return;
  }

  if (targetType === "comment") {
    if (action === "restore") {
      await db
        .prepare("UPDATE comments SET status = 'visible', hidden_at = NULL, hidden_reason = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(now, targetId)
        .run();
      return;
    }

    if (action === "delete") {
      await db
        .prepare("UPDATE comments SET status = 'deleted', hidden_at = ?, hidden_reason = ?, deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, reason, now, now, targetId)
        .run();
      return;
    }

    await db
      .prepare("UPDATE comments SET status = 'hidden', hidden_at = ?, hidden_reason = ?, updated_at = ? WHERE id = ?")
      .bind(now, reason, now, targetId)
      .run();
    return;
  }

  if (targetType === "post") {
    if (action === "restore") {
      await db.prepare("UPDATE posts SET status = 'visible', hidden_at = NULL, updated_at = ? WHERE id = ?").bind(now, targetId).run();
      return;
    }

    if (action === "delete") {
      await db.prepare("UPDATE posts SET status = 'deleted', hidden_at = ?, updated_at = ? WHERE id = ?").bind(now, now, targetId).run();
      return;
    }

    await db.prepare("UPDATE posts SET status = 'hidden', hidden_at = ?, updated_at = ? WHERE id = ?").bind(now, now, targetId).run();
    return;
  }

  if (action === "restore") {
    await db.prepare("UPDATE photos SET hidden_at = NULL WHERE id = ? AND deleted_at IS NULL").bind(targetId).run();
    return;
  }

  if (action === "delete") {
    await db.prepare("UPDATE photos SET hidden_at = ?, deleted_at = ? WHERE id = ?").bind(now, now, targetId).run();
    return;
  }

  await db.prepare("UPDATE photos SET hidden_at = ? WHERE id = ?").bind(now, targetId).run();
}

async function recordAdminAction(
  db: D1Database,
  request: Request,
  action: AdminActionType,
  targetType: ReportRecord["targetType"] | "anonymous_user" | "data_source",
  targetId: string,
  reason: string | null,
): Promise<void> {
  await db
    .prepare("INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`admin_${crypto.randomUUID()}`, adminSubject(request), action, targetType, targetId, reason, new Date().toISOString())
    .run();
}

async function getD1InteractionId(
  db: D1Database,
  anonymousUserId: string,
  targetType: "place" | "comment" | "photo",
  targetId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM likes WHERE anonymous_user_id = ? AND target_type = ? AND target_id = ? LIMIT 1")
    .bind(anonymousUserId, targetType, targetId)
    .first<{ id: string }>();

  return row?.id ?? null;
}

async function hasRecentD1PlaceClick(db: D1Database, placeId: string, anonymousUserId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id
       FROM place_events
       WHERE place_id = ?
         AND anonymous_user_id = ?
         AND event_type = 'click'
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
         AND expires_at > ${D1_NOW_SQL}
       LIMIT 1`,
    )
    .bind(placeId, anonymousUserId)
    .first<{ id: string }>();

  return Boolean(row);
}

async function createD1UniqueInteraction(
  db: D1Database,
  anonymousUserId: string,
  targetType: "place" | "comment" | "photo",
  targetId: string,
): Promise<boolean> {
  const existing = await getD1InteractionId(db, anonymousUserId, targetType, targetId);
  if (existing) {
    return false;
  }

  await db
    .prepare("INSERT INTO likes (id, anonymous_user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(`like_${crypto.randomUUID()}`, anonymousUserId, targetType, targetId, new Date().toISOString())
    .run();

  return true;
}

async function countD1Interactions(db: D1Database, targetType: "place" | "comment" | "photo", targetId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM likes WHERE target_type = ? AND target_id = ?")
    .bind(targetType, targetId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1VisibleComments(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM comments
       WHERE place_id = ?
         AND status = 'visible'
         AND hidden_at IS NULL
         AND deleted_at IS NULL
         AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1VisiblePhotos(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM photos
       WHERE place_id = ?
         AND status = 'ready'
         AND hidden_at IS NULL
         AND deleted_at IS NULL
         AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1OpenReportsForTarget(db: D1Database, targetType: ReportRecord["targetType"], targetId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'")
    .bind(targetType, targetId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1Events(db: D1Database, placeId: string, eventType: "click" | "like" | "comment" | "photo" | "report"): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM place_events
       WHERE place_id = ?
         AND event_type = ?
         AND expires_at > ${D1_NOW_SQL}`,
    )
    .bind(placeId, eventType)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1UniqueEventUsers(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT anonymous_user_id) AS count
       FROM place_events
       WHERE place_id = ?
         AND expires_at > ${D1_NOW_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function d1RankingCounts(db: D1Database, placeId: string): Promise<RankingCounts> {
  const [clickCount, likeCount, commentCount, photoCount, reportCount, uniqueUserCount] = await Promise.all([
    countD1Events(db, placeId, "click"),
    countD1Interactions(db, "place", placeId),
    countD1VisibleComments(db, placeId),
    countD1VisiblePhotos(db, placeId),
    countD1OpenReportsForTarget(db, "place", placeId),
    countD1UniqueEventUsers(db, placeId),
  ]);

  return { clickCount, likeCount, commentCount, photoCount, reportCount, uniqueUserCount };
}

async function recordD1PlaceEvent(
  db: D1Database,
  place: PlaceRecord,
  anonymousUserId: string,
  eventType: "click" | "like" | "comment" | "photo" | "report",
  options: D1PlaceEventOptions = {},
): Promise<void> {
  const now = new Date();
  const createdAt = options.createdAt ?? now.toISOString();
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + REPORT_TTL_MS).toISOString();
  const eventId = options.id ?? `event_${crypto.randomUUID()}`;
  const source = options.source ?? "worker_api";
  await db
    .prepare(
      `INSERT INTO place_events
        (
          id,
          place_id,
          anonymous_user_id,
          event_type,
          source,
          region_code,
          area_code,
          category,
          crowd_level,
          line_status,
          parking_status,
          verified_radius_m,
          created_at,
          expires_at
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      eventId,
      place.id,
      anonymousUserId,
      eventType,
      source,
      place.regionId,
      place.areaId,
      place.categoryId,
      options.crowdLevel ?? null,
      options.lineStatus ?? null,
      options.parkingStatus ?? null,
      options.verifiedRadiusM ?? null,
      createdAt,
      expiresAt,
    )
    .run();
  await incrementD1HourlyAggregate(db, place, eventType, createdAt);
}

async function incrementD1HourlyAggregate(
  db: D1Database,
  place: PlaceRecord,
  eventType: "click" | "like" | "comment" | "photo" | "report",
  createdAt: string,
): Promise<void> {
  const hourBucket = createdAt.slice(0, 13) + ":00:00.000Z";
  const nextHourBucket = new Date(new Date(hourBucket).getTime() + 60 * 60 * 1000).toISOString();
  const column = `${eventType}_count`;
  await db
    .prepare(
      `INSERT INTO place_event_hourly
        (id, place_id, region_code, area_code, category, hour_bucket, ${column}, unique_user_count)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)
       ON CONFLICT(place_id, hour_bucket) DO UPDATE SET
         ${column} = ${column} + 1,
         unique_user_count = unique_user_count + 1`,
    )
    .bind(`hour_${crypto.randomUUID()}`, place.id, place.regionId, place.areaId, place.categoryId, hourBucket)
    .run();
  await db
    .prepare(
      `UPDATE place_event_hourly
       SET unique_user_count = (
         SELECT COUNT(DISTINCT anonymous_user_id)
         FROM place_events
         WHERE place_id = ?
           AND created_at >= ?
           AND created_at < ?
       )
       WHERE place_id = ? AND hour_bucket = ?`,
    )
    .bind(place.id, hourBucket, nextHourBucket, place.id, hourBucket)
    .run();
}

async function incrementD1ReportCounter(db: D1Database, targetType: ReportRecord["targetType"], targetId: string): Promise<void> {
  if (targetType === "post") {
    return;
  }

  if (targetType === "comment") {
    await db.prepare("UPDATE comments SET report_count = report_count + 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), targetId).run();
    return;
  }

  if (targetType === "photo") {
    await db.prepare("UPDATE photos SET report_count = report_count + 1 WHERE id = ?").bind(targetId).run();
  }
}

async function applyD1ProtectionForReport(db: D1Database, report: Pick<ReportRecord, "targetType" | "targetId" | "reason">): Promise<void> {
  const shouldHideImmediately =
    report.reason === "privacy_face" || report.reason === "privacy_plate" || report.reason === "sensitive_info";
  const openReportCount = await countD1OpenReportsForTarget(db, report.targetType, report.targetId);
  if (!shouldHideImmediately && openReportCount < 3) {
    return;
  }

  const now = new Date().toISOString();
  const reason = shouldHideImmediately ? `auto_${report.reason}` : "auto_report_threshold";
  if (report.targetType === "comment") {
    await db.prepare("UPDATE comments SET status = 'hidden', hidden_at = ?, hidden_reason = ?, updated_at = ? WHERE id = ?").bind(now, reason, now, report.targetId).run();
  }

  if (report.targetType === "post") {
    await db.prepare("UPDATE posts SET status = 'hidden', hidden_at = ?, updated_at = ? WHERE id = ?").bind(now, now, report.targetId).run();
  }

  if (report.targetType === "photo") {
    await db.prepare("UPDATE photos SET hidden_at = ? WHERE id = ?").bind(now, report.targetId).run();
  }
}

function d1ModerationPriority(reason: ReportRecord["reason"]): "normal" | "high" | "urgent" {
  if (reason === "sensitive_info") {
    return "urgent";
  }

  if (reason === "privacy_face" || reason === "privacy_plate") {
    return "high";
  }

  return "normal";
}

function enqueueModerationAlert(
  ctx: ExecutionContext,
  env: Env,
  report: Pick<ReportRecord, "id" | "targetType" | "targetId" | "reason" | "createdAt">,
  priority: "normal" | "high" | "urgent",
): "webhook" | "none" {
  if (!env.MODERATION_ALERT_WEBHOOK_URL?.trim()) {
    return "none";
  }

  ctx.waitUntil(sendModerationAlert(env, report, priority).catch(() => undefined));

  return "webhook";
}

async function sendModerationAlert(
  env: Env,
  report: Pick<ReportRecord, "id" | "targetType" | "targetId" | "reason" | "createdAt">,
  priority: "normal" | "high" | "urgent",
): Promise<void> {
  const rawUrl = env.MODERATION_ALERT_WEBHOOK_URL?.trim();
  if (!rawUrl) {
    return;
  }

  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new HttpError(503, "MODERATION_ALERT_WEBHOOK_INVALID", "운영자 알림 webhook은 HTTPS만 허용합니다.");
  }

  const headers = new Headers({ "content-type": "application/json" });
  const token = env.MODERATION_ALERT_WEBHOOK_TOKEN?.trim();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const payload: ModerationAlertPayload = {
    type: "moderation.report.created",
    reportId: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    priority,
    queuePath: "/api/moderation/reports?status=open",
    environment: env.ENVIRONMENT ?? "development",
    createdAt: report.createdAt,
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new HttpError(502, "MODERATION_ALERT_WEBHOOK_FAILED", "운영자 알림 webhook 전송에 실패했습니다.");
  }
}

function adminSubject(request: Request): string {
  const header = request.headers.get("x-silsigan-admin-subject")?.trim();
  if (header && /^[a-zA-Z0-9@._:-]{3,120}$/.test(header)) {
    return header;
  }

  return "admin-token";
}

async function readJson(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON 요청만 지원합니다.");
  }

  const body = (await request.json()) as unknown;
  if (!isRecord(body)) {
    throw new HttpError(400, "INVALID_JSON", "JSON 객체가 필요합니다.");
  }

  return body;
}

function stringField(body: JsonObject, field: string, maxLength: number): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function commentBodyField(body: JsonObject): string {
  const value = stringField(body, "body", commentBodyMaxLength);
  if (value.length < commentBodyMinLength) {
    throw new HttpError(400, "VALIDATION_ERROR", "body 값이 올바르지 않습니다.");
  }

  const rejectionReason = commentBodyRejectionReason(value);
  if (rejectionReason) {
    throw new HttpError(400, "COMMENT_BODY_REJECTED", "댓글에 공개할 수 없는 정보나 스팸 패턴이 포함되어 있습니다.", { reason: rejectionReason });
  }

  return value;
}

function commentBodyRejectionReason(value: string): "phone" | "resident_id" | "script" | "url_spam" | null {
  const normalized = value.toLocaleLowerCase("ko-KR");
  if (/(?:\+?82[-.\s]?)?0(?:10|2|[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(value)) {
    return "phone";
  }
  if (/\b\d{6}[-\s]?[1-4]\d{6}\b/.test(value)) {
    return "resident_id";
  }
  if (/<\s*script\b|javascript\s*:|on(?:error|load|click|mouseover)\s*=/.test(normalized)) {
    return "script";
  }

  const urlMatches = value.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? [];
  const urlTextLength = urlMatches.reduce((sum, match) => sum + match.length, 0);
  if (urlMatches.length >= 2 || (urlMatches.length === 1 && urlTextLength / value.length > 0.6)) {
    return "url_spam";
  }

  return null;
}

function optionalStringField(body: JsonObject, field: string, maxLength: number): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function sourceRegionsField(body: JsonObject, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length > 50) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  const regions = value.map((item) => {
    if (typeof item !== "string" || !/^(?:\*|[a-z0-9][a-z0-9_-]{1,59})$/.test(item)) {
      throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
    }
    return item;
  });
  return [...new Set(regions)];
}

function sourceRightsReviewedAtField(body: JsonObject, field: string): string {
  const value = stringField(body, field, 40);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60 * 1_000) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return new Date(timestamp).toISOString();
}

function nullableIntegerField(body: JsonObject, field: string, min: number, max: number): number | null {
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function integerField(body: JsonObject, field: string, min: number, max: number, fallback: number): number {
  const value = body[field];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function hashtagNamesField(body: JsonObject, field: string, maxItems: number): string[] {
  const value = body[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return uniqueHashtagNames(value.map((item) => {
    if (typeof item !== "string") {
      throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
    }

    return item;
  }));
}

function anonymousUserIdField(body: JsonObject, field: string): string {
  const value = stringField(body, field, 80);
  if (!/^anon_[a-f0-9]{48}$/i.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function optionalFutureIsoDateField(body: JsonObject, field: string): string | null {
  const value = optionalStringField(body, field, 40);
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  if (ms <= Date.now()) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값은 미래 시각이어야 합니다.`);
  }

  return new Date(ms).toISOString();
}

function bulkModerationTargetsField(body: JsonObject, maxTargets: number): AdminBulkModerationTarget[] {
  const rawTargets = body["targets"];
  if (!Array.isArray(rawTargets) || rawTargets.length < 1 || rawTargets.length > maxTargets) {
    throw new HttpError(400, "VALIDATION_ERROR", `targets는 1~${maxTargets}개 배열이어야 합니다.`);
  }

  return rawTargets.map((target, index) => {
    if (!isRecord(target)) {
      throw new HttpError(400, "VALIDATION_ERROR", `targets[${index}] 값이 올바르지 않습니다.`);
    }

    return {
      targetType: enumField(target, "targetType", ["place", "post", "comment", "photo"] as const),
      targetId: stringField(target, "targetId", 100),
    };
  });
}

function numberField(body: JsonObject, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function coordinateField(body: JsonObject, field: string, min: number, max: number): number {
  const value = numberField(body, field);
  if (value < min || value > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function booleanField(body: JsonObject, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function enumField<TValue extends string>(body: JsonObject, field: string, values: readonly TValue[]): TValue {
  const value = body[field];
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value as TValue;
}

function optionalEnumField<TValue extends string>(
  body: JsonObject,
  field: string,
  values: readonly TValue[],
): TValue | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return value as TValue;
}

function optionalEnumArrayField<TValue extends string>(
  body: JsonObject,
  field: string,
  values: readonly TValue[],
): TValue[] {
  const value = body[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > values.length) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  const result: TValue[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !values.includes(item as TValue)) {
      throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
    }
    if (!result.includes(item as TValue)) {
      result.push(item as TValue);
    }
  }
  return result;
}

function enumFromSearch<TValue extends string>(url: URL, field: string, values: readonly TValue[], fallback: TValue): TValue {
  const value = url.searchParams.get(field);
  if (!value) {
    return fallback;
  }

  if (!values.includes(value as TValue)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value as TValue;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json<TData>(data: TData, meta?: Record<string, unknown>, status = 200): Response {
  const body: ApiResponse<TData> = {
    success: true,
    data,
    ...(meta ? { meta } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function errorToResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }

  if (error instanceof Error) {
    return errorResponse(400, publicErrorCode(error), "요청 정책을 만족하지 않습니다.");
  }

  return errorResponse(500, "INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.");
}

function publicErrorCode(error: Error): string {
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : "POLICY_ERROR";
}

function withHeaders(response: Response, extraHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  extraHeaders.forEach((value, key) => headers.append(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-silsigan-anon-id,x-silsigan-admin-token,x-silsigan-admin-subject",
    "access-control-expose-headers": "x-silsigan-anon-id",
  };
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function clientIpHint(request: Request): string {
  const raw = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return raw ? `ip-hint:${raw.length}:${raw.charCodeAt(0)}` : "local";
}

function roomKey(scope: RoomBroadcast["scope"], roomId: string): string {
  return `${scope}:${roomId}`;
}

function getRoomEvents(key: string): RoomBroadcast[] {
  return roomEvents.get(key) ?? [];
}

function placeClickWindowsFor(anonymousUserId: string): Map<string, number> {
  const existing = placeClickWindowsByAnon.get(anonymousUserId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, number>();
  placeClickWindowsByAnon.set(anonymousUserId, next);

  return next;
}

function parseRankingRoute(path: string): RankingRoute {
  if (path === "/api/rankings/global") {
    return { kind: "global", regionId: null, areaId: null, categoryId: null };
  }

  const areaMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)\/areas\/([^/]+)$/);
  if (areaMatch) {
    return {
      kind: "area",
      regionId: decodeURIComponent(areaMatch[1]),
      areaId: decodeURIComponent(areaMatch[2]),
      categoryId: null,
    };
  }

  const categoryMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)\/categories\/([^/]+)$/);
  if (categoryMatch) {
    return {
      kind: "category",
      regionId: decodeURIComponent(categoryMatch[1]),
      areaId: null,
      categoryId: decodeURIComponent(categoryMatch[2]),
    };
  }

  const regionMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)$/);
  if (regionMatch) {
    return {
      kind: "region",
      regionId: decodeURIComponent(regionMatch[1]),
      areaId: null,
      categoryId: null,
    };
  }

  return { kind: "generic", regionId: null, areaId: null, categoryId: null };
}

function d1PlaceSelectSql(): string {
  return `
    SELECT
      p.id,
      p.name,
      p.category_id AS categoryId,
      p.area_id AS areaId,
      p.region_id AS regionId,
      p.latitude,
      p.longitude,
      p.coordinate_status AS coordinateStatus,
      CASE
        WHEN COALESCE(r.score, 0) + COALESCE(e.live_score, 0) < 0 THEN 0
        ELSE COALESCE(r.score, 0) + COALESCE(e.live_score, 0)
      END AS score,
      p.launch_stage AS status
    FROM places p
    LEFT JOIN place_rankings r
      ON r.place_id = p.id
      AND r.region_id = p.region_id
      AND r.window_hours = 24
    LEFT JOIN (
      SELECT
        place_id,
        SUM(
          CASE
            WHEN event_type = 'photo' THEN 8
            WHEN event_type = 'report' AND source = 'field_report' THEN 6
            WHEN event_type = 'comment' THEN 4
            WHEN event_type = 'like' THEN 2
            WHEN event_type = 'click' THEN 1
            WHEN event_type = 'report' THEN -15
            ELSE 0
          END
        ) AS live_score
      FROM place_events
      WHERE expires_at > ${D1_NOW_SQL}
      GROUP BY place_id
    ) e
      ON e.place_id = p.id
  `;
}

function d1PlacesQuery({
  areaId,
  bbox,
  categoryId,
  limit,
  query,
  regionId,
  requireRankingSignal = false,
}: {
  areaId: string | null;
  bbox: BBox | null;
  categoryId: string | null;
  limit: number;
  query: string | null | undefined;
  regionId: string | null;
  requireRankingSignal?: boolean;
}): { sql: string; values: D1Value[]; limit: number } {
  const where = ["p.is_active = 1", "p.coordinate_status = 'verified'", "p.latitude IS NOT NULL", "p.longitude IS NOT NULL"];
  const values: D1Value[] = [];

  if (bbox) {
    where.push("p.latitude BETWEEN ? AND ?");
    values.push(bbox.minLat, bbox.maxLat);
    where.push("p.longitude BETWEEN ? AND ?");
    values.push(bbox.minLng, bbox.maxLng);
  }

  if (regionId) {
    where.push("p.region_id = ?");
    values.push(regionId);
  }

  if (areaId) {
    where.push("p.area_id = ?");
    values.push(areaId);
  }

  if (categoryId) {
    where.push("p.category_id = ?");
    values.push(categoryId);
  }

  if (query) {
    where.push("LOWER(p.name) LIKE ?");
    values.push(`%${query}%`);
  }

  if (requireRankingSignal) {
    where.push("(COALESCE(r.score, 0) > 0 OR COALESCE(e.live_score, 0) > 0)");
  }

  values.push(limit);

  return {
    sql: `${d1PlaceSelectSql()}
      WHERE ${where.join(" AND ")}
      ORDER BY score DESC, p.name ASC
      LIMIT ?`,
    values,
    limit,
  };
}

function d1PlaceRowToRecord(row: D1PlaceRow): PlaceRecord {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    areaId: row.areaId,
    regionId: row.regionId,
    latitude: row.latitude,
    longitude: row.longitude,
    score: row.score ?? 0,
    status: row.status,
    coordinateStatus: row.coordinateStatus,
  };
}

function rankingRecordForPlace(place: PlaceRecord, rank: number, counts: RankingCounts): RankingRecord {
  return {
    placeId: place.id,
    name: place.name,
    regionId: place.regionId,
    regionCode: place.regionId,
    areaCode: place.areaId,
    category: place.categoryId,
    score: place.score,
    rank,
    windowHours: 24,
    clickCount: counts.clickCount,
    likeCount: counts.likeCount,
    commentCount: counts.commentCount,
    photoCount: counts.photoCount,
    reportCount: counts.reportCount,
    uniqueUserCount: counts.uniqueUserCount,
    trend: "same",
    summary: d1PlaceStatusSummary(counts.commentCount, counts.photoCount),
  };
}

function memoryRankingCounts(placeId: string): RankingCounts {
  const activeComments = comments.filter((comment) => comment.placeId === placeId && !comment.hiddenAt && isActiveRecentContent(comment.createdAt));
  const activePhotos = photos.filter(
    (photo) => photo.placeId === placeId && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt),
  );
  const openPlaceReports = reports.filter((report) => report.targetType === "place" && report.targetId === placeId && report.status === "open");
  const uniqueUserIds = new Set<string>();

  for (const comment of activeComments) {
    uniqueUserIds.add(comment.anonymousUserId);
  }

  for (const photo of activePhotos) {
    uniqueUserIds.add(photo.anonymousUserId);
  }

  for (const report of openPlaceReports) {
    uniqueUserIds.add(report.anonymousUserId);
  }

  return {
    clickCount: placeClickCounts.get(placeId) ?? 0,
    likeCount: placeLikeCounts.get(placeId) ?? 0,
    commentCount: activeComments.length,
    photoCount: activePhotos.length,
    reportCount: openPlaceReports.length,
    uniqueUserCount: uniqueUserIds.size,
  };
}

function placeStatusSummary(place: PlaceRecord): string {
  const commentCount = comments.filter((comment) => comment.placeId === place.id && !comment.hiddenAt && isActiveRecentContent(comment.createdAt)).length;
  const photoCount = photos.filter((photo) => photo.placeId === place.id && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt)).length;
  return d1PlaceStatusSummary(commentCount, photoCount);
}

function isActiveRecentContent(createdAt: string, now = new Date()): boolean {
  const createdAtMs = new Date(createdAt).getTime();
  return Number.isFinite(createdAtMs) && createdAtMs > now.getTime() - REPORT_TTL_MS;
}

function d1PlaceStatusSummary(commentCount: number, photoCount: number): string {
  if (commentCount === 0 && photoCount === 0) {
    return "정보 없음";
  }

  return `댓글 ${commentCount}개 · 사진 ${photoCount}장 · 실시간 사용자 제보 기반`;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const testExecutionContext: ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void {
    void promise;
  },
};

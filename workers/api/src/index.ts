import {
  type ApiResponse,
  type BBox,
  type LikePolicyState,
  type PlaceRecord,
  type RankingRecord,
  type RateLimitState,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_DIMENSION,
  MAX_REGION_RANKING_LIMIT,
  applyBoundedSlidingWindowRateLimit,
  clampLimit,
  filterPlacesByBBox,
  filterPlacesByRadius,
  intersectBBoxes,
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
  FEATURE_GATED_API_FLAGS,
  INITIAL_DIMENSION_SETTINGS,
  PHOTO_RIGHTS_TERMS_VERSION,
  aggregatePlaceSignals,
  featureFlagKeys,
  isLiveSignalCurrent,
  listObservedReportSignals,
  locationAccuracyBucketForMeters,
  resolveFeatureFlag,
  resolveSignalExpiry,
  validateLiveSignal,
  type FeatureFlagKey,
  type FeatureFlagValue,
  type AggregatedPlaceStatus,
  type DecisionProfile,
  type LiveSignal,
  type LiveSignalDimension,
  type LocationAccuracyBucket,
} from "../../../packages/contracts/src/index.ts";
import { PublicDataGateway, PublicDataGatewayError } from "./public-data/gateway.ts";
import { createKmaWeatherAdapter } from "./public-data/kma-weather-adapter.ts";
import { createTourApiAdapter } from "./public-data/tour-api-adapter.ts";
import { createNationalParkingAdapter } from "./public-data/national-parking-adapter.ts";
import { createNationalTrafficAdapter } from "./public-data/national-traffic-adapter.ts";
import { createNationalCctvAdapter } from "./public-data/national-cctv-adapter.ts";
import { createSeoulRealtimeAdapter } from "./public-data/seoul-realtime-adapter.ts";
import {
  parseVerificationGeometry,
  verifyFieldLocation,
  type FieldVerificationMethod,
  type PlaceVerificationContext,
  type VerificationPlaceKind,
} from "./location-verification.ts";

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

type ScheduledControllerLike = {
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry: () => void;
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

type DurableObjectState = {
  acceptWebSocket: (socket: WorkerWebSocket, tags?: string[]) => void;
  getWebSockets: (tag?: string) => WorkerWebSocket[];
  storage: DurableObjectStorage;
};

type DurableObjectStorage = {
  get: <TValue = unknown>(key: string) => Promise<TValue | undefined>;
  put: <TValue>(key: string, value: TValue) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  setAlarm: (scheduledTime: number | Date) => Promise<void>;
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

type WorkerCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

type RateLimitBinding = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
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
  COST_ALERT_WEBHOOK_URL?: string;
  COST_ALERT_WEBHOOK_TOKEN?: string;
  KMA_SERVICE_KEY?: string;
  TOUR_API_SERVICE_KEY?: string;
  NATIONAL_PARKING_SERVICE_KEY?: string;
  NATIONAL_PARKING_ENDPOINT_URL?: string;
  ITS_SERVICE_KEY?: string;
  SEOUL_REALTIME_SERVICE_KEY?: string;
  MEMBER_LINK_HMAC_SECRET?: string;
  SILSIGAN_PUBLIC_SITE_URL?: string;
  SILSIGAN_API_ALLOWED_ORIGINS?: string;
  SILSIGAN_ANON_SESSION_REQUIRED?: string;
  SILSIGAN_ANON_SESSION_DAILY_LIMIT?: string;
  SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED?: string;
  SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED?: string;
  SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT?: string;
  SILSIGAN_D1_DAILY_READ_LIMIT?: string;
  SILSIGAN_D1_DAILY_WRITE_LIMIT?: string;
  SILSIGAN_COST_GUARD_WARN_PERCENT?: string;
  SILSIGAN_COST_GUARD_DEGRADE_PERCENT?: string;
  SILSIGAN_COST_GUARD_STOP_PERCENT?: string;
  SILSIGAN_SOURCE_INGESTION_SCHEDULED?: string;
  SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT?: string;
  SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT?: string;
  SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT?: string;
  SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT?: string;
  SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT?: string;
  SILSIGAN_PHOTO_STORAGE_MAX_BYTES?: string;
  SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT?: string;
  SILSIGAN_PHOTO_MONTHLY_TRANSFORM_LIMIT?: string;
  SILSIGAN_PHOTO_MONTHLY_READ_LIMIT?: string;
  SILSIGAN_PHOTO_DAILY_READ_LIMIT?: string;
  SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT?: string;
  SILSIGAN_PHOTO_DAILY_UPLOAD_LIMIT?: string;
  SILSIGAN_PHOTO_DAILY_BYTES_LIMIT?: string;
  SILSIGAN_PHOTO_TICKET_TTL_SECONDS?: string;
  SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET?: string;
  SILSIGAN_PHOTO_TURNSTILE_REQUIRED?: string;
  SILSIGAN_TURNSTILE_SITE_KEY?: string;
  SILSIGAN_TURNSTILE_SECRET_KEY?: string;
  PUBLIC_API_RATE_LIMITER?: RateLimitBinding;
  ADMIN_API_RATE_LIMITER?: RateLimitBinding;
  HIGH_COST_API_RATE_LIMITER?: RateLimitBinding;
  ANONYMOUS_SESSION_RATE_LIMITER?: RateLimitBinding;
  PHOTO_UPLOAD_RATE_LIMITER?: RateLimitBinding;
  PHOTO_READ_RATE_LIMITER?: RateLimitBinding;
  COST_GUARD_STATE?: KVNamespace;
  ENVIRONMENT?: string;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
  batch?: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type D1PreparedStatement = {
  bind: (...values: D1Value[]) => D1PreparedStatement;
  all: <TRecord>() => Promise<{ results?: TRecord[] }>;
  first: <TRecord>() => Promise<TRecord | null>;
  run: () => Promise<unknown>;
  toSql?: () => string;
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

type D1SourceIngestionTargetRow = {
  id: string;
  sourceId: string;
  sourceKey: string;
  placeId: string;
  adapterConfigJson: string;
  refreshIntervalSeconds: number;
  sourceRefreshIntervalSeconds: number | null;
  consecutiveFailures: number;
  updatedAt: string;
};

export type ScheduledSourceIngestionSummary = {
  scheduledAt: string;
  examinedCount: number;
  claimedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  errorCodes: Record<string, number>;
};

type D1PhotoCleanupJobRow = {
  id: string;
  storageKey: string;
  byteSize: number;
  attempts: number;
  updatedAt: string;
};

type D1PublicationOutboxRow = {
  id: string;
  aggregateId: string;
  eventType: string;
  payloadJson: string;
  attempts: number;
  updatedAt: string;
};

export type ScheduledBackgroundJobSummary = {
  scheduledAt: string;
  examinedCount: number;
  claimedCount: number;
  succeededCount: number;
  retriedCount: number;
  deadLetteredCount: number;
  skippedCount: number;
  errorCodes: Record<string, number>;
};

type ScheduledConsumerResult<TSummary> =
  | { ok: true; summary: TSummary }
  | { ok: true; skipped: true; reason: "disabled-by-environment" }
  | { ok: false; errorCode: string };

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
  expiresAt: string;
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
  officialTourismPlace?: OfficialTourismPlace | null;
  observedAt: string | null;
  computedAt: string;
};

type OfficialTourismPlace = {
  contentId: string;
  name: string;
  address: string | null;
  sourceName: "한국관광공사 TourAPI";
  attributionText: "한국관광공사";
  verifiedAt: string;
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

type D1PlaceVerificationRow = {
  placeKind: VerificationPlaceKind;
  geometryJson: string | null;
  verificationRadiusM: number | null;
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
  clientReportedProximity: number;
  proximityRadiusM: 50 | 150 | 300 | null;
  proximityAccuracyBucket: LocationAccuracyBucket;
  status: PhotoRecord["status"];
  deletedAt: string | null;
  createdAt: string;
};

type D1PhotoStorageBudgetRow = {
  activeBytes: number;
  periodUtc: string;
  writesInPeriod: number;
  uploadsEnabled?: number;
};

type D1PhotoReadBudgetRow = {
  periodUtc: string;
  readsInPeriod: number;
  dayUtc: string;
  readsInDay: number;
  readsEnabled?: number;
};

type D1PhotoTransformBudgetRow = {
  periodUtc: string;
  transformsInPeriod: number;
  uploadsEnabled?: number;
};

type PhotoStorageBudgetReservation = D1PhotoStorageBudgetRow & {
  storageMaxBytes: number;
  storageStopBytes: number;
  monthlyWriteLimit: number;
  monthlyWriteStopLimit: number;
  automaticStopTriggered: boolean;
};

type PhotoReadBudgetReservation = D1PhotoReadBudgetRow & {
  monthlyReadLimit: number;
  monthlyReadStopLimit: number;
  dailyReadLimit: number;
  dailyReadStopLimit: number;
  automaticStopTriggered: boolean;
  automaticStopReason: "automatic-80-percent-monthly-read-cost-guard" | "automatic-80-percent-daily-read-cost-guard" | null;
};

type PhotoTransformBudgetReservation = D1PhotoTransformBudgetRow & {
  monthlyTransformLimit: number;
  monthlyTransformStopLimit: number;
  automaticStopTriggered: boolean;
};

type D1PhotoAbuseBudgetRow = {
  uploadCount: number;
  bytesInPeriod: number;
};

type D1PhotoReadAbuseBudgetRow = {
  readCount: number;
};

type PhotoAbuseBudgetReservation = D1PhotoAbuseBudgetRow & {
  dayUtc: string;
  dailyUploadLimit: number;
  dailyBytesLimit: number;
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
  moderationStatus: FieldReportModerationStatus;
  expiresAt: string | null;
};

type D1CountRow = {
  count: number;
};

type D1AnalyticsEventCountRow = {
  eventName: string;
  count: number;
  uniqueActors: number;
};

type D1BetaAudienceRow = {
  activeUsers: number;
};

type D1BetaDurationRow = {
  durationMs: number;
};

type D1BetaModerationRow = {
  submitted: number;
  pending: number;
  approved: number;
  rejected: number;
  hidden: number;
  reviewedWithin24Hours: number;
};

type D1BetaRetentionRow = {
  cohortUsers: number;
  retainedUsers: number;
};

type D1BetaFreshCoverageRow = {
  eligiblePlaces: number;
  coveredPlaces: number;
  tierAEligiblePlaces: number;
  tierACoveredPlaces: number;
  tierBEligiblePlaces: number;
  tierBCoveredPlaces: number;
};

type D1BetaRuntimeReliabilityRow = {
  appOpenUsers: number;
  errorUsers: number;
};

type AdminModerationAction = "hide" | "restore" | "delete";
type AdminBulkModerationAction = Exclude<AdminModerationAction, "delete">;
type PlaceAdditionRequestStatus = "needs_verification" | "ready_for_manual_import" | "duplicate" | "rejected";
type AdminActionType =
  | AdminModerationAction
  | `bulk_${AdminBulkModerationAction}`
  | `report_${ReportRecord["status"]}`
  | "photo_approved"
  | "photo_rejected"
  | "place_coordinate_status"
  | "user_restrict"
  | "user_unrestrict"
  | "source_policy_updated"
  | "photo_cost_guard"
  | "field_report_approved"
  | "field_report_rejected"
  | "field_report_hidden"
  | `place_request_${PlaceAdditionRequestStatus}`;
type AdminRole = "operator" | "moderator" | "admin";

type AdminCredential = {
  role: AdminRole;
  token: string;
  source: "ADMIN_TOKEN" | "ADMIN_TOKENS";
};

type D1ModerationTarget = {
  exists: boolean;
  storageKey: string | null;
  byteSize: number;
  placeId: string | null;
  regionId: string | null;
};

type CacheInvalidationResult = {
  binding: "CACHE" | "none";
  keys: string[];
  deletedKeys: string[];
};

type JsonObject = Record<string, unknown>;

type PlaceAdditionRequestRecord = {
  id: string;
  clientRequestId: string;
  name: string;
  address: string;
  category: string;
  status: PlaceAdditionRequestStatus;
  reviewReason: string | null;
  matchedPlaceId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

type PublicPlaceAdditionRequestRecord = Omit<PlaceAdditionRequestRecord, "reviewReason">;

type PreferenceState = {
  savedPlaceIds: Set<string>;
  savedPostIds: Set<string>;
  followedTopicNames: Set<string>;
  notificationEnabled: boolean;
};

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

type PhotoCostAlertPayload = {
  type: "cost.photo-uploads.stopped" | "cost.photo-reads.stopped" | "cost.photo-r2.stopped";
  reason: string;
  environment: string;
  stopPercent: number;
  activeBytes: number | null;
  storageStopBytes: number | null;
  writesInPeriod: number | null;
  monthlyWriteStopLimit: number | null;
  transformsInPeriod: number | null;
  monthlyTransformStopLimit: number | null;
  readsInPeriod: number | null;
  monthlyReadStopLimit: number | null;
  readsInDay: number | null;
  dailyReadStopLimit: number | null;
  guardPath: string;
  createdAt: string;
};

type AnonymousSession = {
  id: string;
  isNew: boolean;
  verified: boolean;
};

type D1AnonymousSessionRow = {
  proofHash: string;
  status: "active" | "revoked";
  expiresAt: string;
  lastSeenAt: string;
};

type D1AnonymousSessionIssuanceBudgetRow = {
  issueCount: number;
};

type ApiCostGuardMode = "running" | "degraded" | "stopped";
type ApiCostGuardMetric = "workers_requests" | "d1_rows_read" | "d1_rows_written" | "manual";
type ApiCostRouteClass =
  | "CONTROL"
  | "AUTH_ATTEMPT"
  | "WRITE_VALIDATION"
  | "ESSENTIAL_PUBLIC"
  | "STANDARD_PUBLIC_READ"
  | "HIGH_COST_READ"
  | "PERSONAL_READ"
  | "USER_WRITE"
  | "HIGH_COST_WRITE"
  | "CRITICAL_WRITE";

type ApiCostGuardControlRow = {
  mode: ApiCostGuardMode;
  reason: string;
  generation: number;
  automaticMetric: ApiCostGuardMetric | null;
  updatedBy: string;
  updatedAt: string;
};

type ApiCostGuardAlertPayload = {
  type: "cost.api-guard.warning" | "cost.api-guard.changed";
  mode: ApiCostGuardMode;
  reason: string;
  metric: ApiCostGuardMetric | null;
  thresholdPercent: number | null;
  generation: number;
  environment: string;
  guardPath: string;
  createdAt: string;
};

type ApiCostGuardDailyRow = {
  dayUtc: string;
  admittedRequests: number;
  reservedWorkersRequests: number;
  reservedRowsRead: number;
  reservedRowsWritten: number;
  criticalRequests: number;
  criticalRowsRead: number;
  criticalRowsWritten: number;
  highCostRequests: number;
  mutationRequests: number;
  observedWorkersRequests: number;
  observedRowsRead: number;
  observedRowsWritten: number;
  updatedAt: string;
};

type ApiCostGuardDecision = {
  fallbackToSnapshot: boolean;
  reserveAfterAuthentication: boolean;
};

type ApiCostGuardReservationOptions = {
  authenticationAttemptReserved?: boolean;
  criticalAdmission?: boolean;
  control?: ApiCostGuardControlRow;
};

type ApiCostGuardReservationPlan = {
  statement: D1PreparedStatement;
  limits: ReturnType<typeof apiCostGuardLimits>;
  admissionPercent: number;
  criticalAdmission: boolean;
  dayUtc: string;
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
  clientReportedProximity?: boolean | number;
  proximityRadiusM?: 50 | 150 | 300 | null;
  proximityAccuracyBucket?: LocationAccuracyBucket;
  status: "pending" | "ready" | "rejected";
  deletedAt: string | null;
  createdAt: string;
};

type PublicPhotoRecord = Pick<
  PhotoRecord,
  "id" | "placeId" | "mimeType" | "byteSize" | "width" | "height" | "clickCount" | "status" | "createdAt"
> & {
  clientReportedProximity: {
    evidence: typeof photoLocationEvidence;
    radiusM: 50 | 150 | 300;
    accuracyBucket: LocationAccuracyBucket;
  } | null;
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

type ProcessedPhotoForR2 = {
  photo: SanitizedPhoto;
  transformReservation: PhotoTransformBudgetReservation | null;
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

type FieldReportModerationStatus = "pending" | "approved" | "rejected" | "hidden";

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
  verificationMethod: FieldVerificationMethod;
  accuracyBucket: LocationAccuracyBucket;
  moderationStatus: FieldReportModerationStatus;
  createdAt: string;
  expiresAt: string;
  hasPhoto: boolean;
};

type FieldReportPublication = {
  clientRequestId: string | null;
  photoIds: string[];
  hashtagNames: string[];
};

type FieldReportPublicationResponse = ReturnType<typeof fieldReportResponse>;

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
  latestObservedAt: string | null;
  activePlaceCount: number;
  recentPhotoCount: number;
  recentMedia: HashtagRecentMediaRecord[];
  nextCursor: string | null;
};

type HashtagRecentMediaRecord = {
  id: string;
  placeId: string;
  category: string;
  moderationStatus: "approved";
  photoIds: string[];
  hashtagNames: string[];
  createdAt: string;
  expiresAt: string;
};

type ShareCardRecord = {
  headline: string;
  body: string;
  url: string;
  hashtags: string[];
  variant: "neutral";
};

type ClientLocation = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
};

type FieldReportCredit = {
  type: "verified_report" | "photo_report";
  amount: 1;
};

type D1FieldReportRow = {
  id: string;
  placeId: string;
  placeName?: string;
  category: FieldReportRecord["category"];
  crowdLevel: CrowdLevel | null;
  lineStatus: LineStatus | null;
  parkingStatus: ParkingStatus | null;
  verifiedRadiusM: FieldReportRecord["verifiedRadiusM"];
  verificationMethod: FieldVerificationMethod;
  accuracyBucket: LocationAccuracyBucket;
  moderationStatus: FieldReportModerationStatus;
  photoIds?: string | null;
  hashtagNames?: string | null;
  createdAt: string;
  expiresAt: string;
};

type PublicFieldReportRecord = Omit<FieldReportRecord, "anonymousUserId" | "hasPhoto"> & {
  photoIds: string[];
  hashtagNames: string[];
};

type PlaceEventSource = "worker_api" | "field_report" | "detail" | "map_marker" | "ranking" | "search_result";
type PlaceClickSource = Exclude<PlaceEventSource, "field_report">;

type D1PlaceEventOptions = {
  id?: string;
  source?: PlaceEventSource;
  crowdLevel?: CrowdLevel | null;
  lineStatus?: LineStatus | null;
  parkingStatus?: ParkingStatus | null;
  verifiedRadiusM?: FieldReportRecord["verifiedRadiusM"];
  verificationMethod?: FieldVerificationMethod;
  accuracyBucket?: LocationAccuracyBucket;
  moderationStatus?: FieldReportModerationStatus;
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
const fieldReportPublicationResponses = new Map<string, { placeId: string; response: FieldReportPublicationResponse }>();
const fieldReportPublicationsByReportId = new Map<string, FieldReportPublication>();
const liveSignals: LiveSignal[] = [];
const rateBuckets = new Map<string, RateLimitState>();
const rateBucketCapacity = 4_096;
const likeStateByAnon = new Map<string, LikePolicyState>();
const placeLikeCounts = new Map<string, number>();
const placeClickCounts = new Map<string, number>();
const placeClickWindowsByAnon = new Map<string, Map<string, number>>();
const roomEvents = new Map<string, RoomBroadcast[]>();
const photoContentHashes = new Map<string, string>();
const preferencesByAnonymousId = new Map<string, PreferenceState>();
const commentCreateMinuteLimit = 5;
const commentCreateDailyLimit = 100;
const commentBodyMaxLength = 280;
const commentBodyMinLength = 2;
const oneMinuteMs = 60_000;
const oneDayMs = 24 * 60 * 60_000;
const photoSecurityLedgerRetentionMs = 2 * oneDayMs;
const anonymousSessionDailyFreeSafetyCeiling = 5_000;
const workersDailyRequestFreeSafetyCeiling = 100_000;
const d1DailyReadFreeSafetyCeiling = 5_000_000;
const d1DailyWriteFreeSafetyCeiling = 100_000;
const apiCostGuardCompiledWarnPercent = 60;
const apiCostGuardCompiledDegradePercent = 70;
const apiCostGuardCompiledStopPercent = 80;
const apiCostGuardReconciliationFreshnessMs = 15 * 60_000;
const apiCostGuardStateKey = "api-cost-guard:global:v1";
const placeAdditionRequestCostGuardStopPercent = 80;
const placeAdditionRequestDailyFreeSafetyCeiling = 2_000;
const placeAdditionRequestDailyStopLimit = Math.floor(
  (placeAdditionRequestDailyFreeSafetyCeiling * placeAdditionRequestCostGuardStopPercent) / 100,
);
const placeAdditionRequestPerSessionDailyLimit = 3;
const reportChangedVoteThreshold = 3;
const identityLinkMaxClockSkewMs = 5 * 60_000;
const photoStorageFreeSafetyCeilingBytes = 4 * 1024 * 1024 * 1024;
const photoMonthlyWriteFreeSafetyCeiling = 16_000;
const photoMonthlyTransformFreeSafetyCeiling = 5_000;
const photoMonthlyReadFreeSafetyCeiling = 1_000_000;
const photoDailyReadFreeSafetyCeiling = 20_000;
const photoDailyIpReadFreeSafetyCeiling = 1_000;
const photoDailyUploadFreeSafetyCeiling = 20;
const photoDailyBytesFreeSafetyCeiling = 20 * PHOTO_MAX_BYTES;
const photoCostGuardStopPercent = 80;
const photoUploadTicketTtlSafetyCeilingSeconds = 5 * 60;
const photoUploadTicketClockSkewMs = 30_000;
const photoTurnstileAction = "photo_upload";
const photoTurnstileTokenMaxLength = 2_048;
const photoLocationAccuracyBuckets = ["high", "medium", "low", "unknown"] as const;
const photoLocationEvidence = "client_reported_coordinates_within_radius" as const;
const photoTurnstileSiteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const photoTurnstileTimeoutMs = 5_000;
const photoMultipartOverheadMaxBytes = 512 * 1024;
const jsonRequestBodyMaxBytes = 64 * 1024;
const photoJsonRequestBodyMaxBytes = Math.ceil(PHOTO_MAX_BYTES * 1.4) + photoMultipartOverheadMaxBytes;
const scheduledSourceKeys = new Set(["kma_weather", "national_traffic", "seoul_realtime_city"]);
const scheduledSourceBatchSize = 10;
const scheduledSourceLeaseMs = 4 * 60_000;
const scheduledSourceMaximumBackoffSeconds = 6 * 60 * 60;
const scheduledBackgroundJobBatchSize = 10;
const scheduledBackgroundJobLeaseMs = 4 * 60_000;
const scheduledBackgroundJobMaximumAttempts = 5;
const scheduledBackgroundJobBaseBackoffSeconds = 60;
const scheduledBackgroundJobMaximumBackoffSeconds = 6 * 60 * 60;
const realtimeRoomMaximumConnections = 100;
const realtimeEventMaximumBytes = 16 * 1024;
const realtimeEventRetentionLimit = 50;
const realtimeEventRetentionMs = 10 * 60_000;
const kmaPublicationSafetyMinute = 45;
const officialSourceMaxAttempts = 2;
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
const defaultPublicSiteUrl = "https://silsigan.pages.dev";
const analyticsEventNames = [
  "view_home",
  "view_place",
  "click_place",
  "click_map_marker",
  "click_hashtag",
  "follow_place",
  "follow_hashtag",
  "toggle_notifications",
  "helpful_post",
  "save_post",
  "share_post",
  "share_report",
  "submit_post",
  "submit_report",
  "like_place",
  "like_comment",
  "create_comment",
  "click_photo",
  "delete_photo",
  "upload_photo",
  "upload_place_photo",
  "report_abuse",
  "report_vote_agree",
  "report_vote_changed",
  "user_blocked",
  "account_deletion_requested",
  "submit_quick_report",
  "request_location",
  "location_denied",
  "toggle_traffic_layer",
  "search_naver_place",
  "import_naver_place",
  "answer_field_quest",
  "flag_post",
  "moderate_post",
  "moderate_worker_report",
  "filter_moderation_queue",
  "view_challenge",
  "complete_onboarding",
  "app_opened",
  "manual_location_selected",
  "location_permission_requested",
  "location_permission_granted",
  "location_permission_denied",
  "nearby_loaded",
  "nearby_load_failed",
  "map_viewed",
  "place_opened",
  "place_deep_link_opened",
  "live_status_viewed",
  "report_started",
  "report_location_verified",
  "report_location_failed",
  "report_submitted",
  "report_approved",
  "report_rejected",
  "map_load_succeeded",
  "map_load_failed",
  "app_runtime_error",
  "content_reported",
  "stream_play_started",
  "stream_play_failed",
  "ad_impression",
] as const;

const workerApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    controller.noRetry();
    const scheduledAt = new Date(controller.scheduledTime);
    const sourceIngestion: ScheduledConsumerResult<ScheduledSourceIngestionSummary> =
      env.SILSIGAN_SOURCE_INGESTION_SCHEDULED?.trim() === "1"
        ? await runScheduledConsumer(
            () => runScheduledSourceIngestion(env, scheduledAt),
            scheduledSourceErrorCode,
          )
        : { ok: true, skipped: true, reason: "disabled-by-environment" };
    const photoCleanup = await runScheduledConsumer(
      () => runScheduledPhotoCleanup(env, scheduledAt),
      scheduledBackgroundJobErrorCode,
    );
    const publicationOutbox = await runScheduledConsumer(
      () => runScheduledPublicationOutbox(env, scheduledAt),
      scheduledBackgroundJobErrorCode,
    );

    console.log(JSON.stringify({
      event: "background.schedule.completed",
      cron: controller.cron,
      scheduledAt: scheduledAt.toISOString(),
      sourceIngestion,
      photoCleanup,
      publicationOutbox,
    }));
  },
};

export default workerApi;

export async function handleRequest(request: Request, env: Env = {}, ctx: ExecutionContext = testExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    const apiCostRouteClass = classifyApiCostRoute(request, url, path);
    const apiCostControlRoute = isApiCostGuardControlRoute(path);
    const deferredApiCostMutationReservation = request.method === "POST" && path === "/api/place-requests";

    if (!isPublicLimiterExempt(path)) {
      await enforceCloudflarePublicApiRateLimit(request, env);
    }
    if (apiCostRouteClass === "HIGH_COST_READ" || apiCostRouteClass === "HIGH_COST_WRITE") {
      await enforceCloudflareHighCostApiRateLimit(request, env);
    }
    if (apiCostControlRoute) {
      await enforceCloudflareAdminApiRateLimit(request, env);
    }

    if (request.method === "OPTIONS") {
      assertAllowedBrowserOrigin(request, env);
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      assertAllowedBrowserOrigin(request, env);
    }

    const preauthenticatedAdminRole = apiCostControlRoute
      ? null
      : minimumAdminRoleForRoute(request, path);
    if (preauthenticatedAdminRole) {
      await enforceCloudflareAdminApiRateLimit(request, env);
      await requireAdmin(request, env, preauthenticatedAdminRole);
    }

    const apiCostDecision = await prepareApiCostGuardBeforeAuthentication(apiCostRouteClass, env, ctx);
    let apiCostReserved = !apiCostDecision.reserveAfterAuthentication;
    if (preauthenticatedAdminRole && !apiCostReserved) {
      await reserveApiCostGuardAfterAuthentication(apiCostRouteClass, env, ctx);
      apiCostReserved = true;
    }
    if (apiCostDecision.fallbackToSnapshot) {
      env = apiCostGuardSnapshotEnv(env);
    }

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, service: "silsigan-cloudflare-api", storage: env.DB ? "d1" : "memory" });
    }

    if (path === "/api/admin/api-cost-guard" && request.method === "GET") {
      await requireAdmin(request, env, "operator");
      return await getApiCostGuard(env);
    }

    if (path === "/api/admin/api-cost-guard" && request.method === "PATCH") {
      await requireAdmin(request, env, "admin");
      return await updateApiCostGuard(request, env, ctx);
    }

    if (path === "/api/admin/api-cost-guard/reconciliations" && request.method === "POST") {
      await requireAdmin(request, env, "admin");
      return await recordApiCostGuardReconciliation(request, env, ctx);
    }

    if (path === "/api/session/anonymous" && request.method === "POST") {
      await enforceCloudflareAnonymousSessionRateLimit(request, env);
      await enforceRateLimit("anonymous-session:issue", request, "bootstrap", 10, 60_000);
      if (!apiCostReserved) {
        await reserveApiCostGuardAfterAuthentication(apiCostRouteClass, env, ctx);
      }
      return await issueAnonymousSession(env);
    }

    if (requiresPersistentStore(env) && !env.DB && !apiCostDecision.fallbackToSnapshot) {
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

    if (path === "/api/admin/photo-cost-guard" && request.method === "GET") {
      await requireAdmin(request, env, "operator");
      return await getPhotoCostGuard(env);
    }

    if (path === "/api/admin/beta-kpis" && request.method === "GET") {
      await requireAdmin(request, env, "operator");
      return await getBetaKpis(url, env);
    }

    if (path === "/api/admin/photo-cost-guard" && request.method === "PATCH") {
      await requireAdmin(request, env, "admin");
      return await updatePhotoCostGuard(request, env, ctx);
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

    if (path === "/api/session/anonymous/rotate" && request.method === "POST") {
      const authenticationAttemptReserved = await reserveApiCostGuardAuthenticationAttempt(
        apiCostRouteClass,
        apiCostReserved,
        env,
        ctx,
      );
      const session = await getAnonymousSession(request, env, true, true);
      if (!apiCostReserved) {
        await reserveApiCostGuardAfterAuthentication(apiCostRouteClass, env, ctx, authenticationAttemptReserved);
      }
      return withHeaders(await rotateAnonymousSession(session, env), sessionHeadersFor(session, env));
    }

    if (path === "/api/session/anonymous" && request.method === "DELETE") {
      const authenticationAttemptReserved = await reserveApiCostGuardAuthenticationAttempt(
        apiCostRouteClass,
        apiCostReserved,
        env,
        ctx,
      );
      const session = await getAnonymousSession(request, env, true, true);
      if (!apiCostReserved) {
        await reserveApiCostGuardAfterAuthentication(apiCostRouteClass, env, ctx, authenticationAttemptReserved);
      }
      return withHeaders(await revokeAnonymousSession(session, env), sessionHeadersFor(session, env));
    }

    if (path === "/api/admin/place-requests" && request.method === "GET") {
      await requireAdmin(request, env, "moderator");
      return await listPlaceAdditionRequestQueue(url, env);
    }

    const placeRequestActionMatch = path.match(/^\/api\/admin\/place-requests\/([^/]+)\/action$/);
    if (placeRequestActionMatch && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return await reviewPlaceAdditionRequest(decodeURIComponent(placeRequestActionMatch[1]), request, env);
    }

    const authenticationAttemptReserved = apiCostRouteClass === "ESSENTIAL_PUBLIC"
      ? false
      : await reserveApiCostGuardAuthenticationAttempt(apiCostRouteClass, apiCostReserved, env, ctx);
    const session = apiCostRouteClass === "ESSENTIAL_PUBLIC"
      ? publicReadAnonymousSession()
      : await getAnonymousSession(request, env, requiresVerifiedAnonymousSession(request, url, path));
    if (!apiCostReserved && !deferredApiCostMutationReservation) {
      await reserveApiCostGuardAfterAuthentication(apiCostRouteClass, env, ctx, authenticationAttemptReserved);
      apiCostReserved = true;
    }
    const sessionHeaders = sessionHeadersFor(session, env);

    if (path === "/api/place-requests") {
      if (request.method === "POST") {
        await enforceRateLimit("place-request:create", request, session.id, 12, 60_000);
        await reserveApiCostGuardAfterAuthentication("WRITE_VALIDATION", env, ctx);
        return withHeaders(
          await createPlaceAdditionRequest(request, session, env, ctx, authenticationAttemptReserved),
          sessionHeaders,
        );
      }
      if (request.method === "GET") {
        return withHeaders(await listMyPlaceAdditionRequests(url, session, env), sessionHeaders);
      }
    }

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

    const sharedPostRouteMatch = path.match(/^\/api\/share\/posts\/([^/]+)$/);
    if (request.method === "GET" && sharedPostRouteMatch) {
      await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.posts, env, featureRegionCode(url));
      return withHeaders(await getSharedPost(decodeURIComponent(sharedPostRouteMatch[1]), session, env), sessionHeaders);
    }

    if (path === "/api/posts") {
      if (request.method === "GET") {
        await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.posts, env, featureRegionCode(url));
        return withHeaders(await listPosts(url, session, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("post:create", request, session.id, 12, 60_000);
        const response = await createPost(request, session, env, ctx);
        return withHeaders(response, sessionHeaders);
      }
    }

    if (request.method === "GET" && path === "/api/hashtags") {
      return withHeaders(await listHashtags(url, env), sessionHeaders);
    }

    if (path === "/api/questions") {
      if (request.method === "GET") {
        await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.questions, env, featureRegionCode(url));
        return withHeaders(await listQuestions(url, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("question:create", request, session.id, 10, 60_000);
        const response = await createQuestion(request, env);
        return withHeaders(response, sessionHeaders);
      }
    }

    if (request.method === "GET" && path === "/api/my-questions") {
      await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.myQuestions, env, featureRegionCode(url));
      return withHeaders(await listMyQuestions(session, env), sessionHeaders);
    }

    if (path === "/api/live-streams") {
      await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.liveStreams, env, featureRegionCode(url));
      throw new HttpError(404, "NOT_FOUND", "라이브 스트림 기능이 아직 연결되지 않았습니다.");
    }

    if (path === "/api/ads") {
      await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.ads, env, featureRegionCode(url));
      throw new HttpError(404, "NOT_FOUND", "광고 기능이 아직 연결되지 않았습니다.");
    }

    if (path === "/api/preferences") {
      if (request.method === "GET") {
        return withHeaders(await listPreferences(session, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("preferences:update", request, session.id, 60, 60_000);
        return withHeaders(await updatePreference(request, session, env), sessionHeaders);
      }
    }

    if (path === "/api/analytics/events" && request.method === "POST") {
      await enforceRateLimit("analytics:event", request, session.id, 120, 60_000);
      return withHeaders(await recordAnalyticsEvent(request, session, env), sessionHeaders);
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

    if (path === "/api/photos/upload-ticket" && request.method === "POST") {
      await enforceCloudflarePhotoRateLimit("ticket", request, env);
      await enforceRateLimit("photo:upload-ticket", request, session.id, 10, 60 * 60_000);
      return withHeaders(
        await createPhotoUploadTicket(request, session, env, { method: "POST", uploadUrl: "/api/photos/upload" }),
        sessionHeaders,
      );
    }

    if (path === "/api/photos/upload" && request.method === "POST") {
      await enforceCloudflarePhotoRateLimit("write", request, env);
      await enforceRateLimit("photo:upload", request, session.id, 10, 60 * 60_000);
      assertPhotoRequestContentLength(request);
      return withHeaders(await uploadPhotoMultipart(request, session, env, ctx), sessionHeaders);
    }

    if (path === "/api/photos/upload-url" && request.method === "POST") {
      await enforceCloudflarePhotoRateLimit("ticket", request, env);
      await enforceRateLimit("photo:upload-url", request, session.id, 10, 60 * 60_000);
      return withLegacyPhotoContractHeaders(
        await createPhotoUploadTicket(request, session, env, { method: "PUT", uploadUrl: "/api/photos/complete" }),
        sessionHeaders,
        "/api/photos/upload-ticket",
      );
    }

    if (path === "/api/photos/complete" && request.method === "POST") {
      await enforceCloudflarePhotoRateLimit("write", request, env);
      await enforceRateLimit("photo:complete", request, session.id, 10, 60 * 60_000);
      assertPhotoRequestContentLength(request);
      const response = await completePhoto(request, session, env, ctx);
      return withLegacyPhotoContractHeaders(response, sessionHeaders, "/api/photos/upload");
    }

    const photoFileMatch = path.match(/^\/api\/photos\/([^/]+)\/file$/);
    if (photoFileMatch && request.method === "GET") {
      await enforceCloudflarePhotoReadRateLimit(request, env);
      return withHeaders(await servePhotoFile(photoFileMatch[1], request, env, ctx), sessionHeaders);
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
      const response = await listFieldReports(url, session, env);
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

    if (path === "/api/admin/field-reports" && request.method === "GET") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await listFieldReportModerationQueue(url, env), sessionHeaders);
    }

    const fieldReportModerationMatch = path.match(/^\/api\/admin\/field-reports\/([^/]+)\/action$/);
    if (fieldReportModerationMatch && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await moderateFieldReport(fieldReportModerationMatch[1], request, env), sessionHeaders);
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
  const photoUploadProtection = publicPhotoUploadProtection(env);
  if (!env.DB) {
    return json(
      {
        contractVersion: 2,
        dataMode: "demo" as const,
        featureFlags: { ...DEFAULT_FEATURE_FLAGS },
        dimensionSettings: INITIAL_DIMENSION_SETTINGS.map((setting) => ({ ...setting })),
        photoUploadProtection,
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
      photoUploadProtection,
    },
    { storage: "d1" },
  );
}

function publicPhotoUploadProtection(env: Env): {
  turnstileRequired: boolean;
  turnstileSiteKey: string | null;
  turnstileConfigured: boolean;
} {
  const turnstileRequired = env.SILSIGAN_PHOTO_TURNSTILE_REQUIRED?.trim() === "1";
  const candidate = env.SILSIGAN_TURNSTILE_SITE_KEY?.trim() ?? "";
  const turnstileSiteKey = candidate.length >= 3 && candidate.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(candidate)
    ? candidate
    : null;
  const secret = env.SILSIGAN_TURNSTILE_SECRET_KEY?.trim() ?? "";
  const needsHostnamePolicy = env.ENVIRONMENT === "staging" || env.ENVIRONMENT === "production";
  const hostnamePolicyReady = !needsHostnamePolicy || configuredApiAllowedHostnames(env).size > 0;
  const turnstileConfigured = !turnstileRequired || Boolean(
    turnstileSiteKey
    && secret.length >= 20
    && hostnamePolicyReady,
  );
  return { turnstileRequired, turnstileSiteKey, turnstileConfigured };
}

async function resolveRuntimeFeatureFlag(key: FeatureFlagKey, env: Env, regionCode?: string): Promise<boolean> {
  if (!env.DB) {
    return DEFAULT_FEATURE_FLAGS[key];
  }

  const normalizedRegionCode = regionCode?.trim() ?? "";
  const { results = [] } = await env.DB
    .prepare(`
      SELECT
        flag_key AS flagKey,
        enabled,
        scope_type AS scopeType,
        scope_key AS scopeKey
      FROM feature_flags
      WHERE flag_key = ?
        AND (
          (scope_type = 'global' AND scope_key = '*')
          OR (scope_type = 'region' AND scope_key = ?)
        )
    `)
    .bind(key, normalizedRegionCode)
    .all<D1FeatureFlagRow>();
  const values = (results ?? []).map<FeatureFlagValue>((row) => ({
    key: row.flagKey,
    enabled: row.enabled === 1,
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
  }));

  return resolveFeatureFlag(key, values, normalizedRegionCode || undefined);
}

async function requireFeatureEnabled(key: FeatureFlagKey, env: Env, regionCode?: string): Promise<void> {
  if (!(await resolveRuntimeFeatureFlag(key, env, regionCode))) {
    throw new HttpError(404, "FEATURE_DISABLED", "현재 사용할 수 없는 기능입니다.");
  }
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

export function resolveScheduledKmaBaseTime(now: Date): { baseDate: string; baseTime: string } {
  if (!Number.isFinite(now.getTime())) {
    throw new HttpError(400, "SOURCE_SCHEDULER_TIME_INVALID", "자동 수집 기준 시각이 올바르지 않습니다.");
  }

  const koreaTime = new Date(now.getTime() + 9 * 60 * 60_000);
  const publishedHour = koreaTime.getUTCMinutes() < kmaPublicationSafetyMinute
    ? new Date(koreaTime.getTime() - 60 * 60_000)
    : koreaTime;
  return {
    baseDate: [
      publishedHour.getUTCFullYear(),
      String(publishedHour.getUTCMonth() + 1).padStart(2, "0"),
      String(publishedHour.getUTCDate()).padStart(2, "0"),
    ].join(""),
    baseTime: `${String(publishedHour.getUTCHours()).padStart(2, "0")}00`,
  };
}

export async function runScheduledSourceIngestion(
  env: Env,
  scheduledAt = new Date(),
): Promise<ScheduledSourceIngestionSummary> {
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new HttpError(400, "SOURCE_SCHEDULER_TIME_INVALID", "자동 수집 기준 시각이 올바르지 않습니다.");
  }

  const db = requireD1(env);
  const scheduledAtIso = scheduledAt.toISOString();
  let dueTargets: D1SourceIngestionTargetRow[];
  try {
    const result = await db.prepare(`
      SELECT
        target.id,
        target.source_id AS sourceId,
        source.source_key AS sourceKey,
        target.place_id AS placeId,
        target.adapter_config_json AS adapterConfigJson,
        target.refresh_interval_seconds AS refreshIntervalSeconds,
        source.refresh_interval_seconds AS sourceRefreshIntervalSeconds,
        target.consecutive_failures AS consecutiveFailures,
        target.updated_at AS updatedAt
      FROM source_ingestion_targets target
      JOIN data_sources source ON source.id = target.source_id
      WHERE target.enabled = 1
        AND target.next_run_at <= ?
        AND (target.lease_until IS NULL OR target.lease_until <= ?)
      ORDER BY target.next_run_at ASC, target.id ASC
      LIMIT ?
    `).bind(scheduledAtIso, scheduledAtIso, scheduledSourceBatchSize).all<D1SourceIngestionTargetRow>();
    dueTargets = result.results ?? [];
  } catch {
    throw new HttpError(503, "SOURCE_SCHEDULER_UNAVAILABLE", "자동 수집 작업 목록을 확인할 수 없습니다.");
  }

  const summary: ScheduledSourceIngestionSummary = {
    scheduledAt: scheduledAtIso,
    examinedCount: dueTargets.length,
    claimedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errorCodes: {},
  };

  for (const target of dueTargets) {
    const leaseToken = `source_lease_${crypto.randomUUID()}`;
    const leaseUntil = new Date(scheduledAt.getTime() + scheduledSourceLeaseMs).toISOString();
    let claimed: { id: string } | null;
    try {
      claimed = await db.prepare(`
        UPDATE source_ingestion_targets
        SET lease_token = ?, lease_until = ?, last_started_at = ?, updated_at = ?
        WHERE id = ?
          AND updated_at = ?
          AND enabled = 1
          AND next_run_at <= ?
          AND (lease_until IS NULL OR lease_until <= ?)
        RETURNING id
      `).bind(
        leaseToken,
        leaseUntil,
        scheduledAtIso,
        scheduledAtIso,
        target.id,
        target.updatedAt,
        scheduledAtIso,
        scheduledAtIso,
      ).first<{ id: string }>();
    } catch {
      throw new HttpError(503, "SOURCE_SCHEDULER_UNAVAILABLE", "자동 수집 작업 임대를 획득할 수 없습니다.");
    }

    if (!claimed) {
      summary.skippedCount += 1;
      continue;
    }

    summary.claimedCount += 1;
    const refreshIntervalSeconds = effectiveScheduledRefreshInterval(target);
    try {
      const request = scheduledSourceRequest(target, scheduledAt);
      const response = await ingestOfficialSource(target.sourceKey, request, env);
      if (!response.ok) {
        throw new HttpError(502, "SOURCE_SCHEDULED_INGESTION_REJECTED", "자동 수집 응답이 올바르지 않습니다.");
      }

      const nextRunAt = new Date(scheduledAt.getTime() + refreshIntervalSeconds * 1_000).toISOString();
      await updateScheduledTargetAfterSuccess(db, target.id, leaseToken, scheduledAtIso, nextRunAt);
      summary.succeededCount += 1;
    } catch (error) {
      const errorCode = scheduledSourceErrorCode(error);
      const backoffSeconds = scheduledSourceFailureBackoffSeconds(refreshIntervalSeconds, target.consecutiveFailures + 1);
      const nextRunAt = new Date(scheduledAt.getTime() + backoffSeconds * 1_000).toISOString();
      await updateScheduledTargetAfterFailure(db, target.id, leaseToken, scheduledAtIso, nextRunAt, errorCode);
      summary.failedCount += 1;
      summary.errorCodes[errorCode] = (summary.errorCodes[errorCode] ?? 0) + 1;
    }
  }

  return summary;
}

function scheduledSourceRequest(target: D1SourceIngestionTargetRow, scheduledAt: Date): Request {
  if (!scheduledSourceKeys.has(target.sourceKey)) {
    throw new HttpError(409, "SOURCE_SCHEDULER_ADAPTER_NOT_ALLOWED", "이 데이터 출처는 자동 수집 대상이 아닙니다.");
  }

  let config: JsonObject;
  try {
    const parsed = JSON.parse(target.adapterConfigJson) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("not an object");
    }
    config = parsed;
  } catch {
    throw new HttpError(400, "SOURCE_SCHEDULER_CONFIG_INVALID", "자동 수집 설정이 올바르지 않습니다.");
  }

  let body: JsonObject;
  if (target.sourceKey === "kma_weather") {
    body = {
      placeId: target.placeId,
      ...pickScheduledConfig(config, ["nx", "ny"]),
      ...resolveScheduledKmaBaseTime(scheduledAt),
    };
  } else if (target.sourceKey === "national_traffic") {
    body = {
      placeId: target.placeId,
      ...pickScheduledConfig(config, [
        "linkId",
        "roadType",
        "routeNo",
        "direction",
        "minLng",
        "maxLng",
        "minLat",
        "maxLat",
      ]),
    };
  } else {
    body = {
      placeId: target.placeId,
      ...pickScheduledConfig(config, ["areaName", "areaCode"]),
    };
  }

  return new Request(`https://source-scheduler.invalid/${encodeURIComponent(target.sourceKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pickScheduledConfig(config: JsonObject, fields: readonly string[]): JsonObject {
  const picked: JsonObject = {};
  for (const field of fields) {
    if (config[field] !== undefined) {
      picked[field] = config[field];
    }
  }
  return picked;
}

function effectiveScheduledRefreshInterval(target: D1SourceIngestionTargetRow): number {
  const sourceInterval = target.sourceRefreshIntervalSeconds ?? 0;
  return Math.max(300, target.refreshIntervalSeconds, sourceInterval);
}

function scheduledSourceFailureBackoffSeconds(refreshIntervalSeconds: number, consecutiveFailures: number): number {
  const exponent = Math.min(6, Math.max(0, consecutiveFailures - 1));
  return Math.min(scheduledSourceMaximumBackoffSeconds, refreshIntervalSeconds * 2 ** exponent);
}

async function updateScheduledTargetAfterSuccess(
  db: D1Database,
  targetId: string,
  leaseToken: string,
  finishedAt: string,
  nextRunAt: string,
): Promise<void> {
  let updated: { id: string } | null;
  try {
    updated = await db.prepare(`
      UPDATE source_ingestion_targets
      SET next_run_at = ?, lease_token = NULL, lease_until = NULL,
          last_succeeded_at = ?, consecutive_failures = 0,
          last_error_code = NULL, updated_at = ?
      WHERE id = ? AND lease_token = ?
      RETURNING id
    `).bind(nextRunAt, finishedAt, finishedAt, targetId, leaseToken).first<{ id: string }>();
  } catch {
    throw new HttpError(503, "SOURCE_SCHEDULER_UNAVAILABLE", "자동 수집 성공 상태를 저장할 수 없습니다.");
  }

  if (!updated) {
    throw new HttpError(409, "SOURCE_SCHEDULER_LEASE_LOST", "자동 수집 작업 임대가 만료되었습니다.");
  }
}

async function updateScheduledTargetAfterFailure(
  db: D1Database,
  targetId: string,
  leaseToken: string,
  finishedAt: string,
  nextRunAt: string,
  errorCode: string,
): Promise<void> {
  let updated: { id: string } | null;
  try {
    updated = await db.prepare(`
      UPDATE source_ingestion_targets
      SET next_run_at = ?, lease_token = NULL, lease_until = NULL,
          last_failed_at = ?, consecutive_failures = consecutive_failures + 1,
          last_error_code = ?, updated_at = ?
      WHERE id = ? AND lease_token = ?
      RETURNING id
    `).bind(nextRunAt, finishedAt, errorCode, finishedAt, targetId, leaseToken).first<{ id: string }>();
  } catch {
    throw new HttpError(503, "SOURCE_SCHEDULER_UNAVAILABLE", "자동 수집 실패 상태를 저장할 수 없습니다.");
  }

  if (!updated) {
    throw new HttpError(409, "SOURCE_SCHEDULER_LEASE_LOST", "자동 수집 작업 임대가 만료되었습니다.");
  }
}

function scheduledSourceErrorCode(error: unknown): string {
  const candidate = error instanceof HttpError || error instanceof PublicDataGatewayError
    ? error.code
    : "SOURCE_SCHEDULED_INGESTION_FAILED";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : "SOURCE_SCHEDULED_INGESTION_FAILED";
}

async function runScheduledConsumer<TSummary>(
  consumer: () => Promise<TSummary>,
  classifyError: (error: unknown) => string,
): Promise<ScheduledConsumerResult<TSummary>> {
  try {
    return { ok: true, summary: await consumer() };
  } catch (error) {
    return { ok: false, errorCode: classifyError(error) };
  }
}

export async function runScheduledPhotoCleanup(
  env: Env,
  scheduledAt = new Date(),
): Promise<ScheduledBackgroundJobSummary> {
  assertScheduledBackgroundTime(scheduledAt);
  const db = requireD1(env);
  const scheduledAtIso = scheduledAt.toISOString();
  await prunePhotoSecurityLedgers(db, scheduledAt);
  const dueJobs = await db.prepare(`
    SELECT
      id,
      storage_key AS storageKey,
      byte_size AS byteSize,
      attempts,
      updated_at AS updatedAt
    FROM photo_cleanup_jobs
    WHERE next_attempt_at <= ?
      AND (
        status = 'pending'
        OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
      )
    ORDER BY next_attempt_at ASC, created_at ASC, id ASC
    LIMIT ?
  `).bind(scheduledAtIso, scheduledAtIso, scheduledBackgroundJobBatchSize).all<D1PhotoCleanupJobRow>();
  const summary = createScheduledBackgroundJobSummary(scheduledAtIso, dueJobs.results?.length ?? 0);

  for (const job of dueJobs.results ?? []) {
    const leaseToken = `cleanup_lease_${crypto.randomUUID()}`;
    const leaseExpiresAt = new Date(scheduledAt.getTime() + scheduledBackgroundJobLeaseMs).toISOString();
    const claimed = await db.prepare(`
      UPDATE photo_cleanup_jobs
      SET status = 'processing', lease_token = ?, lease_expires_at = ?,
          attempts = attempts + 1, updated_at = ?
      WHERE id = ?
        AND updated_at = ?
        AND next_attempt_at <= ?
        AND (
          status = 'pending'
          OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
        )
      RETURNING id
    `).bind(
      leaseToken,
      leaseExpiresAt,
      scheduledAtIso,
      job.id,
      job.updatedAt,
      scheduledAtIso,
      scheduledAtIso,
    ).first<{ id: string }>();

    if (!claimed) {
      summary.skippedCount += 1;
      continue;
    }

    summary.claimedCount += 1;
    const attemptNumber = job.attempts + 1;
    try {
      if (!env.PHOTOS) {
        throw new HttpError(503, "PHOTO_STORAGE_NOT_CONFIGURED", "사진 저장소가 연결되지 않았습니다.");
      }
      await env.PHOTOS.delete(job.storageKey);
      await completePhotoCleanupJob(db, job, leaseToken, scheduledAtIso);
      summary.succeededCount += 1;
    } catch (error) {
      const errorCode = scheduledBackgroundJobErrorCode(error);
      const deadLettered = attemptNumber >= scheduledBackgroundJobMaximumAttempts;
      await failScheduledBackgroundJob(
        db,
        "photo_cleanup_jobs",
        job.id,
        leaseToken,
        scheduledAt,
        attemptNumber,
        errorCode,
        deadLettered,
      );
      if (deadLettered) {
        summary.deadLetteredCount += 1;
      } else {
        summary.retriedCount += 1;
      }
      incrementScheduledError(summary.errorCodes, errorCode);
    }
  }

  return summary;
}

async function prunePhotoSecurityLedgers(db: D1Database, scheduledAt: Date): Promise<void> {
  const cutoff = new Date(scheduledAt.getTime() - photoSecurityLedgerRetentionMs);
  const cutoffIso = cutoff.toISOString();
  const cutoffDayUtc = utcDayKey(cutoff);
  try {
    await runD1Batch(db, [
      db.prepare("DELETE FROM photo_upload_claims WHERE consumed_at < ?").bind(cutoffIso),
      db.prepare("DELETE FROM photo_abuse_budget WHERE day_utc < ?").bind(cutoffDayUtc),
      db.prepare("DELETE FROM photo_read_abuse_budget WHERE day_utc < ?").bind(cutoffDayUtc),
      db
        .prepare(
          `DELETE FROM anonymous_sessions
           WHERE (status = 'active' AND expires_at <= ?)
              OR (status = 'revoked' AND COALESCE(revoked_at, last_seen_at, created_at) < ?)`,
        )
        .bind(scheduledAt.toISOString(), cutoffIso),
      db.prepare("DELETE FROM anonymous_session_issuance_budget WHERE day_utc < ?").bind(cutoffDayUtc),
    ]);
  } catch {
    throw new HttpError(503, "SECURITY_LEDGER_CLEANUP_FAILED", "보안 원장을 정리할 수 없습니다.");
  }
}

export async function runScheduledPublicationOutbox(
  env: Env,
  scheduledAt = new Date(),
): Promise<ScheduledBackgroundJobSummary> {
  assertScheduledBackgroundTime(scheduledAt);
  const db = requireD1(env);
  const scheduledAtIso = scheduledAt.toISOString();
  const dueEvents = await db.prepare(`
    SELECT
      id,
      aggregate_id AS aggregateId,
      event_type AS eventType,
      payload_json AS payloadJson,
      attempts,
      updated_at AS updatedAt
    FROM publication_outbox
    WHERE available_at <= ?
      AND (
        status = 'pending'
        OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
      )
    ORDER BY available_at ASC, created_at ASC, id ASC
    LIMIT ?
  `).bind(scheduledAtIso, scheduledAtIso, scheduledBackgroundJobBatchSize).all<D1PublicationOutboxRow>();
  const summary = createScheduledBackgroundJobSummary(scheduledAtIso, dueEvents.results?.length ?? 0);

  for (const event of dueEvents.results ?? []) {
    const leaseToken = `outbox_lease_${crypto.randomUUID()}`;
    const leaseExpiresAt = new Date(scheduledAt.getTime() + scheduledBackgroundJobLeaseMs).toISOString();
    const claimed = await db.prepare(`
      UPDATE publication_outbox
      SET status = 'processing', lease_token = ?, lease_expires_at = ?,
          attempts = attempts + 1, updated_at = ?
      WHERE id = ?
        AND updated_at = ?
        AND available_at <= ?
        AND (
          status = 'pending'
          OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
        )
      RETURNING id
    `).bind(
      leaseToken,
      leaseExpiresAt,
      scheduledAtIso,
      event.id,
      event.updatedAt,
      scheduledAtIso,
      scheduledAtIso,
    ).first<{ id: string }>();

    if (!claimed) {
      summary.skippedCount += 1;
      continue;
    }

    summary.claimedCount += 1;
    const attemptNumber = event.attempts + 1;
    try {
      await deliverPublicationOutboxEvent(db, event, env);
      const published = await db.prepare(`
        UPDATE publication_outbox
        SET status = 'published', published_at = ?, lease_token = NULL,
            lease_expires_at = NULL, last_error_code = NULL, updated_at = ?
        WHERE id = ? AND lease_token = ?
        RETURNING id
      `).bind(scheduledAtIso, scheduledAtIso, event.id, leaseToken).first<{ id: string }>();
      if (!published) {
        throw new HttpError(409, "BACKGROUND_JOB_LEASE_LOST", "백그라운드 작업 임대가 만료되었습니다.");
      }
      summary.succeededCount += 1;
    } catch (error) {
      const errorCode = scheduledBackgroundJobErrorCode(error);
      const deadLettered = attemptNumber >= scheduledBackgroundJobMaximumAttempts;
      await failScheduledBackgroundJob(
        db,
        "publication_outbox",
        event.id,
        leaseToken,
        scheduledAt,
        attemptNumber,
        errorCode,
        deadLettered,
      );
      if (deadLettered) {
        summary.deadLetteredCount += 1;
      } else {
        summary.retriedCount += 1;
      }
      incrementScheduledError(summary.errorCodes, errorCode);
    }
  }

  return summary;
}

function assertScheduledBackgroundTime(scheduledAt: Date): void {
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new HttpError(400, "BACKGROUND_JOB_TIME_INVALID", "백그라운드 작업 기준 시각이 올바르지 않습니다.");
  }
}

function createScheduledBackgroundJobSummary(scheduledAt: string, examinedCount: number): ScheduledBackgroundJobSummary {
  return {
    scheduledAt,
    examinedCount,
    claimedCount: 0,
    succeededCount: 0,
    retriedCount: 0,
    deadLetteredCount: 0,
    skippedCount: 0,
    errorCodes: {},
  };
}

async function completePhotoCleanupJob(
  db: D1Database,
  job: D1PhotoCleanupJobRow,
  leaseToken: string,
  completedAt: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (job.byteSize > 0) {
    const budget = await db.prepare("SELECT id FROM photo_storage_budget WHERE id = 1").first<{ id: number }>();
    if (!budget) {
      throw new HttpError(503, "PHOTO_STORAGE_BUDGET_LEDGER_MISSING", "사진 저장량 원장을 확인할 수 없습니다.");
    }
    const releaseToken = `cleanup_release_${crypto.randomUUID()}`;
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO photo_storage_releases (storage_key, byte_size, release_token, released_at)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM photo_cleanup_jobs
        WHERE id = ? AND lease_token = ? AND budget_released_at IS NULL
      )
    `).bind(job.storageKey, job.byteSize, releaseToken, completedAt, job.id, leaseToken));
    statements.push(db.prepare(`
      UPDATE photo_storage_budget
      SET active_bytes = MAX(0, active_bytes - ?), updated_at = ?
      WHERE id = 1
        AND EXISTS (
          SELECT 1 FROM photo_storage_releases
          WHERE storage_key = ? AND release_token = ?
        )
    `).bind(job.byteSize, completedAt, job.storageKey, releaseToken));
  }
  statements.push(db.prepare(`
    UPDATE photo_cleanup_jobs
    SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
        last_error_code = NULL,
        budget_released_at = CASE WHEN byte_size > 0 THEN ? ELSE budget_released_at END,
        completed_at = ?, updated_at = ?
    WHERE id = ? AND lease_token = ?
  `).bind(completedAt, completedAt, completedAt, job.id, leaseToken));
  await runAtomicD1Batch(
    db,
    statements,
    "PHOTO_CLEANUP_ATOMICITY_REQUIRED",
    "사진 정리 완료와 저장량 차감을 원자적으로 기록할 수 없습니다.",
  );

  const completed = await db.prepare(`
    SELECT id FROM photo_cleanup_jobs
    WHERE id = ? AND status = 'completed' AND completed_at = ?
  `).bind(job.id, completedAt).first<{ id: string }>();
  if (!completed) {
    throw new HttpError(409, "BACKGROUND_JOB_LEASE_LOST", "백그라운드 작업 임대가 만료되었습니다.");
  }
}

async function deliverPublicationOutboxEvent(
  db: D1Database,
  event: D1PublicationOutboxRow,
  env: Env,
): Promise<void> {
  if (event.eventType !== "field_report.created") {
    throw new HttpError(409, "PUBLICATION_OUTBOX_EVENT_UNSUPPORTED", "지원하지 않는 발행 이벤트입니다.");
  }
  if (!env.PLACE_ROOM || !env.REGION_ROOM || !env.GLOBAL_ROOM) {
    throw new HttpError(503, "REALTIME_BINDING_REQUIRED", "실시간 전달 바인딩이 필요합니다.");
  }

  let payload: JsonObject;
  try {
    const parsed = JSON.parse(event.payloadJson) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("invalid payload");
    }
    payload = parsed;
  } catch {
    throw new HttpError(400, "PUBLICATION_OUTBOX_PAYLOAD_INVALID", "발행 이벤트 형식이 올바르지 않습니다.");
  }

  const reportId = payload.reportId;
  const requestedPlaceId = payload.placeId;
  if (reportId !== event.aggregateId || typeof requestedPlaceId !== "string") {
    throw new HttpError(400, "PUBLICATION_OUTBOX_PAYLOAD_INVALID", "발행 이벤트 식별자가 올바르지 않습니다.");
  }
  const publication = await db.prepare(`
    SELECT
      publication.report_id AS reportId,
      publication.place_id AS placeId,
      publication.moderation_status AS moderationStatus,
      place.region_id AS regionId,
      place.area_id AS areaId
    FROM field_report_publications publication
    JOIN places place ON place.id = publication.place_id
    WHERE publication.report_id = ?
    LIMIT 1
  `).bind(event.aggregateId).first<{
    reportId: string;
    placeId: string;
    moderationStatus: FieldReportModerationStatus;
    regionId: string;
    areaId: string;
  }>();
  if (!publication || publication.placeId !== requestedPlaceId) {
    throw new HttpError(404, "PUBLICATION_OUTBOX_AGGREGATE_NOT_FOUND", "발행 대상을 찾을 수 없습니다.");
  }
  if (publication.moderationStatus !== "approved") {
    return;
  }

  const safePayload: JsonObject = {
    reportId: publication.reportId,
    placeId: publication.placeId,
    regionId: publication.regionId,
    areaId: publication.areaId,
  };
  await Promise.all([
    broadcastToRooms(env, "report.created", "place", publication.placeId, safePayload),
    broadcastToRooms(env, "report.created", "region", publication.regionId, safePayload),
    broadcastToRooms(env, "report.created", "global", "global", safePayload),
  ]);
}

async function failScheduledBackgroundJob(
  db: D1Database,
  table: "photo_cleanup_jobs" | "publication_outbox",
  jobId: string,
  leaseToken: string,
  scheduledAt: Date,
  attemptNumber: number,
  errorCode: string,
  deadLettered: boolean,
): Promise<void> {
  const scheduledAtIso = scheduledAt.toISOString();
  const nextAttemptAt = new Date(
    scheduledAt.getTime() + scheduledBackgroundJobBackoffSeconds(attemptNumber) * 1_000,
  ).toISOString();
  const timeColumn = table === "photo_cleanup_jobs" ? "next_attempt_at" : "available_at";
  const updated = await db.prepare(`
    UPDATE ${table}
    SET status = ?, ${timeColumn} = ?, last_error_code = ?,
        lease_token = NULL, lease_expires_at = NULL,
        dead_lettered_at = ?, updated_at = ?
    WHERE id = ? AND lease_token = ?
    RETURNING id
  `).bind(
    deadLettered ? "failed" : "pending",
    nextAttemptAt,
    errorCode,
    deadLettered ? scheduledAtIso : null,
    scheduledAtIso,
    jobId,
    leaseToken,
  ).first<{ id: string }>();
  if (!updated) {
    throw new HttpError(409, "BACKGROUND_JOB_LEASE_LOST", "백그라운드 작업 임대가 만료되었습니다.");
  }
}

function scheduledBackgroundJobBackoffSeconds(attemptNumber: number): number {
  const exponent = Math.min(8, Math.max(0, attemptNumber - 1));
  return Math.min(
    scheduledBackgroundJobMaximumBackoffSeconds,
    scheduledBackgroundJobBaseBackoffSeconds * 2 ** exponent,
  );
}

function scheduledBackgroundJobErrorCode(error: unknown): string {
  const candidate = error instanceof HttpError ? error.code : "BACKGROUND_JOB_FAILED";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : "BACKGROUND_JOB_FAILED";
}

function incrementScheduledError(errorCodes: Record<string, number>, errorCode: string): void {
  errorCodes[errorCode] = (errorCodes[errorCode] ?? 0) + 1;
}

async function ingestOfficialSource(sourceKey: string, request: Request, env: Env): Promise<Response> {
  if (!new Set(["kma_weather", "tour_api", "national_parking", "national_traffic", "national_cctv", "seoul_realtime_city"]).has(sourceKey)) {
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
  if (sourceKey === "seoul_realtime_city") {
    return ingestSeoulRealtimeSource(source, request, env, db);
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
    await enforceOfficialSourceDailyRequestBudget(db, source.sourceKey, env, startedAt);
    const result = await gateway.execute(adapter, query, {
      freshTtlSeconds: Math.min(sourceTtlSeconds, 300),
      staleTtlSeconds: sourceTtlSeconds,
      timeoutMs: 5_000,
      maxAttempts: officialSourceMaxAttempts,
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
    await failOfficialIngestion(db, source, runId, error, requestStartedAt);
    throwOfficialIngestionError(error);
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
  const policy = {
    freshTtlSeconds: 300,
    staleTtlSeconds: 86_400,
    timeoutMs: 5_000,
    maxAttempts: officialSourceMaxAttempts,
  };
  const runId = `ingestion_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, source.id, place.regionId, startedAt).run();
  const requestStartedAt = Date.now();

  try {
    await enforceOfficialSourceDailyRequestBudget(db, source.sourceKey, env, startedAt);
    let result: {
      items: StaticSourceMetadata[];
      fetchedAt: string;
      cacheStatus: "network" | "fresh" | "stale";
      healthStatus: "healthy" | "degraded" | "down";
    };

    if (source.sourceKey === "tour_api") {
      const serviceKey = requiredSourceCredential(env.TOUR_API_SERVICE_KEY);
      const searchMode = optionalEnumField(body, "searchMode", ["area", "location"] as const) ?? "area";
      const contentTypeId = optionalStringField(body, "contentTypeId", 3);
      const pageNo = integerField(body, "pageNo", 1, 10_000, 1);
      const numOfRows = integerField(body, "numOfRows", 1, 100, 20);
      const adapter = createTourApiAdapter({ serviceKey });
      const fetched = searchMode === "location"
        ? await gateway.execute(adapter, {
            searchMode: "location",
            latitude: place.latitude,
            longitude: place.longitude,
            radiusM: integerField(body, "radiusM", 10, 20_000, 5_000),
            ...(contentTypeId ? { contentTypeId } : {}),
            pageNo,
            numOfRows,
          }, policy)
        : await gateway.execute(adapter, {
            searchMode: "area",
            areaCode: stringField(body, "areaCode", 3),
            ...(contentTypeId ? { contentTypeId } : {}),
            pageNo,
            numOfRows,
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
    await enforceOfficialSourceDailyRequestBudget(db, source.sourceKey, env, startedAt);
    const result = await new PublicDataGateway({ cache: env.CACHE }).execute(
      createNationalTrafficAdapter({ serviceKey, ttlSeconds: source.defaultTtlSeconds }),
      query,
      {
        freshTtlSeconds: Math.min(source.defaultTtlSeconds, 300),
        staleTtlSeconds: source.defaultTtlSeconds,
        timeoutMs: 5_000,
        maxAttempts: officialSourceMaxAttempts,
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

async function ingestSeoulRealtimeSource(
  source: D1OperationalSourceRow,
  request: Request,
  env: Env,
  db: D1Database,
): Promise<Response> {
  await requireFeatureEnabled("SEOUL_REALTIME_ENABLED", env, "seoul");
  const serviceKey = requiredSourceCredential(env.SEOUL_REALTIME_SERVICE_KEY);
  if (!source.defaultTtlSeconds) throw new HttpError(503, "SOURCE_TTL_REQUIRED", "데이터 출처 만료 설정이 필요합니다.");

  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const place = await resolvePlaceRecord(placeId, env);
  if (place.regionId !== "seoul") {
    throw new HttpError(409, "SOURCE_REGION_NOT_ENABLED", "서울 실시간 데이터는 서울 장소에만 연결할 수 있습니다.");
  }
  const areaName = stringField(body, "areaName", 100);
  const areaCode = optionalStringField(body, "areaCode", 40);
  const query = {
    placeId: place.id,
    areaName,
    ...(areaCode ? { areaCode } : {}),
  };
  const runId = `ingestion_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO api_ingestion_runs (id, source_id, region_code, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).bind(runId, source.id, place.regionId, startedAt).run();
  const requestStartedAt = Date.now();

  try {
    await enforceOfficialSourceDailyRequestBudget(db, source.sourceKey, env, startedAt);
    const result = await new PublicDataGateway({ cache: env.CACHE }).execute(
      createSeoulRealtimeAdapter({
        serviceKey,
        ttlSeconds: source.defaultTtlSeconds,
      }),
      query,
      {
        freshTtlSeconds: Math.min(source.defaultTtlSeconds, 300),
        staleTtlSeconds: source.defaultTtlSeconds,
        timeoutMs: 5_000,
        maxAttempts: officialSourceMaxAttempts,
      },
    );
    if (!result.payloadHash) {
      throw new PublicDataGatewayError("SOURCE_INVALID_RESPONSE", "출처 응답 증거값을 생성하지 못했습니다.", false);
    }

    for (const signal of result.items) {
      const idempotencyKey = `${signal.externalObservationId}:${result.payloadHash}`;
      const stableId = await sha256Hex(`${source.id}:${place.id}:${idempotencyKey}`);
      const signalId = `official_signal_${stableId.slice(0, 48)}`;
      const metadata = {
        areaName: signal.areaName,
        areaCode: signal.areaCode,
        ...(signal.congestionMessage ? { congestionMessage: signal.congestionMessage } : {}),
        populationValueIsEstimated: true,
      };
      await db.prepare(`
        INSERT OR IGNORE INTO live_signals (
          id, place_id, dimension, value_code, value_number, value_text, unit,
          source_id, source_type, source_name, attribution_text,
          observed_at, fetched_at, expires_at, confidence_score, is_estimated,
          is_publicly_visible, evidence_type, evidence_id, idempotency_key, metadata_json
        ) VALUES (?, ?, 'crowd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'api', ?, ?, ?)
      `).bind(
        signalId,
        place.id,
        signal.valueCode,
        signal.valueNumber ?? null,
        signal.valueText,
        signal.unit ?? null,
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
    }

    const finishedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE api_ingestion_runs
      SET status = ?, fetched_count = 1, normalized_count = ?, rejected_count = 0, finished_at = ?
      WHERE id = ?
    `).bind(
      result.cacheStatus === "stale" ? "partial" : "succeeded",
      result.items.length,
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
      areaName,
      areaCode: result.items[0]?.areaCode ?? areaCode ?? null,
      normalizedCount: result.items.length,
      cacheStatus: result.cacheStatus,
      observedAt: result.items[0]?.observedAt ?? null,
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

type OfficialSourceBudgetSpec = {
  sourceIds: string[];
  limit: number;
};

function officialSourceBudgetSpec(sourceKey: string, env: Env): OfficialSourceBudgetSpec {
  switch (sourceKey) {
    case "kma_weather":
      return {
        sourceIds: ["source-kma-weather"],
        limit: boundedOfficialSourceDailyLimit(env.SILSIGAN_KMA_DAILY_PROVIDER_REQUEST_LIMIT, 5_000, 5_000),
      };
    case "tour_api":
      return {
        sourceIds: ["source-tour-api"],
        limit: boundedOfficialSourceDailyLimit(env.SILSIGAN_TOUR_API_DAILY_PROVIDER_REQUEST_LIMIT, 500, 500),
      };
    case "national_parking":
      return {
        sourceIds: ["source-national-parking"],
        limit: boundedOfficialSourceDailyLimit(env.SILSIGAN_NATIONAL_PARKING_DAILY_PROVIDER_REQUEST_LIMIT, 100, 500),
      };
    case "national_traffic":
    case "national_cctv":
      return {
        sourceIds: ["source-national-traffic", "source-national-cctv"],
        limit: boundedOfficialSourceDailyLimit(env.SILSIGAN_ITS_DAILY_PROVIDER_REQUEST_LIMIT, 500, 500),
      };
    case "seoul_realtime_city":
      return {
        sourceIds: ["source-seoul-realtime"],
        limit: boundedOfficialSourceDailyLimit(env.SILSIGAN_SEOUL_REALTIME_DAILY_PROVIDER_REQUEST_LIMIT, 500, 500),
      };
    default:
      throw new HttpError(503, "SOURCE_DAILY_REQUEST_BUDGET_UNAVAILABLE", "데이터 출처 일일 사용 한도를 확인할 수 없습니다.");
  }
}

function boundedOfficialSourceDailyLimit(raw: string | undefined, fallback: number, ceiling: number): number {
  if (raw === undefined || raw.trim() === "") return Math.min(fallback, ceiling);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, ceiling);
}

export function resolveOfficialSourceQuotaWindow(startedAt: string): { dayStart: string; dayEnd: string } {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new HttpError(
      503,
      "SOURCE_DAILY_REQUEST_BUDGET_UNAVAILABLE",
      "데이터 출처 일일 사용 한도를 확인할 수 없습니다.",
    );
  }
  const koreaOffsetMs = 9 * 60 * 60 * 1_000;
  const koreaDate = new Date(startedAtMs + koreaOffsetMs).toISOString().slice(0, 10);
  const dayStartMs = Date.parse(`${koreaDate}T00:00:00.000Z`) - koreaOffsetMs;
  return {
    dayStart: new Date(dayStartMs).toISOString(),
    dayEnd: new Date(dayStartMs + 24 * 60 * 60 * 1_000).toISOString(),
  };
}

async function enforceOfficialSourceDailyRequestBudget(
  db: D1Database,
  sourceKey: string,
  env: Env,
  startedAt: string,
): Promise<void> {
  const spec = officialSourceBudgetSpec(sourceKey, env);
  const { dayStart, dayEnd } = resolveOfficialSourceQuotaWindow(startedAt);
  const placeholders = spec.sourceIds.map(() => "?").join(", ");
  const reserved = await db.prepare(`
    SELECT COUNT(*) AS runCount
    FROM api_ingestion_runs
    WHERE source_id IN (${placeholders})
      AND started_at >= ?
      AND started_at < ?
      AND (
        status <> 'quota_exceeded'
        OR error_code IS NULL
        OR error_code <> 'SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED'
      )
  `).bind(...spec.sourceIds, dayStart, dayEnd).first<{ runCount: number }>();
  const reservedAttempts = Number(reserved?.runCount ?? 0) * officialSourceMaxAttempts;
  if (spec.limit === 0 || reservedAttempts > spec.limit) {
    throw new HttpError(
      429,
      "SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED",
      "공공데이터 일일 안전 한도에 도달해 다음 갱신을 중단했습니다.",
    );
  }
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
  const status = errorCode === "SOURCE_QUOTA_EXCEEDED" || errorCode === "SOURCE_DAILY_REQUEST_BUDGET_EXHAUSTED"
    ? "quota_exceeded"
    : "failed";
  await db.prepare(`
    UPDATE api_ingestion_runs
    SET status = ?, error_code = ?, finished_at = ?
    WHERE id = ?
  `).bind(status, errorCode, finishedAt, runId).run();
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
  private readonly room: RealtimeRoom;

  constructor(state?: DurableObjectState) {
    this.room = new RealtimeRoom(state);
  }

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "place");
  }

  async alarm(): Promise<void> {
    await this.room.expireRecentEvents();
  }

  webSocketMessage(socket: WorkerWebSocket): void {
    this.room.rejectClientMessage(socket);
  }

  webSocketClose(socket: WorkerWebSocket, code: number, reason: string): void {
    this.room.completeClose(socket, code, reason);
  }

  webSocketError(socket: WorkerWebSocket): void {
    this.room.closeErroredSocket(socket);
  }
}

export class RegionRoom {
  private readonly room: RealtimeRoom;

  constructor(state?: DurableObjectState) {
    this.room = new RealtimeRoom(state);
  }

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "region");
  }

  async alarm(): Promise<void> {
    await this.room.expireRecentEvents();
  }

  webSocketMessage(socket: WorkerWebSocket): void {
    this.room.rejectClientMessage(socket);
  }

  webSocketClose(socket: WorkerWebSocket, code: number, reason: string): void {
    this.room.completeClose(socket, code, reason);
  }

  webSocketError(socket: WorkerWebSocket): void {
    this.room.closeErroredSocket(socket);
  }
}

export class GlobalRoom {
  private readonly room: RealtimeRoom;

  constructor(state?: DurableObjectState) {
    this.room = new RealtimeRoom(state);
  }

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "global");
  }

  async alarm(): Promise<void> {
    await this.room.expireRecentEvents();
  }

  webSocketMessage(socket: WorkerWebSocket): void {
    this.room.rejectClientMessage(socket);
  }

  webSocketClose(socket: WorkerWebSocket, code: number, reason: string): void {
    this.room.completeClose(socket, code, reason);
  }

  webSocketError(socket: WorkerWebSocket): void {
    this.room.closeErroredSocket(socket);
  }
}

class RealtimeRoom {
  private readonly standardSockets = new Set<WorkerWebSocket>();
  private readonly eventsByRoom = new Map<string, RoomBroadcast[]>();
  private readonly state?: DurableObjectState;

  constructor(state?: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request, scope: RoomBroadcast["scope"]): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId") ?? "global";

    if (request.method === "POST" && url.pathname === "/api/realtime/broadcast") {
      const event = roomBroadcastFromUnknown(await readJson(request), scope, roomId);
      const key = roomKey(scope, roomId);
      const serializedEvent = serializeRoomBroadcast(event);
      const events = [event, ...(await this.readRecentEvents(scope, roomId))].slice(0, realtimeEventRetentionLimit);
      await this.writeRecentEvents(key, events);
      this.broadcast(serializedEvent);

      return json({
        mode: "durable-object",
        scope,
        roomId,
        delivered: this.activeSockets().length,
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      if (this.attachedSockets().length >= realtimeRoomMaximumConnections) {
        return errorResponse(429, "REALTIME_ROOM_CAPACITY_REACHED", "실시간 채널 연결이 많아 잠시 후 다시 시도해 주세요.");
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      if (this.state) {
        this.state.acceptWebSocket(server);
      } else {
        server.accept();
        this.standardSockets.add(server);
        server.addEventListener("message", () => this.rejectClientMessage(server));
        server.addEventListener("close", () => this.standardSockets.delete(server));
        server.addEventListener("error", () => this.standardSockets.delete(server));
      }

      const responseInit: WorkerResponseInit = {
        status: 101,
        webSocket: client,
      };

      return createWebSocketResponse(client, responseInit);
    }

    return json({ mode: "durable-object-polling", scope, roomId, events: await this.readRecentEvents(scope, roomId) });
  }

  rejectClientMessage(socket: WorkerWebSocket): void {
    socket.close(1008, "read-only-channel");
  }

  completeClose(socket: WorkerWebSocket, code: number, reason: string): void {
    socket.close(code, reason);
    this.standardSockets.delete(socket);
  }

  closeErroredSocket(socket: WorkerWebSocket): void {
    socket.close(1011, "realtime-channel-error");
    this.standardSockets.delete(socket);
  }

  async expireRecentEvents(): Promise<void> {
    this.eventsByRoom.clear();
    if (this.state) {
      await this.state.storage.delete(realtimeStorageKey());
    }
  }

  private broadcast(message: string) {
    for (const socket of this.activeSockets()) {
      socket.send(message);
    }
  }

  private attachedSockets(): WorkerWebSocket[] {
    return this.state ? this.state.getWebSockets() : [...this.standardSockets];
  }

  private activeSockets(): WorkerWebSocket[] {
    return this.attachedSockets().filter((socket) => socket.readyState === 1);
  }

  private async readRecentEvents(scope: RoomBroadcast["scope"], roomId: string): Promise<RoomBroadcast[]> {
    const key = roomKey(scope, roomId);
    const cached = this.eventsByRoom.get(key);
    if (cached) {
      return cached;
    }

    const stored = this.state ? await this.state.storage.get<unknown>(realtimeStorageKey()) : undefined;
    const events = storedRoomBroadcasts(stored, scope, roomId);
    this.eventsByRoom.set(key, events);
    return events;
  }

  private async writeRecentEvents(key: string, events: RoomBroadcast[]): Promise<void> {
    this.eventsByRoom.set(key, events);
    if (this.state) {
      await this.state.storage.put(realtimeStorageKey(), events);
      await this.state.storage.setAlarm(Date.now() + realtimeEventRetentionMs);
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

    const response = new Response(null, { headers: responseInit.headers });
    Object.defineProperty(response, "status", { value: 101 });
    Object.defineProperty(response, "statusText", { value: responseInit.statusText ?? "" });
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

  if (
    !allowedTypes.has(type as RoomBroadcast["type"]) ||
    eventScope !== scope ||
    eventRoomId !== roomId ||
    !isRecord(payload) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
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

function serializeRoomBroadcast(event: RoomBroadcast): string {
  const serialized = JSON.stringify(event);
  if (new TextEncoder().encode(serialized).byteLength > realtimeEventMaximumBytes) {
    throw new HttpError(413, "REALTIME_EVENT_SIZE_LIMIT", "실시간 이벤트 크기가 허용 범위를 초과했습니다.");
  }
  return serialized;
}

function storedRoomBroadcasts(
  value: unknown,
  scope: RoomBroadcast["scope"],
  roomId: string,
): RoomBroadcast[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const events: RoomBroadcast[] = [];
  for (const candidate of value.slice(0, realtimeEventRetentionLimit)) {
    try {
      const event = roomBroadcastFromUnknown(candidate, scope, roomId);
      serializeRoomBroadcast(event);
      if (Date.parse(event.createdAt) < Date.now() - realtimeEventRetentionMs) {
        continue;
      }
      events.push(event);
    } catch {
      // Ignore stale or corrupt internal entries instead of breaking polling.
    }
  }
  return events;
}

function realtimeStorageKey(): string {
  return "recent-events:v1";
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
    const [status, officialTourismPlace] = await Promise.all([
      recomputeD1PlaceStatus(env.DB, placeId, now),
      loadD1OfficialTourismPlace(env.DB, placeId),
    ]);
    return { ...status, officialTourismPlace };
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
    officialTourismPlace: null,
    observedAt: latestObservedAt(currentSignals),
    computedAt: now.toISOString(),
  };
}

async function loadD1OfficialTourismPlace(
  db: D1Database,
  placeId: string,
): Promise<OfficialTourismPlace | null> {
  const row = await db.prepare(`
    SELECT
      psm.external_place_id AS contentId,
      COALESCE(psm.external_name, p.name) AS name,
      psm.external_address AS address,
      psm.last_seen_at AS verifiedAt
    FROM place_source_mappings psm
    JOIN data_sources ds ON ds.id = psm.source_id
    JOIN places p ON p.id = psm.place_id
    WHERE psm.place_id = ?
      AND psm.manually_verified = 1
      AND ds.source_key = 'tour_api'
      AND ds.enabled = 1
      AND ds.commercial_use_status IN ('allowed', 'allowed_with_attribution')
    ORDER BY psm.last_seen_at DESC
    LIMIT 1
  `).bind(placeId).first<{
    contentId: string;
    name: string;
    address: string | null;
    verifiedAt: string;
  }>();

  if (!row) {
    return null;
  }

  return {
    contentId: row.contentId,
    name: row.name,
    address: row.address,
    sourceName: "한국관광공사 TourAPI",
    attributionText: "한국관광공사",
    verifiedAt: row.verifiedAt,
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
        AND ls.expires_at > ?
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
    expiresAt: row.expiresAt,
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
    expiresAt: signal.expiresAt,
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

async function createPlaceAdditionRequest(
  request: Request,
  session: AnonymousSession,
  env: Env,
  ctx: ExecutionContext,
  authenticationAttemptReserved: boolean,
): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  assertExactFields(body, ["clientRequestId", "name", "address", "category"]);
  const clientRequestId = optionalClientRequestIdField(body, "clientRequestId");
  if (!clientRequestId) {
    throw new HttpError(400, "VALIDATION_ERROR", "clientRequestId 값이 올바르지 않습니다.");
  }
  const name = normalizedPlaceRequestField(body, "name", 120);
  const address = normalizedPlaceRequestField(body, "address", 240);
  const category = normalizedPlaceRequestField(body, "category", 80);
  const sessionHash = await anonymousSessionHash(session);
  const anonymousUserId = anonymousUserIdFromHash(sessionHash);
  await assertD1AnonymousUserCanWrite(db, anonymousUserId);

  const existing = await findPlaceAdditionRequestByClientId(db, anonymousUserId, clientRequestId);
  if (existing) {
    assertPlaceAdditionIdempotency(existing, { name, address, category });
    return json(ownerPlaceAdditionRequest(existing), {
      idempotentReplay: true,
      ownerOnly: true,
      storage: "d1",
      importPolicy: "manual-review-only",
    });
  }

  await assertPlaceAdditionRequestBudgetAvailable(db, anonymousUserId);

  const now = new Date().toISOString();
  const placeRequestId = `place_request_${crypto.randomUUID()}`;
  let apiCostReservationPlan: ApiCostGuardReservationPlan | null = null;
  try {
    const statements: D1PreparedStatement[] = [];
    if (apiCostGuardRequired(env)) {
      const control = await readApiCostGuardControl(env);
      if (control.mode !== "running") {
        apiCostGuardBlockedReservation("USER_WRITE", control);
      }
      apiCostReservationPlan = createApiCostGuardReservationPlan(db, "USER_WRITE", env, {
        authenticationAttemptReserved,
      });
      statements.push(
        apiCostReservationPlan.statement,
        db.prepare(
          `INSERT INTO anonymous_users (id, session_hash, trust_score, created_at, last_seen_at)
           SELECT ?, ?, 50, ?, ?
           WHERE changes() = 1
           ON CONFLICT(session_hash) DO UPDATE SET last_seen_at = anonymous_users.last_seen_at`,
        ).bind(anonymousUserId, sessionHash, now, now),
        db.prepare(
          `INSERT INTO place_addition_requests
            (id, anonymous_user_id, client_request_id, name, address, category, status, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, 'needs_verification', ?, ?
           WHERE changes() = 1`,
        ).bind(placeRequestId, anonymousUserId, clientRequestId, name, address, category, now, now),
      );
    } else {
      statements.push(
        db.prepare(
          `INSERT INTO anonymous_users (id, session_hash, trust_score, created_at, last_seen_at)
           VALUES (?, ?, 50, ?, ?)
           ON CONFLICT(session_hash) DO NOTHING`,
        ).bind(anonymousUserId, sessionHash, now, now),
        db.prepare(
          `INSERT INTO place_addition_requests
            (id, anonymous_user_id, client_request_id, name, address, category, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'needs_verification', ?, ?)`,
        ).bind(placeRequestId, anonymousUserId, clientRequestId, name, address, category, now, now),
      );
    }

    await runAtomicD1Batch(
      db,
      statements,
      "PLACE_REQUEST_QUEUE_UNAVAILABLE",
      "장소 추가 요청과 비용 보호 원장을 함께 저장할 수 없습니다.",
    );
    const created = await findPlaceAdditionRequestById(db, placeRequestId);
    if (apiCostReservationPlan) {
      if (!created) {
        await completeApiCostGuardReservation("USER_WRITE", null, apiCostReservationPlan, env, ctx);
      }
      const reservation = await readApiCostGuardDaily(db, apiCostReservationPlan.dayUtc);
      if (!reservation) {
        throw new HttpError(503, "API_COST_GUARD_UNAVAILABLE", "서비스 비용 보호 원장을 확인할 수 없습니다.");
      }
      await completeApiCostGuardReservation("USER_WRITE", reservation, apiCostReservationPlan, env, ctx);
    }
    if (!created) {
      throw new HttpError(503, "PLACE_REQUEST_QUEUE_UNAVAILABLE", "저장된 장소 추가 요청을 확인할 수 없습니다.");
    }
    return json(ownerPlaceAdditionRequest(created), {
      idempotentReplay: false,
      ownerOnly: true,
      storage: "d1",
      importPolicy: "manual-review-only",
      costGuard: {
        stopPercent: placeAdditionRequestCostGuardStopPercent,
        dailyRequestStopLimit: placeAdditionRequestDailyStopLimit,
        perSessionDailyLimit: placeAdditionRequestPerSessionDailyLimit,
      },
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("PLACE_REQUEST_SESSION_DAILY_LIMIT")) {
      throw new HttpError(429, "PLACE_REQUEST_SESSION_DAILY_LIMIT", "하루 장소 추가 요청 한도에 도달했습니다.");
    }
    if (message.includes("PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP")) {
      throw new HttpError(
        429,
        "PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP",
        "오늘의 장소 추가 요청 비용 안전 한도에 도달했습니다.",
        {
          stopPercent: placeAdditionRequestCostGuardStopPercent,
          dailyRequestStopLimit: placeAdditionRequestDailyStopLimit,
        },
      );
    }
    if (error instanceof HttpError) {
      throw error;
    }
    const replay = await findPlaceAdditionRequestByClientId(db, anonymousUserId, clientRequestId);
    if (replay) {
      assertPlaceAdditionIdempotency(replay, { name, address, category });
      return json(ownerPlaceAdditionRequest(replay), {
        idempotentReplay: true,
        ownerOnly: true,
        storage: "d1",
        importPolicy: "manual-review-only",
      });
    }
    throw new HttpError(503, "PLACE_REQUEST_QUEUE_UNAVAILABLE", "장소 추가 요청 큐를 사용할 수 없습니다.");
  }
}

async function listMyPlaceAdditionRequests(url: URL, session: AnonymousSession, env: Env): Promise<Response> {
  if (url.searchParams.get("mine") !== "1") {
    throw new HttpError(400, "PLACE_REQUEST_MINE_REQUIRED", "mine=1인 본인 요청만 조회할 수 있습니다.");
  }
  const db = requireD1(env);
  const anonymousUserId = await anonymousUserIdForSession(session);
  const limit = clampLimit(url.searchParams.get("limit"), 100, 50);
  const { results = [] } = await db
    .prepare(
      `SELECT
         id,
         client_request_id AS clientRequestId,
         name,
         address,
         category,
         status,
         matched_place_id AS matchedPlaceId,
         created_at AS createdAt,
         updated_at AS updatedAt,
         reviewed_at AS reviewedAt
       FROM place_addition_requests
       WHERE anonymous_user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(anonymousUserId, limit)
    .all<PublicPlaceAdditionRequestRecord>();

  return json(results.map(ownerPlaceAdditionRequest), { ownerOnly: true, limit, storage: "d1" });
}

function ownerPlaceAdditionRequest(request: PublicPlaceAdditionRequestRecord | PlaceAdditionRequestRecord) {
  return {
    id: request.id,
    clientRequestId: request.clientRequestId,
    name: request.name,
    address: request.address,
    category: request.category,
    status: request.status,
    matchedPlaceId: request.matchedPlaceId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt,
  };
}

async function listPlaceAdditionRequestQueue(url: URL, env: Env): Promise<Response> {
  const db = requireD1(env);
  const requestedStatus = url.searchParams.get("status");
  const statuses: PlaceAdditionRequestStatus[] = ["needs_verification", "ready_for_manual_import", "duplicate", "rejected"];
  if (requestedStatus && !statuses.includes(requestedStatus as PlaceAdditionRequestStatus)) {
    throw new HttpError(400, "VALIDATION_ERROR", "status 값이 올바르지 않습니다.");
  }
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);
  const where = requestedStatus ? "WHERE status = ?" : "";
  const values: D1Value[] = requestedStatus ? [requestedStatus, limit] : [limit];
  const { results = [] } = await db
    .prepare(
      `SELECT
         id,
         client_request_id AS clientRequestId,
         name,
         address,
         category,
         status,
         review_reason AS reviewReason,
         matched_place_id AS matchedPlaceId,
         created_at AS createdAt,
         updated_at AS updatedAt,
         reviewed_at AS reviewedAt
       FROM place_addition_requests
       ${where}
       ORDER BY CASE status WHEN 'needs_verification' THEN 0 WHEN 'ready_for_manual_import' THEN 1 ELSE 2 END,
                created_at ASC
       LIMIT ?`,
    )
    .bind(...values)
    .all<PlaceAdditionRequestRecord>();

  return json(results, {
    authz: "moderator-role",
    status: requestedStatus ?? "all",
    limit,
    storage: "d1",
    privacy: "anonymous requester identity is not returned",
  });
}

async function reviewPlaceAdditionRequest(requestId: string, request: Request, env: Env): Promise<Response> {
  const db = requireD1(env);
  if (!/^place_request_[a-zA-Z0-9-]{8,100}$/.test(requestId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "placeRequestId 값이 올바르지 않습니다.");
  }
  const body = await readJson(request);
  assertExactFields(body, ["status", "reason", "matchedPlaceId"]);
  const status = enumField(body, "status", ["needs_verification", "ready_for_manual_import", "duplicate", "rejected"] as const);
  const reason = stringField(body, "reason", 300);
  if (reason.length < 5) {
    throw new HttpError(400, "PLACE_REQUEST_REVIEW_REASON_REQUIRED", "운영 검토 사유를 5자 이상 입력해 주세요.");
  }
  const matchedPlaceId = optionalStringField(body, "matchedPlaceId", 100) ?? null;
  if (status === "duplicate") {
    if (!matchedPlaceId) {
      throw new HttpError(400, "MATCHED_VERIFIED_PLACE_REQUIRED", "중복 판정에는 검증된 장소가 필요합니다.");
    }
    const matchedPlace = await db
      .prepare(
        `SELECT id
         FROM places
         WHERE id = ?
           AND is_active = 1
           AND coordinate_status = 'verified'
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL
         LIMIT 1`,
      )
      .bind(matchedPlaceId)
      .first<{ id: string }>();
    if (!matchedPlace) {
      throw new HttpError(400, "MATCHED_VERIFIED_PLACE_REQUIRED", "중복 판정에는 검증된 장소가 필요합니다.");
    }
  } else if (matchedPlaceId) {
    throw new HttpError(400, "MATCHED_PLACE_ONLY_FOR_DUPLICATE", "중복 판정에서만 일치 장소를 지정할 수 있습니다.");
  }

  const current = await findPlaceAdditionRequestById(db, requestId);
  if (!current) {
    throw new HttpError(404, "PLACE_REQUEST_NOT_FOUND", "장소 추가 요청을 찾을 수 없습니다.");
  }
  if ((current.status === "duplicate" || current.status === "rejected") && current.status !== status) {
    throw new HttpError(409, "PLACE_REQUEST_TERMINAL_STATUS", "완료된 장소 요청 검토 상태는 다시 변경할 수 없습니다.");
  }

  const now = new Date().toISOString();
  try {
    await runAtomicD1Batch(db, [
      db.prepare(
        `INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at)
         SELECT ?, ?, ?, 'place_request', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM place_addition_requests WHERE id = ? AND status = ?
         )`,
      ).bind(
        `admin_${crypto.randomUUID()}`,
        adminSubject(request),
        `place_request_${status}`,
        requestId,
        reason,
        now,
        requestId,
        current.status,
      ),
      db.prepare(
        `UPDATE place_addition_requests
         SET status = ?, review_reason = ?, matched_place_id = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      ).bind(status, reason, status === "duplicate" ? matchedPlaceId : null, now, now, requestId, current.status),
    ], "PLACE_REQUEST_AUDIT_UNAVAILABLE", "장소 요청 검토와 감사 기록을 함께 저장할 수 없습니다.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("PLACE_REQUEST_TERMINAL_STATUS")) {
      throw new HttpError(409, "PLACE_REQUEST_TERMINAL_STATUS", "완료된 장소 요청 검토 상태는 다시 변경할 수 없습니다.");
    }
    throw new HttpError(503, "PLACE_REQUEST_AUDIT_UNAVAILABLE", "장소 요청 검토와 감사 기록을 함께 저장할 수 없습니다.");
  }

  const updated = await findPlaceAdditionRequestById(db, requestId);
  if (!updated) {
    throw new HttpError(503, "PLACE_REQUEST_QUEUE_UNAVAILABLE", "검토 결과를 확인할 수 없습니다.");
  }
  if (
    updated.status !== status
    || updated.reviewReason !== reason
    || updated.reviewedAt !== now
    || updated.matchedPlaceId !== (status === "duplicate" ? matchedPlaceId : null)
  ) {
    throw new HttpError(409, "PLACE_REQUEST_REVIEW_CONFLICT", "다른 운영자가 먼저 장소 요청을 검토했습니다. 최신 상태를 다시 확인해 주세요.");
  }

  return json(updated, { auditPolicy: "admin_actions", importPolicy: "manual-review-only", storage: "d1" });
}

async function findPlaceAdditionRequestById(db: D1Database, requestId: string): Promise<PlaceAdditionRequestRecord | null> {
  return db
    .prepare(
      `SELECT
         id,
         client_request_id AS clientRequestId,
         name,
         address,
         category,
         status,
         review_reason AS reviewReason,
         matched_place_id AS matchedPlaceId,
         created_at AS createdAt,
         updated_at AS updatedAt,
         reviewed_at AS reviewedAt
       FROM place_addition_requests
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(requestId)
    .first<PlaceAdditionRequestRecord>();
}

async function findPlaceAdditionRequestByClientId(
  db: D1Database,
  anonymousUserId: string,
  clientRequestId: string,
): Promise<PlaceAdditionRequestRecord | null> {
  return db
    .prepare(
      `SELECT
         id,
         client_request_id AS clientRequestId,
         name,
         address,
         category,
         status,
         review_reason AS reviewReason,
         matched_place_id AS matchedPlaceId,
         created_at AS createdAt,
         updated_at AS updatedAt,
         reviewed_at AS reviewedAt
       FROM place_addition_requests
       WHERE anonymous_user_id = ? AND client_request_id = ?
       LIMIT 1`,
    )
    .bind(anonymousUserId, clientRequestId)
    .first<PlaceAdditionRequestRecord>();
}

async function assertPlaceAdditionRequestBudgetAvailable(
  db: D1Database,
  anonymousUserId: string,
): Promise<void> {
  const budget = await db
    .prepare(
      `SELECT
         (
           SELECT COUNT(*)
           FROM place_addition_requests
           WHERE anonymous_user_id = ?
             AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')
             AND created_at < strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')
         ) AS sessionRequestCount,
         COALESCE((
           SELECT request_count
           FROM place_addition_request_daily_budget
           WHERE day_utc = strftime('%Y-%m-%d', 'now')
         ), 0) AS dailyRequestCount`,
    )
    .bind(anonymousUserId)
    .first<{ sessionRequestCount: number; dailyRequestCount: number }>();

  if (!budget) {
    throw new HttpError(503, "PLACE_REQUEST_QUEUE_UNAVAILABLE", "장소 추가 요청 비용 한도를 확인할 수 없습니다.");
  }
  if (budget.sessionRequestCount >= placeAdditionRequestPerSessionDailyLimit) {
    throw new HttpError(429, "PLACE_REQUEST_SESSION_DAILY_LIMIT", "하루 장소 추가 요청 한도에 도달했습니다.");
  }
  if (budget.dailyRequestCount >= placeAdditionRequestDailyStopLimit) {
    throw new HttpError(
      429,
      "PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP",
      "오늘의 장소 추가 요청 비용 안전 한도에 도달했습니다.",
      {
        stopPercent: placeAdditionRequestCostGuardStopPercent,
        dailyRequestStopLimit: placeAdditionRequestDailyStopLimit,
      },
    );
  }
}

function assertPlaceAdditionIdempotency(
  existing: PlaceAdditionRequestRecord,
  input: Pick<PlaceAdditionRequestRecord, "name" | "address" | "category">,
): void {
  if (existing.name !== input.name || existing.address !== input.address || existing.category !== input.category) {
    throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청 식별자를 다른 장소 요청에 다시 사용할 수 없습니다.");
  }
}

function normalizedPlaceRequestField(body: JsonObject, field: string, maxLength: number): string {
  const normalized = stringField(body, field, maxLength * 2)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const value = field === "category" ? normalized.toLocaleLowerCase("ko-KR") : normalized;
  if (!value || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function assertExactFields(body: JsonObject, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    throw new HttpError(400, "UNSUPPORTED_FIELD", "지원하지 않는 요청 필드가 포함되어 있습니다.");
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
  const postId = url.searchParams.get("postId")?.trim() || null;
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
    if (postId) {
      where.push("po.id = ?");
      values.push(postId);
    }
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
    .filter((post) => !postId || post.id === postId)
    .filter((post) => !placeId || post.placeId === placeId)
    .filter((post) => !regionId || findPlaceRecord(post.placeId).regionId === regionId)
    .filter((post) => !hashtagName || post.hashtagNames.includes(hashtagName));
  const data = filtered.map((post) => publicPost(post, findPlaceRecord(post.placeId), env));

  return json(rankPostsForFeed(data).slice(0, limit), { limit, regionId: regionId ?? "all", storage: "memory-fallback" });
}

async function getSharedPost(postId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const postsResponse = await listPosts(
    new URL(`https://silsigan.internal/api/posts?postId=${encodeURIComponent(postId)}&limit=1`),
    session,
    env,
  );
  if (!postsResponse.ok) {
    return postsResponse;
  }

  const payload = (await postsResponse.json()) as { success?: boolean; data?: unknown };
  const post = Array.isArray(payload.data) ? payload.data[0] : null;
  if (!payload.success || !post || typeof post !== "object" || post === null || typeof (post as { placeId?: unknown }).placeId !== "string") {
    throw new HttpError(404, "NOT_FOUND", "공유할 제보를 찾을 수 없습니다.");
  }

  const place = await resolvePlaceRecord((post as { placeId: string }).placeId, env);
  const status = await resolvePlaceStatusData(place.id, env);
  const postRecord = post as Parameters<typeof buildPostShareCard>[0];
  return json(
    {
      ...post,
      shareCard: buildPostShareCard(postRecord, place, status, env),
      status,
    },
    { storage: env.DB ? "d1" : "memory-fallback", contractVersion: 2 },
  );
}

async function createPost(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const place = await resolvePlaceRecord(placeId, env);
  await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.posts, env, place.regionId);
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

  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    if (env.PHOTOS) {
      await assertPhotoUploadsEnabled(env.DB);
    }
  }
  const locationVerification = await verifyFieldReportLocation(place, clientLocation, env);
  const verifiedRadiusM = locationVerification.verifiedRadiusM;
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
    locationVerified: locationVerification.verificationMethod !== "none",
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
      verificationMethod: locationVerification.verificationMethod,
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

    return json(postSubmitResponse(post, place, recommendedHashtags, env), { anonymousUserPolicy: "hashed-session-id", storage: "d1" }, 201);
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

  return json(postSubmitResponse(post, place, recommendedHashtags, env), { anonymousUserPolicy: "header-or-cookie-session", storage: "memory-fallback" }, 201);
}

async function listHashtags(url: URL, env: Env): Promise<Response> {
  const name = normalizeHashtagName(url.searchParams.get("name") ?? "");
  const regionId = url.searchParams.get("regionId") ?? url.searchParams.get("region");
  const placeId = url.searchParams.get("placeId");
  const hasPhoto = hashtagBooleanParam(url.searchParams.get("hasPhoto"), true, "hasPhoto");
  const activeOnly = hashtagBooleanParam(url.searchParams.get("activeOnly"), true, "activeOnly");
  const sort = url.searchParams.get("sort") ?? "recent";
  const cursor = url.searchParams.get("cursor");
  const limit = clampLimit(url.searchParams.get("limit"), 100, 24);
  if (sort !== "recent") {
    throw new HttpError(400, "HASHTAG_SORT_INVALID", "해시태그 사진은 최신순으로만 조회할 수 있습니다.");
  }
  if (cursor && !name) {
    throw new HttpError(400, "HASHTAG_CURSOR_REQUIRES_NAME", "해시태그 사진 페이지 조회에는 태그 이름이 필요합니다.");
  }

  const socialFeedEnabled = await resolveRuntimeFeatureFlag("SOCIAL_FEED_ENABLED", env, regionId ?? undefined);
  const sourcePosts = socialFeedEnabled
    ? env.DB
      ? await listD1PostsForHashtags(env.DB, { name, regionId, placeId, hasPhoto })
      : posts
          .filter((post) => !post.hiddenAt && (!hasPhoto || post.photoCount > 0))
          .filter((post) => !name || post.hashtagNames.includes(name))
          .filter((post) => !placeId || post.placeId === placeId)
          .filter((post) => !regionId || findPlaceRecord(post.placeId).regionId === regionId)
    : [];
  const legacyHashtags = hashtagRecordsForPosts(sourcePosts);
  const publicationHashtags = env.DB
    ? await listD1FieldReportHashtags(env.DB, { name, regionId, placeId, hasPhoto, activeOnly, cursor, limit })
    : listMemoryFieldReportHashtags({ name, regionId, placeId, hasPhoto, activeOnly, cursor, limit });
  const data = mergeHashtagRecords([...legacyHashtags, ...publicationHashtags]);

  return json(data, {
    limit: name ? limit : data.length,
    storage: env.DB ? "d1" : "memory-fallback",
    socialFeedEnabled,
    filters: { name: name || null, regionId: regionId ?? null, placeId: placeId ?? null, hasPhoto, activeOnly, sort },
  });
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

async function createQuestion(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const place = await resolvePlaceRecord(placeId, env);
  await requireFeatureEnabled(FEATURE_GATED_API_FLAGS.questions, env, place.regionId);
  await requireFeatureEnabled("REWARDS_ENABLED", env, place.regionId);
  throw new HttpError(503, "CREDIT_LEDGER_REQUIRED", "질문권 장부가 준비되지 않아 질문 기능을 사용할 수 없습니다.");
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

async function listPreferences(session: AnonymousSession, env: Env): Promise<Response> {
  if (!env.DB) {
    const state = preferenceStateFor(session.id);
    return json(preferenceResponse(state), { storage: "memory-fallback" });
  }

  const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
  const actorIdentityKey = `anonymous:${anonymousUserId}`;
  const [savedPlaces, savedPosts, followedTopics, notifications] = await Promise.all([
    env.DB.prepare("SELECT place_id AS placeId FROM saved_places WHERE actor_identity_key = ? ORDER BY updated_at DESC").bind(actorIdentityKey).all<{ placeId: string }>(),
    env.DB.prepare("SELECT post_id AS postId FROM saved_posts WHERE actor_identity_key = ? ORDER BY updated_at DESC").bind(actorIdentityKey).all<{ postId: string }>(),
    env.DB.prepare("SELECT topic_name AS topicName FROM followed_topics WHERE actor_identity_key = ? ORDER BY updated_at DESC").bind(actorIdentityKey).all<{ topicName: string }>(),
    env.DB.prepare("SELECT platform, enabled FROM notification_subscriptions WHERE actor_identity_key = ? ORDER BY updated_at DESC LIMIT 1").bind(actorIdentityKey).first<{ platform: string; enabled: number }>(),
  ]);

  return json({
    savedPlaceIds: (savedPlaces.results ?? []).map((row) => row.placeId),
    savedPostIds: (savedPosts.results ?? []).map((row) => row.postId),
    followedTopicNames: (followedTopics.results ?? []).map((row) => row.topicName),
    notificationEnabled: Boolean(notifications?.enabled),
    notificationPlatform: notifications?.platform ?? "webview",
  }, { storage: "d1" });
}

async function recordAnalyticsEvent(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  const eventName = enumField(body, "eventName", analyticsEventNames);
  const rawProperties = body.properties;
  if (rawProperties !== undefined && !isRecord(rawProperties)) {
    throw new HttpError(400, "VALIDATION_ERROR", "analytics properties 값이 올바르지 않습니다.");
  }

  const anonymousUserId = await ensureD1AnonymousUser(db, session);
  const actorIdentityKey = `analytics:${await sha256Hex(`silsigan-anon:${anonymousUserId}`)}`;
  const properties = sanitizeAnalyticsProperties(rawProperties ?? {});
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO analytics_events (id, event_name, actor_identity_key, properties_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(`analytics_${crypto.randomUUID()}`, eventName, actorIdentityKey, JSON.stringify(properties), createdAt)
    .run();

  return json(
    { accepted: true, eventName },
    { storage: "d1", privacy: "server-allowlisted-properties-anonymous-hash" },
    202,
  );
}

async function getBetaKpis(url: URL, env: Env): Promise<Response> {
  const db = requireD1(env);
  const windowDays = betaKpiWindowDays(url.searchParams.get("days"));
  const generatedAt = new Date().toISOString();
  const cutoff = new Date(Date.parse(generatedAt) - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const [eventCountsResult, audience, durationResult, moderation, d1Retention, d7Retention, freshCoverage, runtimeReliability] = await Promise.all([
    db
      .prepare(
        `SELECT
          event_name AS eventName,
          COUNT(*) AS count,
          COUNT(DISTINCT actor_identity_key) AS uniqueActors
        FROM analytics_events
        WHERE created_at >= ?
        GROUP BY event_name`,
      )
      .bind(cutoff)
      .all<D1AnalyticsEventCountRow>(),
    db
      .prepare("SELECT COUNT(DISTINCT actor_identity_key) AS activeUsers FROM analytics_events WHERE created_at >= ?")
      .bind(cutoff)
      .first<D1BetaAudienceRow>(),
    db
      .prepare(
        `SELECT CAST(json_extract(properties_json, '$.completionMs') AS REAL) AS durationMs
         FROM analytics_events
         WHERE event_name = 'report_submitted'
           AND created_at >= ?
           AND json_type(properties_json, '$.completionMs') IN ('integer', 'real')
           AND CAST(json_extract(properties_json, '$.completionMs') AS REAL) BETWEEN 0 AND 600000
         ORDER BY durationMs ASC
         LIMIT 10000`,
      )
      .bind(cutoff)
      .all<D1BetaDurationRow>(),
    db
      .prepare(
        `SELECT
          COUNT(*) AS submitted,
          COALESCE(SUM(CASE WHEN moderation_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN moderation_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
          COALESCE(SUM(CASE WHEN moderation_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
          COALESCE(SUM(CASE WHEN moderation_status = 'hidden' THEN 1 ELSE 0 END), 0) AS hidden,
          COALESCE(SUM(CASE
            WHEN moderation_status != 'pending'
              AND (julianday(updated_at) - julianday(created_at)) * 24 <= 24
            THEN 1 ELSE 0 END), 0) AS reviewedWithin24Hours
        FROM field_report_publications
        WHERE created_at >= ?`,
      )
      .bind(cutoff)
      .first<D1BetaModerationRow>(),
    betaRetentionMetric(db, cutoff, generatedAt, 1),
    betaRetentionMetric(db, cutoff, generatedAt, 7),
    db
      .prepare(
        `WITH eligible AS (
          SELECT
            place.launch_stage AS launchStage,
            CASE WHEN EXISTS (
              SELECT 1
              FROM live_signals signal
              WHERE signal.place_id = place.id
                AND signal.is_publicly_visible = 1
                AND signal.expires_at > ?
            ) THEN 1 ELSE 0 END AS covered
          FROM places place
          WHERE place.is_active = 1
            AND place.coordinate_status = 'verified'
            AND place.launch_stage IN ('beta', 'active')
        )
        SELECT
          COUNT(*) AS eligiblePlaces,
          COALESCE(SUM(covered), 0) AS coveredPlaces,
          COALESCE(SUM(CASE WHEN launchStage = 'active' THEN 1 ELSE 0 END), 0) AS tierAEligiblePlaces,
          COALESCE(SUM(CASE WHEN launchStage = 'active' THEN covered ELSE 0 END), 0) AS tierACoveredPlaces,
          COALESCE(SUM(CASE WHEN launchStage = 'beta' THEN 1 ELSE 0 END), 0) AS tierBEligiblePlaces,
          COALESCE(SUM(CASE WHEN launchStage = 'beta' THEN covered ELSE 0 END), 0) AS tierBCoveredPlaces
        FROM eligible`,
      )
      .bind(generatedAt)
      .first<D1BetaFreshCoverageRow>(),
    db
      .prepare(
        `WITH opened AS (
           SELECT DISTINCT actor_identity_key
           FROM analytics_events
           WHERE event_name = 'app_opened' AND created_at >= ?
         ), errored AS (
           SELECT DISTINCT actor_identity_key
           FROM analytics_events
           WHERE event_name = 'app_runtime_error' AND created_at >= ?
         )
         SELECT
           COUNT(*) AS appOpenUsers,
           COALESCE(SUM(CASE WHEN EXISTS (
             SELECT 1 FROM errored WHERE errored.actor_identity_key = opened.actor_identity_key
           ) THEN 1 ELSE 0 END), 0) AS errorUsers
         FROM opened`,
      )
      .bind(cutoff, cutoff)
      .first<D1BetaRuntimeReliabilityRow>(),
  ]);

  const eventCounts = new Map(
    (eventCountsResult.results ?? []).map((row) => [row.eventName, { count: nonNegativeInteger(row.count), uniqueActors: nonNegativeInteger(row.uniqueActors) }]),
  );
  const count = (eventName: string) => eventCounts.get(eventName)?.count ?? 0;
  const reportStarted = count("report_started");
  const reportSubmitted = count("report_submitted");
  const mapSucceeded = count("map_load_succeeded");
  const mapFailed = count("map_load_failed");
  const reviewed = nonNegativeInteger(moderation?.approved) + nonNegativeInteger(moderation?.rejected) + nonNegativeInteger(moderation?.hidden);
  const appOpenUsers = nonNegativeInteger(runtimeReliability?.appOpenUsers);
  const errorUsers = Math.min(appOpenUsers, nonNegativeInteger(runtimeReliability?.errorUsers));
  const durations = (durationResult.results ?? [])
    .map((row) => Number(row.durationMs))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 600_000);

  return json(
    {
      windowDays,
      generatedAt,
      privacy: "aggregate-only",
      audience: {
        activeUsers: nonNegativeInteger(audience?.activeUsers),
        appOpens: count("app_opened"),
      },
      reportFunnel: {
        started: reportStarted,
        submitted: reportSubmitted,
        conversionPercent: betaPercent(reportSubmitted, reportStarted),
        medianCompletionSeconds: betaMedianSeconds(durations),
      },
      mapReliability: {
        succeeded: mapSucceeded,
        failed: mapFailed,
        successPercent: betaPercent(mapSucceeded, mapSucceeded + mapFailed),
      },
      moderation: {
        submitted: nonNegativeInteger(moderation?.submitted),
        pending: nonNegativeInteger(moderation?.pending),
        approved: nonNegativeInteger(moderation?.approved),
        rejected: nonNegativeInteger(moderation?.rejected),
        hidden: nonNegativeInteger(moderation?.hidden),
        approvalPercent: betaPercent(nonNegativeInteger(moderation?.approved), reviewed),
        reviewedWithin24HoursPercent: betaPercent(nonNegativeInteger(moderation?.reviewedWithin24Hours), reviewed),
      },
      retention: {
        d1: betaRetentionResponse(d1Retention),
        d7: betaRetentionResponse(d7Retention),
      },
      freshCoverage: {
        eligiblePlaces: nonNegativeInteger(freshCoverage?.eligiblePlaces),
        coveredPlaces: nonNegativeInteger(freshCoverage?.coveredPlaces),
        percent: betaPercent(nonNegativeInteger(freshCoverage?.coveredPlaces), nonNegativeInteger(freshCoverage?.eligiblePlaces)),
        tierA: betaFreshCoverageResponse(freshCoverage?.tierAEligiblePlaces, freshCoverage?.tierACoveredPlaces),
        tierB: betaFreshCoverageResponse(freshCoverage?.tierBEligiblePlaces, freshCoverage?.tierBCoveredPlaces),
      },
      runtimeReliability: {
        appOpenUsers,
        errorUsers,
        errorFreePercent: betaPercent(appOpenUsers - errorUsers, appOpenUsers),
      },
    },
    {
      storage: "d1",
      privacy: "aggregate-only-no-actor-identifiers-or-event-properties",
      definitions: {
        freshCoverage: "verified active Tier A and beta Tier B places with a current public live signal",
        runtimeReliability: "app-open actors without a captured application error; native crash-free evidence remains separate",
        rejectedReports: "moderation outcome only; not a proven false-report rate",
      },
    },
  );
}

function betaFreshCoverageResponse(eligiblePlacesValue: number | undefined, coveredPlacesValue: number | undefined) {
  const eligiblePlaces = nonNegativeInteger(eligiblePlacesValue);
  const coveredPlaces = Math.min(eligiblePlaces, nonNegativeInteger(coveredPlacesValue));
  return {
    eligiblePlaces,
    coveredPlaces,
    percent: betaPercent(coveredPlaces, eligiblePlaces),
  };
}

async function betaRetentionMetric(
  db: D1Database,
  cutoff: string,
  generatedAt: string,
  retentionDays: 1 | 7,
): Promise<D1BetaRetentionRow | null> {
  return db
    .prepare(
      `WITH first_seen AS (
         SELECT actor_identity_key, date(MIN(created_at)) AS firstDay
         FROM analytics_events
         GROUP BY actor_identity_key
       ), matured AS (
         SELECT actor_identity_key, firstDay
         FROM first_seen
         WHERE firstDay >= date(?)
           AND firstDay <= date(?, ?)
       )
       SELECT
         COUNT(*) AS cohortUsers,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1
           FROM analytics_events retained
           WHERE retained.actor_identity_key = matured.actor_identity_key
             AND date(retained.created_at) = date(matured.firstDay, ?)
         ) THEN 1 ELSE 0 END), 0) AS retainedUsers
       FROM matured`,
    )
    .bind(cutoff, generatedAt, `-${retentionDays} day`, `+${retentionDays} day`)
    .first<D1BetaRetentionRow>();
}

function betaKpiWindowDays(value: string | null): 7 | 30 {
  if (value === null || value === "" || value === "7") {
    return 7;
  }
  if (value === "30") {
    return 30;
  }
  throw new HttpError(400, "BETA_KPI_WINDOW_INVALID", "KPI 조회 기간은 7일 또는 30일이어야 합니다.");
}

function betaRetentionResponse(row: D1BetaRetentionRow | null) {
  const cohortUsers = nonNegativeInteger(row?.cohortUsers);
  const retainedUsers = Math.min(cohortUsers, nonNegativeInteger(row?.retainedUsers));
  return { cohortUsers, retainedUsers, percent: betaPercent(retainedUsers, cohortUsers) };
}

function betaPercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const bounded = Math.min(Math.max(numerator, 0), denominator);
  return Math.round((bounded / denominator) * 10_000) / 100;
}

function betaMedianSeconds(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const middle = Math.floor(values.length / 2);
  const medianMs = values.length % 2 === 0 ? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2 : values[middle] ?? 0;
  return Math.round((medianMs / 1000) * 100) / 100;
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function sanitizeAnalyticsProperties(properties: JsonObject): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  const forbiddenKeyPattern = /(latitude|longitude|lng|coordinate|client.?location|body|caption|comment|memo|note|email|phone|filename|photo.?url|token|secret|password|cookie|authorization|anonymous|anon|raw|error|stack|digest)/i;
  const sensitiveValuePattern = /^(?:anon_|data:|https?:\/\/)|@|(?:\+?\d[\d\s().-]{7,})/i;

  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(sanitized).length >= 40 || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key) || forbiddenKeyPattern.test(key)) {
      continue;
    }

    if (typeof value === "string") {
      if (!value || value === "[redacted]" || value.length > 120 || sensitiveValuePattern.test(value)) {
        continue;
      }
      sanitized[key] = value;
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        sanitized[key] = value;
      }
      continue;
    }

    if (typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

async function updatePreference(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const body = await readJson(request);
  const kind = enumField(body, "kind", ["saved_place", "saved_post", "followed_topic", "notifications"] as const);
  const enabled = booleanField(body, "enabled");
  const key = kind === "notifications" ? null : stringField(body, "key", 80);
  const platform = body.platform === undefined
    ? "webview"
    : enumField(body, "platform", ["webview", "ios", "android", "web"] as const);
  const pushTokenHashProvided = Object.prototype.hasOwnProperty.call(body, "pushTokenHash");
  const pushTokenHash = pushTokenHashProvided
    ? body.pushTokenHash === null
      ? null
      : optionalStringField(body, "pushTokenHash", 80)
    : undefined;

  if (pushTokenHashProvided && pushTokenHash !== null && (!pushTokenHash || !/^sha256:[a-f0-9]{64}$/i.test(pushTokenHash))) {
    throw new HttpError(400, "VALIDATION_ERROR", "pushTokenHash 값이 올바르지 않습니다.");
  }

  if (!env.DB) {
    const state = preferenceStateFor(session.id);
    if (kind === "saved_place") {
      findPlaceRecord(key as string);
      updateSet(state.savedPlaceIds, key as string, enabled);
    } else if (kind === "saved_post") {
      if (!posts.some((post) => post.id === key && !post.hiddenAt)) {
        throw new HttpError(404, "POST_NOT_FOUND", "저장할 게시물을 찾을 수 없습니다.");
      }
      updateSet(state.savedPostIds, key as string, enabled);
    } else if (kind === "followed_topic") {
      updateSet(state.followedTopicNames, key as string, enabled);
    } else {
      state.notificationEnabled = enabled;
    }

    return json(preferenceResponse(state), { storage: "memory-fallback" });
  }

  const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
  const actorIdentityKey = `anonymous:${anonymousUserId}`;
  const now = new Date().toISOString();

  if (kind === "saved_place") {
    await resolvePlaceRecord(key as string, env);
    if (enabled) {
      await env.DB.prepare(
        `INSERT INTO saved_places (actor_identity_key, place_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(actor_identity_key, place_id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(actorIdentityKey, key, now, now).run();
    } else {
      await env.DB.prepare("DELETE FROM saved_places WHERE actor_identity_key = ? AND place_id = ?").bind(actorIdentityKey, key).run();
    }
  } else if (kind === "saved_post") {
    const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status <> 'deleted' LIMIT 1").bind(key).first<{ id: string }>();
    if (!post) {
      throw new HttpError(404, "POST_NOT_FOUND", "저장할 게시물을 찾을 수 없습니다.");
    }
    if (enabled) {
      await env.DB.prepare(
        `INSERT INTO saved_posts (actor_identity_key, post_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(actor_identity_key, post_id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(actorIdentityKey, key, now, now).run();
    } else {
      await env.DB.prepare("DELETE FROM saved_posts WHERE actor_identity_key = ? AND post_id = ?").bind(actorIdentityKey, key).run();
    }
  } else if (kind === "followed_topic") {
    if (enabled) {
      await env.DB.prepare(
        `INSERT INTO followed_topics (actor_identity_key, topic_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(actor_identity_key, topic_name) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(actorIdentityKey, key, now, now).run();
    } else {
      await env.DB.prepare("DELETE FROM followed_topics WHERE actor_identity_key = ? AND topic_name = ?").bind(actorIdentityKey, key).run();
    }
  } else {
    const pushTokenUpdate = pushTokenHashProvided
      ? "push_token_hash = excluded.push_token_hash"
      : "push_token_hash = notification_subscriptions.push_token_hash";
    await env.DB.prepare(
      `INSERT INTO notification_subscriptions
        (id, actor_identity_key, push_token_hash, platform, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(actor_identity_key, platform) DO UPDATE SET
         ${pushTokenUpdate},
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    ).bind(`notification_${crypto.randomUUID()}`, actorIdentityKey, pushTokenHash ?? null, platform, Number(enabled), now, now).run();
  }

  return listPreferences(session, env);
}

function preferenceStateFor(anonymousId: string): PreferenceState {
  const existing = preferencesByAnonymousId.get(anonymousId);
  if (existing) {
    return existing;
  }

  const state: PreferenceState = {
    savedPlaceIds: new Set(),
    savedPostIds: new Set(),
    followedTopicNames: new Set(),
    notificationEnabled: false,
  };
  preferencesByAnonymousId.set(anonymousId, state);
  return state;
}

function preferenceResponse(state: PreferenceState) {
  return {
    savedPlaceIds: [...state.savedPlaceIds],
    savedPostIds: [...state.savedPostIds],
    followedTopicNames: [...state.followedTopicNames],
    notificationEnabled: state.notificationEnabled,
    notificationPlatform: "webview",
  };
}

function updateSet(set: Set<string>, value: string, enabled: boolean) {
  if (enabled) {
    set.add(value);
  } else {
    set.delete(value);
  }
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
          COALESCE((
            SELECT COALESCE(
              json_extract(pms.automated_checks_json, '$.clientReportedProximity'),
              json_extract(pms.automated_checks_json, '$.locationVerified')
            )
            FROM photo_moderation_states pms
            WHERE pms.photo_id = photos.id
          ), 0) AS clientReportedProximity,
          (
            SELECT COALESCE(
              json_extract(pms.automated_checks_json, '$.proximityRadiusM'),
              json_extract(pms.automated_checks_json, '$.verifiedRadiusM')
            )
            FROM photo_moderation_states pms
            WHERE pms.photo_id = photos.id
          ) AS proximityRadiusM,
          COALESCE((
            SELECT COALESCE(
              json_extract(pms.automated_checks_json, '$.proximityAccuracyBucket'),
              json_extract(pms.automated_checks_json, '$.accuracyBucket')
            )
            FROM photo_moderation_states pms
            WHERE pms.photo_id = photos.id
          ), 'unknown') AS proximityAccuracyBucket,
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
  const proximityRadiusM = photo.proximityRadiusM ?? null;
  const clientReportedProximity =
    (photo.clientReportedProximity === true || photo.clientReportedProximity === 1) && proximityRadiusM
      ? {
          evidence: photoLocationEvidence,
          radiusM: proximityRadiusM,
          accuracyBucket: photo.proximityAccuracyBucket ?? "unknown",
        }
      : null;

  return {
    id: photo.id,
    placeId: photo.placeId,
    mimeType: photo.mimeType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    clickCount: photo.clickCount,
    clientReportedProximity,
    status: photo.status,
    createdAt: photo.createdAt,
    ownedByCurrentSession: photo.anonymousUserId === currentAnonymousUserId,
    previewUrl: env.PHOTOS ? new URL(`/api/photos/${encodeURIComponent(photo.id)}/file`, requestUrl.origin).toString() : null,
  };
}

async function createPhotoUploadTicket(
  request: Request,
  session: AnonymousSession,
  env: Env,
  transport: { method: "POST" | "PUT"; uploadUrl: string },
): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const mimeType = stringField(body, "mimeType", 40);
  const byteSize = numberField(body, "byteSize");
  const width = numberField(body, "width");
  const height = numberField(body, "height");
  assertPhotoRightsAttestation(body);
  const clientLocation = optionalClientLocationField(body);
  if (!clientLocation) {
    throw new HttpError(
      400,
      "PHOTO_LOCATION_REQUIRED",
      "사진을 올리려면 브라우저가 제공한 현재 위치가 필요합니다.",
    );
  }
  const turnstileToken = optionalStringField(body, "turnstileToken", photoTurnstileTokenMaxLength);
  await assertPhotoTurnstileProof(request, turnstileToken, env);

  const place = await resolvePlaceRecord(placeId, env);
  const locationVerification = await verifyFieldReportLocation(place, clientLocation, env);
  if (!locationVerification.verifiedRadiusM) {
    throw new HttpError(
      400,
      "PHOTO_LOCATION_NOT_VERIFIED",
      "제출한 기기 위치가 선택 장소의 반경 안인지 확인할 수 없습니다.",
    );
  }
  const proximityRadiusM = locationVerification.verifiedRadiusM;
  const proximityAccuracyBucket = locationAccuracyBucketForMeters(clientLocation.accuracyM);
  let anonymousUserId: string | null = null;
  if (env.DB) {
    anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    if (env.PHOTOS) {
      await assertPhotoUploadsEnabled(env.DB);
    }
  }
  if (mimeType !== "image/webp" && mimeType !== "image/jpeg") {
    throw new HttpError(400, "PHOTO_MIME_TYPE", "WebP 또는 JPEG 사진만 업로드할 수 있습니다.");
  }

  const now = new Date();
  const uploadId = `upload_${crypto.randomUUID()}`;
  const extension = mimeType === "image/jpeg" ? "jpg" : "webp";
  const storageKey = `photos/${place.regionId}/${place.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extension}`;
  validatePhotoComplete({
    uploadId,
    placeId,
    regionCode: place.regionId,
    byteSize,
    mimeType,
    width,
    height,
    clientReencoded: true,
  });
  if (env.DB && anonymousUserId) {
    await recordPhotoRightsAcceptance(env.DB, anonymousUserId, now.toISOString());
  }
  const ticket = await issuePhotoUploadTicket(
    { uploadId, placeId, mimeType, byteSize, width, height, proximityRadiusM, proximityAccuracyBucket },
    session,
    env,
    now,
  );

  return json(
    {
      uploadId,
      method: transport.method,
      uploadUrl: transport.uploadUrl,
      storageKey,
      ticket: ticket?.signature ?? null,
      expiresAt: ticket?.expiresAt ?? null,
      clientReportedProximity: {
        evidence: photoLocationEvidence,
        radiusM: proximityRadiusM,
        accuracyBucket: proximityAccuracyBucket,
      },
      rightsPolicyVersion: PHOTO_RIGHTS_TERMS_VERSION,
      headers: {
        "content-type": mimeType,
        "x-silsigan-anon-id": session.id,
      },
    },
    {
      r2Policy: {
        maxBytes: PHOTO_MAX_BYTES,
        maxDimension: PHOTO_MAX_DIMENSION,
        originalFilenameStored: false,
        gpsExifStripped: true,
        processing: "worker-strips-metadata-before-r2-put",
      },
    },
    201,
  );
}

function assertPhotoRightsAttestation(body: JsonObject): void {
  if (body.rightsAttested !== true || body.rightsPolicyVersion !== PHOTO_RIGHTS_TERMS_VERSION) {
    throw new HttpError(
      400,
      "PHOTO_RIGHTS_ATTESTATION_REQUIRED",
      "직접 촬영했거나 게시 권한이 있는 사진인지 확인해 주세요.",
    );
  }
}

async function recordPhotoRightsAcceptance(db: D1Database, anonymousUserId: string, acceptedAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO terms_acceptances (id, actor_identity_key, terms_type, version, accepted_at, withdrawn_at)
       VALUES (?, ?, 'community', ?, ?, NULL)
       ON CONFLICT(actor_identity_key, terms_type, version) DO UPDATE SET withdrawn_at = NULL`,
    )
    .bind(
      `terms_${crypto.randomUUID()}`,
      `anonymous:${anonymousUserId}`,
      PHOTO_RIGHTS_TERMS_VERSION,
      acceptedAt,
    )
    .run();
}

type TurnstileSiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

async function assertPhotoTurnstileProof(request: Request, token: string | undefined, env: Env): Promise<boolean> {
  if (env.SILSIGAN_PHOTO_TURNSTILE_REQUIRED?.trim() !== "1") {
    return false;
  }

  if (!token) {
    throw new HttpError(403, "PHOTO_TURNSTILE_TOKEN_REQUIRED", "사진 업로드 전 보안 확인이 필요합니다.");
  }

  const siteKey = env.SILSIGAN_TURNSTILE_SITE_KEY?.trim();
  const secret = env.SILSIGAN_TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey || siteKey.length > 32 || !secret || secret.length < 20) {
    throw new HttpError(503, "PHOTO_TURNSTILE_CONFIGURATION_REQUIRED", "사진 업로드 보안 확인 장치를 사용할 수 없습니다.");
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "PHOTO_CLIENT_IP_REQUIRED", "사진 업로드 요청의 네트워크 출처를 확인할 수 없습니다.");
  }

  const expectedHostnames = configuredApiAllowedHostnames(env);
  if (expectedHostnames.size === 0) {
    throw new HttpError(503, "PHOTO_TURNSTILE_HOST_POLICY_REQUIRED", "사진 업로드 보안 확인 도메인 정책이 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), photoTurnstileTimeoutMs);
  let response: Response;
  try {
    response = await fetch(photoTurnstileSiteverifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: clientIp,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(503, "PHOTO_TURNSTILE_UNAVAILABLE", "사진 업로드 보안 확인이 지연되고 있습니다.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new HttpError(503, "PHOTO_TURNSTILE_UNAVAILABLE", "사진 업로드 보안 확인이 지연되고 있습니다.");
  }

  let result: TurnstileSiteverifyResponse;
  try {
    result = (await response.json()) as TurnstileSiteverifyResponse;
  } catch {
    throw new HttpError(503, "PHOTO_TURNSTILE_UNAVAILABLE", "사진 업로드 보안 확인 응답을 처리할 수 없습니다.");
  }

  const hostname = normalizeTurnstileHostname(result.hostname);
  if (result.success !== true || result.action !== photoTurnstileAction || !hostname || !expectedHostnames.has(hostname)) {
    throw new HttpError(403, "PHOTO_TURNSTILE_VERIFICATION_FAILED", "사진 업로드 보안 확인에 실패했습니다.");
  }

  return true;
}

function configuredApiAllowedHostnames(env: Env): Set<string> {
  const hostnames = new Set<string>();
  for (const origin of configuredApiAllowedOrigins(env)) {
    try {
      const hostname = normalizeTurnstileHostname(new URL(origin).hostname);
      if (hostname) {
        hostnames.add(hostname);
      }
    } catch {
      // Invalid origins are rejected by the existing origin policy and release gate.
    }
  }
  return hostnames;
}

function normalizeTurnstileHostname(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!normalized || normalized.length > 253 || !/^[a-z0-9.-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

type PhotoCompletionPayload = {
  uploadId: string;
  ticket?: string;
  ticketExpiresAt?: string;
  placeId: string;
  mimeType: PhotoRecord["mimeType"];
  byteSize: number;
  width: number;
  height: number;
  proximityRadiusM?: 50 | 150 | 300 | null;
  proximityAccuracyBucket?: LocationAccuracyBucket;
  clientReencoded: boolean;
  originalFilename?: string;
  imageBase64?: string;
  imageBytes?: Uint8Array;
};

type PhotoUploadTicketClaims = Pick<
  PhotoCompletionPayload,
  "uploadId" | "placeId" | "mimeType" | "byteSize" | "width" | "height" | "proximityRadiusM" | "proximityAccuracyBucket"
>;

async function completePhoto(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request, photoJsonRequestBodyMaxBytes);
  return completePhotoPayload(
    {
      uploadId: stringField(body, "uploadId", 100),
      ticket: optionalStringField(body, "ticket", 128),
      ticketExpiresAt: optionalStringField(body, "ticketExpiresAt", 40),
      placeId: stringField(body, "placeId", 80),
      mimeType: stringField(body, "mimeType", 40) as PhotoRecord["mimeType"],
      byteSize: numberField(body, "byteSize"),
      width: numberField(body, "width"),
      height: numberField(body, "height"),
      proximityRadiusM: optionalPhotoVerifiedRadiusField(body, "proximityRadiusM"),
      proximityAccuracyBucket: optionalEnumField(body, "proximityAccuracyBucket", photoLocationAccuracyBuckets) ?? "unknown",
      clientReencoded: booleanField(body, "clientReencoded"),
      originalFilename: optionalStringField(body, "originalFilename", 255),
      imageBase64: optionalStringField(body, "imageBase64", Math.ceil(PHOTO_MAX_BYTES * 1.4)),
    },
    request,
    session,
    env,
    ctx,
  );
}

async function uploadPhotoMultipart(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const requestBytes = await readBoundedRequestBytes(request, PHOTO_MAX_BYTES + photoMultipartOverheadMaxBytes, {
    code: "PHOTO_REQUEST_SIZE_LIMIT",
    message: "사진 업로드 요청이 허용 크기를 초과했습니다.",
  });
  let formData: FormData;
  try {
    formData = await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: Uint8Array.from(requestBytes),
    }).formData();
  } catch {
    throw new HttpError(400, "INVALID_MULTIPART", "사진 업로드 형식이 올바르지 않습니다.");
  }
  const file = formData.get("file");
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "multipart 요청에 file 이미지가 필요합니다.");
  }

  if (typeof file.size === "number" && file.size > PHOTO_MAX_BYTES) {
    throw new HttpError(413, "PHOTO_SIZE_LIMIT", "서버로 보내는 사진은 1MB 이하여야 합니다.");
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const byteSize = formNumberField(formData, "byteSize");
  if (imageBytes.byteLength !== byteSize) {
    throw new HttpError(400, "PHOTO_SIZE_MISMATCH", "사진 파일 크기와 메타데이터가 일치하지 않습니다.");
  }

  return completePhotoPayload(
    {
      uploadId: formStringField(formData, "uploadId", 100),
      ticket: formOptionalStringField(formData, "ticket", 128),
      ticketExpiresAt: formOptionalStringField(formData, "ticketExpiresAt", 40),
      placeId: formStringField(formData, "placeId", 80),
      mimeType: formStringField(formData, "mimeType", 40) as PhotoRecord["mimeType"],
      byteSize: imageBytes.byteLength,
      width: formNumberField(formData, "width"),
      height: formNumberField(formData, "height"),
      proximityRadiusM: formOptionalPhotoVerifiedRadiusField(formData, "proximityRadiusM"),
      proximityAccuracyBucket: formOptionalPhotoAccuracyBucketField(formData, "proximityAccuracyBucket"),
      clientReencoded: formBooleanField(formData, "clientReencoded"),
      originalFilename: formOptionalStringField(formData, "originalFilename", 255),
      imageBytes,
    },
    request,
    session,
    env,
    ctx,
  );
}

function assertPhotoRequestContentLength(request: Request): void {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return;
  }

  const contentLength = Number(raw);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    throw new HttpError(400, "PHOTO_CONTENT_LENGTH_INVALID", "사진 요청 크기 정보가 올바르지 않습니다.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const maxRequestBytes = contentType.includes("multipart/form-data")
    ? PHOTO_MAX_BYTES + photoMultipartOverheadMaxBytes
    : Math.ceil(PHOTO_MAX_BYTES * 1.4) + photoMultipartOverheadMaxBytes;
  if (contentLength > maxRequestBytes) {
    throw new HttpError(413, "PHOTO_REQUEST_SIZE_LIMIT", "사진 업로드 요청이 허용 크기를 초과했습니다.");
  }
}

function classifyApiCostRoute(request: Request, url: URL, path: string): ApiCostRouteClass {
  if (
    request.method === "OPTIONS"
    || path === "/api/admin/api-cost-guard"
    || path === "/api/admin/api-cost-guard/reconciliations"
    || path === "/api/admin/photo-cost-guard"
  ) {
    return "CONTROL";
  }

  if (request.method === "GET" || request.method === "HEAD") {
    if (
      path === "/api/config"
      || path === "/api/sources"
      || (path === "/api/places" && !url.searchParams.has("bbox") && !url.searchParams.has("radiusKm"))
      || /^\/api\/places\/[^/]+$/.test(path)
      || /^\/api\/places\/[^/]+\/status$/.test(path)
    ) {
      return "ESSENTIAL_PUBLIC";
    }
    if (
      /^\/api\/places\/[^/]+\/live$/.test(path)
      || path.startsWith("/api/rankings")
      || /^\/api\/photos\/[^/]+\/file$/.test(path)
      || path.startsWith("/api/realtime")
      || url.searchParams.has("bbox")
      || url.searchParams.has("radiusKm")
    ) {
      return "HIGH_COST_READ";
    }
    if (
      path === "/api/preferences"
      || path === "/api/my-questions"
      || path === "/api/blocks"
      || (path === "/api/reports" && url.searchParams.get("mine") === "1")
      || (path === "/api/place-requests" && url.searchParams.get("mine") === "1")
      || path.startsWith("/api/admin/")
    ) {
      return "PERSONAL_READ";
    }
    return "STANDARD_PUBLIC_READ";
  }

  if (
    path === "/api/account/deletion"
    || path === "/api/session/anonymous/rotate"
    || (path === "/api/session/anonymous" && request.method === "DELETE")
    || path === "/api/admin/users/restrict"
    || path === "/api/admin/users/unrestrict"
    || /^\/api\/admin\/moderation\/(hide|restore|delete)$/.test(path)
  ) {
    return "CRITICAL_WRITE";
  }
  if (
    path === "/api/session/anonymous"
    || path.startsWith("/api/photos/upload")
    || path === "/api/photos/complete"
    || /^\/api\/admin\/sources\/[^/]+\/ingest$/.test(path)
  ) {
    return "HIGH_COST_WRITE";
  }
  return "USER_WRITE";
}

function isApiCostGuardControlRoute(path: string): boolean {
  return path === "/api/admin/api-cost-guard" || path === "/api/admin/api-cost-guard/reconciliations";
}

function isPublicLimiterExempt(path: string): boolean {
  return isApiCostGuardControlRoute(path);
}

function minimumAdminRoleForRoute(request: Request, path: string): AdminRole | null {
  const method = request.method;

  if (
    (method === "GET" && (
      path === "/api/admin/sources/health"
      || path === "/api/admin/photo-cost-guard"
      || path === "/api/admin/beta-kpis"
    ))
    || (method === "POST" && /^\/api\/admin\/sources\/[^/]+\/(?:health|ingest)$/.test(path))
    || (method === "POST" && path === "/api/admin/places/coordinate-status")
  ) {
    return "operator";
  }

  if (
    (method === "GET" && (
      path === "/api/admin/place-requests"
      || path === "/api/admin/field-reports"
      || path === "/api/moderation/reports"
    ))
    || (method === "POST" && (
      /^\/api\/admin\/place-requests\/[^/]+\/action$/.test(path)
      || /^\/api\/admin\/field-reports\/[^/]+\/action$/.test(path)
      || /^\/api\/moderation\/reports\/[^/]+\/action$/.test(path)
      || path === "/api/admin/moderation/bulk"
      || /^\/api\/admin\/photos\/[^/]+\/moderation$/.test(path)
      || /^\/api\/admin\/moderation\/(?:hide|restore)$/.test(path)
    ))
  ) {
    return "moderator";
  }

  if (
    (method === "PATCH" && (
      path === "/api/admin/photo-cost-guard"
      || /^\/api\/admin\/sources\/[^/]+$/.test(path)
    ))
    || (method === "POST" && (
      path === "/api/admin/users/restrict"
      || path === "/api/admin/users/unrestrict"
      || path === "/api/admin/moderation/delete"
    ))
  ) {
    return "admin";
  }

  return path.startsWith("/api/admin/") ? "admin" : null;
}

function apiCostGuardRequired(env: Env): boolean {
  return env.SILSIGAN_GLOBAL_API_COST_GUARD_REQUIRED?.trim() === "1";
}

function apiCostGuardLimits(env: Env): {
  workersRequests: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  warnPercent: number;
  degradePercent: number;
  stopPercent: number;
} {
  const stopPercent = boundedGuardPercent(
    env.SILSIGAN_COST_GUARD_STOP_PERCENT,
    apiCostGuardCompiledStopPercent,
    apiCostGuardCompiledStopPercent,
  );
  const degradePercent = boundedGuardPercent(
    env.SILSIGAN_COST_GUARD_DEGRADE_PERCENT,
    apiCostGuardCompiledDegradePercent,
    stopPercent,
  );
  const warnPercent = boundedGuardPercent(
    env.SILSIGAN_COST_GUARD_WARN_PERCENT,
    apiCostGuardCompiledWarnPercent,
    degradePercent,
  );
  return {
    workersRequests: boundedFreeTierLimit(env.SILSIGAN_WORKERS_DAILY_REQUEST_LIMIT, workersDailyRequestFreeSafetyCeiling),
    d1RowsRead: boundedFreeTierLimit(env.SILSIGAN_D1_DAILY_READ_LIMIT, d1DailyReadFreeSafetyCeiling),
    d1RowsWritten: boundedFreeTierLimit(env.SILSIGAN_D1_DAILY_WRITE_LIMIT, d1DailyWriteFreeSafetyCeiling),
    warnPercent,
    degradePercent,
    stopPercent,
  };
}

function boundedGuardPercent(raw: string | undefined, defaultPercent: number, ceilingPercent: number): number {
  if (!raw?.trim()) {
    return Math.min(defaultPercent, ceilingPercent);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return Math.min(defaultPercent, ceilingPercent);
  }
  return Math.min(parsed, ceilingPercent);
}

function apiCostRouteWeight(routeClass: ApiCostRouteClass): {
  admittedRequests: number;
  workersRequests: number;
  rowsRead: number;
  rowsWritten: number;
  critical: boolean;
  highCost: boolean;
  mutation: boolean;
} {
  // These are conservative reservations, not provider-reported usage. Staging
  // D1 Insights on 2026-07-21 showed the highest public query averaging 59
  // rows read. Keep at least ~8x headroom for high-cost routes without using
  // the former 1,000/10,000 estimates that stopped staging at 3.5M reserved
  // rows while Cloudflare reported only ~87.9k actual rows for the period.
  switch (routeClass) {
    case "CONTROL":
      return { admittedRequests: 0, workersRequests: 0, rowsRead: 0, rowsWritten: 0, critical: false, highCost: false, mutation: false };
    case "AUTH_ATTEMPT":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 2, rowsWritten: 2, critical: false, highCost: false, mutation: false };
    case "WRITE_VALIDATION":
      return { admittedRequests: 0, workersRequests: 0, rowsRead: 8, rowsWritten: 0, critical: false, highCost: false, mutation: false };
    case "ESSENTIAL_PUBLIC":
    case "STANDARD_PUBLIC_READ":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 100, rowsWritten: 2, critical: false, highCost: false, mutation: false };
    case "HIGH_COST_READ":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 500, rowsWritten: 2, critical: false, highCost: true, mutation: false };
    case "PERSONAL_READ":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 200, rowsWritten: 2, critical: false, highCost: false, mutation: false };
    case "USER_WRITE":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 250, rowsWritten: 32, critical: false, highCost: false, mutation: true };
    case "HIGH_COST_WRITE":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 500, rowsWritten: 64, critical: false, highCost: true, mutation: true };
    case "CRITICAL_WRITE":
      return { admittedRequests: 1, workersRequests: 1, rowsRead: 250, rowsWritten: 32, critical: true, highCost: false, mutation: true };
  }
}

async function prepareApiCostGuardBeforeAuthentication(
  routeClass: ApiCostRouteClass,
  env: Env,
  ctx: ExecutionContext,
): Promise<ApiCostGuardDecision> {
  if (!apiCostGuardRequired(env) || routeClass === "CONTROL") {
    return { fallbackToSnapshot: false, reserveAfterAuthentication: false };
  }
  if (!env.DB) {
    if (routeClass === "ESSENTIAL_PUBLIC") {
      return { fallbackToSnapshot: true, reserveAfterAuthentication: false };
    }
    throw new HttpError(503, "API_COST_GUARD_UNAVAILABLE", "서비스 비용 보호장치를 확인할 수 없습니다.");
  }

  const control = await readApiCostGuardControl(env);
  if (control.mode !== "running") {
    if (routeClass === "ESSENTIAL_PUBLIC") {
      return { fallbackToSnapshot: true, reserveAfterAuthentication: false };
    }
    if (routeClass !== "CRITICAL_WRITE") {
      throw new HttpError(
        429,
        control.mode === "stopped" ? "API_COST_GUARD_80_PERCENT_STOP" : "API_COST_GUARD_DEGRADED",
        "서비스 안정성과 악용 방지를 위해 이 기능을 잠시 제한했습니다.",
        { mode: control.mode, reason: control.reason },
      );
    }
  }

  if (routeClass === "ESSENTIAL_PUBLIC" || routeClass === "STANDARD_PUBLIC_READ" || routeClass === "HIGH_COST_READ") {
    const reservation = await reserveApiCostGuard(routeClass, env, ctx, { control });
    return { fallbackToSnapshot: reservation.fallbackToSnapshot, reserveAfterAuthentication: false };
  }
  return { fallbackToSnapshot: false, reserveAfterAuthentication: true };
}

async function reserveApiCostGuardAfterAuthentication(
  routeClass: ApiCostRouteClass,
  env: Env,
  ctx: ExecutionContext,
  authenticationAttemptReserved = false,
): Promise<void> {
  if (!apiCostGuardRequired(env) || routeClass === "CONTROL") {
    return;
  }
  const reservation = await reserveApiCostGuard(routeClass, env, ctx, { authenticationAttemptReserved });
  if (reservation.fallbackToSnapshot) {
    throw new HttpError(429, "API_COST_GUARD_DEGRADED", "서비스 안정성과 악용 방지를 위해 이 기능을 잠시 제한했습니다.");
  }
}

async function reserveApiCostGuardAuthenticationAttempt(
  routeClass: ApiCostRouteClass,
  apiCostReserved: boolean,
  env: Env,
  ctx: ExecutionContext,
): Promise<boolean> {
  if (apiCostReserved || !apiCostGuardRequired(env) || routeClass === "CONTROL") {
    return false;
  }
  const reservation = await reserveApiCostGuard("AUTH_ATTEMPT", env, ctx, {
    criticalAdmission: routeClass === "CRITICAL_WRITE",
  });
  if (reservation.fallbackToSnapshot) {
    throw new HttpError(429, "API_COST_GUARD_DEGRADED", "서비스 안정성과 악용 방지를 위해 이 기능을 잠시 제한했습니다.");
  }
  return true;
}

async function reserveApiCostGuard(
  routeClass: ApiCostRouteClass,
  env: Env,
  ctx: ExecutionContext,
  options: ApiCostGuardReservationOptions = {},
): Promise<{ fallbackToSnapshot: boolean }> {
  const db = requireD1(env);
  const control = options.control ?? await readApiCostGuardControl(env);
  const plan = createApiCostGuardReservationPlan(db, routeClass, env, options);
  if (control.mode !== "running" && !plan.criticalAdmission) {
    return apiCostGuardBlockedReservation(routeClass, control);
  }

  let reservation: ApiCostGuardDailyRow | null;
  try {
    reservation = await plan.statement.first<ApiCostGuardDailyRow>();
  } catch {
    throw new HttpError(503, "API_COST_GUARD_UNAVAILABLE", "서비스 비용 보호 원장을 사용할 수 없습니다.");
  }

  return completeApiCostGuardReservation(routeClass, reservation, plan, env, ctx);
}

function createApiCostGuardReservationPlan(
  db: D1Database,
  routeClass: ApiCostRouteClass,
  env: Env,
  options: ApiCostGuardReservationOptions = {},
): ApiCostGuardReservationPlan {
  const baseWeight = apiCostRouteWeight(routeClass);
  const authenticationWeight = apiCostRouteWeight("AUTH_ATTEMPT");
  const weight = options.authenticationAttemptReserved
    ? {
        ...baseWeight,
        admittedRequests: 0,
        workersRequests: Math.max(0, baseWeight.workersRequests - authenticationWeight.workersRequests),
        rowsRead: Math.max(0, baseWeight.rowsRead - authenticationWeight.rowsRead),
        rowsWritten: Math.max(0, baseWeight.rowsWritten - authenticationWeight.rowsWritten),
      }
    : baseWeight;
  const criticalAdmission = options.criticalAdmission ?? weight.critical;
  const limits = apiCostGuardLimits(env);
  const admissionPercent = criticalAdmission ? limits.stopPercent : limits.degradePercent;
  const workerThreshold = Math.floor((limits.workersRequests * admissionPercent) / 100);
  const readThreshold = Math.floor((limits.d1RowsRead * admissionPercent) / 100);
  const writeThreshold = Math.floor((limits.d1RowsWritten * admissionPercent) / 100);
  const dayUtc = utcDayKey(new Date());
  const updatedAt = new Date().toISOString();
  const runningControlPredicate = criticalAdmission
    ? "1 = 1"
    : "EXISTS (SELECT 1 FROM api_cost_guard_control WHERE id = 1 AND mode = 'running')";
  const statement = db
    .prepare(
       `INSERT INTO api_cost_guard_daily (
           day_utc, admitted_requests, reserved_workers_requests, reserved_rows_read, reserved_rows_written,
           critical_requests, critical_rows_read, critical_rows_written, high_cost_requests, mutation_requests,
           observed_workers_requests, observed_rows_read, observed_rows_written, updated_at
         )
         SELECT ?, ${weight.admittedRequests}, ${weight.workersRequests}, ${weight.rowsRead}, ${weight.rowsWritten},
           ${weight.critical ? 1 : 0}, ${weight.critical ? weight.rowsRead : 0}, ${weight.critical ? weight.rowsWritten : 0},
           ${weight.highCost ? 1 : 0}, ${weight.mutation ? 1 : 0}, 0, 0, 0, ?
         WHERE ${runningControlPredicate}
         ON CONFLICT(day_utc) DO UPDATE SET
           admitted_requests = api_cost_guard_daily.admitted_requests + ${weight.admittedRequests},
           reserved_workers_requests = api_cost_guard_daily.reserved_workers_requests + ${weight.workersRequests},
           reserved_rows_read = api_cost_guard_daily.reserved_rows_read + ${weight.rowsRead},
           reserved_rows_written = api_cost_guard_daily.reserved_rows_written + ${weight.rowsWritten},
           critical_requests = api_cost_guard_daily.critical_requests + ${weight.critical ? 1 : 0},
           critical_rows_read = api_cost_guard_daily.critical_rows_read + ${weight.critical ? weight.rowsRead : 0},
           critical_rows_written = api_cost_guard_daily.critical_rows_written + ${weight.critical ? weight.rowsWritten : 0},
           high_cost_requests = api_cost_guard_daily.high_cost_requests + ${weight.highCost ? 1 : 0},
           mutation_requests = api_cost_guard_daily.mutation_requests + ${weight.mutation ? 1 : 0},
           updated_at = excluded.updated_at
         WHERE MAX(api_cost_guard_daily.reserved_workers_requests, api_cost_guard_daily.observed_workers_requests)
                 + ${weight.workersRequests} <= ${workerThreshold}
           AND MAX(api_cost_guard_daily.reserved_rows_read, api_cost_guard_daily.observed_rows_read)
                 + ${weight.rowsRead} <= ${readThreshold}
           AND MAX(api_cost_guard_daily.reserved_rows_written, api_cost_guard_daily.observed_rows_written)
                 + ${weight.rowsWritten} <= ${writeThreshold}
           AND ${runningControlPredicate}
         RETURNING
           day_utc AS dayUtc,
           admitted_requests AS admittedRequests,
           reserved_workers_requests AS reservedWorkersRequests,
           reserved_rows_read AS reservedRowsRead,
           reserved_rows_written AS reservedRowsWritten,
           critical_requests AS criticalRequests,
           critical_rows_read AS criticalRowsRead,
           critical_rows_written AS criticalRowsWritten,
           high_cost_requests AS highCostRequests,
           mutation_requests AS mutationRequests,
           observed_workers_requests AS observedWorkersRequests,
           observed_rows_read AS observedRowsRead,
           observed_rows_written AS observedRowsWritten,
           updated_at AS updatedAt`,
    )
    .bind(dayUtc, updatedAt);

  return { statement, limits, admissionPercent, criticalAdmission, dayUtc };
}

async function completeApiCostGuardReservation(
  routeClass: ApiCostRouteClass,
  reservation: ApiCostGuardDailyRow | null,
  plan: ApiCostGuardReservationPlan,
  env: Env,
  ctx: ExecutionContext,
): Promise<{ fallbackToSnapshot: boolean }> {
  const db = requireD1(env);
  if (!reservation) {
    const current = await readApiCostGuardDaily(db, plan.dayUtc);
    await claimAndEnqueueApiCostGuardWarning(db, current, plan.limits, env, ctx);
    const metric = apiCostGuardDominantMetric(current, plan.limits);
    const mode: ApiCostGuardMode = plan.criticalAdmission ? "stopped" : "degraded";
    await transitionApiCostGuardMode(
      mode,
      `automatic-${plan.admissionPercent}-percent-${metric}`,
      metric,
      env,
      ctx,
    );
    if (routeClass === "ESSENTIAL_PUBLIC") {
      return { fallbackToSnapshot: true };
    }
    throw new HttpError(
      plan.criticalAdmission ? 503 : 429,
      plan.criticalAdmission ? "API_COST_GUARD_80_PERCENT_STOP" : "API_COST_GUARD_DEGRADED",
      "서비스 안정성과 악용 방지를 위해 이 기능을 잠시 제한했습니다.",
      { mode, metric, admissionPercent: plan.admissionPercent },
    );
  }

  await claimAndEnqueueApiCostGuardWarning(db, reservation, plan.limits, env, ctx);
  const metric = apiCostGuardThresholdMetric(reservation, plan.limits, plan.admissionPercent);
  if (metric) {
    await transitionApiCostGuardMode(
      plan.criticalAdmission ? "stopped" : "degraded",
      `automatic-${plan.admissionPercent}-percent-${metric}`,
      metric,
      env,
      ctx,
    );
  }
  return { fallbackToSnapshot: false };
}

async function claimAndEnqueueApiCostGuardWarning(
  db: D1Database,
  row: ApiCostGuardDailyRow | null,
  limits: ReturnType<typeof apiCostGuardLimits>,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  if (!row || !env.COST_ALERT_WEBHOOK_URL?.trim()) return;
  const metric = apiCostGuardThresholdMetric(row, limits, limits.warnPercent);
  if (!metric) return;

  let claimed: { warnedPercent: number } | null;
  try {
    claimed = await db
      .prepare(
        `UPDATE api_cost_guard_daily
         SET warned_percent = ?, warned_metric = ?
         WHERE day_utc = ? AND warned_percent < ?
           AND EXISTS (
             SELECT 1 FROM api_cost_guard_control WHERE id = 1 AND mode = 'running'
           )
         RETURNING warned_percent AS warnedPercent`,
      )
      .bind(limits.warnPercent, metric, row.dayUtc, limits.warnPercent)
      .first<{ warnedPercent: number }>();
  } catch {
    throw new HttpError(503, "API_COST_GUARD_UNAVAILABLE", "서비스 비용 경고 상태를 안전하게 저장할 수 없습니다.");
  }
  if (!claimed) return;

  const control = await readApiCostGuardControlFromD1(db);
  enqueueApiCostGuardWarning(ctx, env, control, metric, claimed.warnedPercent);
}

function apiCostGuardBlockedReservation(
  routeClass: ApiCostRouteClass,
  control: ApiCostGuardControlRow,
): { fallbackToSnapshot: boolean } {
  if (routeClass === "ESSENTIAL_PUBLIC") {
    return { fallbackToSnapshot: true };
  }
  throw new HttpError(
    429,
    control.mode === "stopped" ? "API_COST_GUARD_80_PERCENT_STOP" : "API_COST_GUARD_DEGRADED",
    "서비스 안정성과 악용 방지를 위해 이 기능을 잠시 제한했습니다.",
    { mode: control.mode, reason: control.reason },
  );
}

async function readApiCostGuardControl(env: Env): Promise<ApiCostGuardControlRow> {
  if (env.COST_GUARD_STATE) {
    try {
      const raw = await env.COST_GUARD_STATE.get(apiCostGuardStateKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isApiCostGuardControlRow(parsed) && parsed.mode !== "running") {
          return parsed;
        }
      }
    } catch {
      // D1 remains authoritative when the optional dedicated KV mirror is unavailable.
    }
  }
  return readApiCostGuardControlFromD1(requireD1(env));
}

function isApiCostGuardControlRow(value: unknown): value is ApiCostGuardControlRow {
  if (!isRecord(value)) return false;
  return (value.mode === "running" || value.mode === "degraded" || value.mode === "stopped")
    && typeof value.reason === "string"
    && Number.isSafeInteger(value.generation)
    && (value.automaticMetric === null
      || value.automaticMetric === "workers_requests"
      || value.automaticMetric === "d1_rows_read"
      || value.automaticMetric === "d1_rows_written"
      || value.automaticMetric === "manual")
    && typeof value.updatedBy === "string"
    && typeof value.updatedAt === "string";
}

async function readApiCostGuardDaily(db: D1Database, dayUtc: string): Promise<ApiCostGuardDailyRow | null> {
  return db
    .prepare(
      `SELECT day_utc AS dayUtc, admitted_requests AS admittedRequests,
              reserved_workers_requests AS reservedWorkersRequests, reserved_rows_read AS reservedRowsRead,
              reserved_rows_written AS reservedRowsWritten, critical_requests AS criticalRequests,
              critical_rows_read AS criticalRowsRead, critical_rows_written AS criticalRowsWritten,
              high_cost_requests AS highCostRequests, mutation_requests AS mutationRequests,
              observed_workers_requests AS observedWorkersRequests, observed_rows_read AS observedRowsRead,
              observed_rows_written AS observedRowsWritten, updated_at AS updatedAt
       FROM api_cost_guard_daily WHERE day_utc = ?`,
    )
    .bind(dayUtc)
    .first<ApiCostGuardDailyRow>();
}

function apiCostGuardThresholdMetric(
  row: ApiCostGuardDailyRow,
  limits: ReturnType<typeof apiCostGuardLimits>,
  percent: number,
): Exclude<ApiCostGuardMetric, "manual"> | null {
  if (Math.max(row.reservedWorkersRequests, row.observedWorkersRequests) >= Math.floor((limits.workersRequests * percent) / 100)) {
    return "workers_requests";
  }
  if (Math.max(row.reservedRowsRead, row.observedRowsRead) >= Math.floor((limits.d1RowsRead * percent) / 100)) {
    return "d1_rows_read";
  }
  if (Math.max(row.reservedRowsWritten, row.observedRowsWritten) >= Math.floor((limits.d1RowsWritten * percent) / 100)) {
    return "d1_rows_written";
  }
  return null;
}

function apiCostGuardDominantMetric(
  row: ApiCostGuardDailyRow | null,
  limits: ReturnType<typeof apiCostGuardLimits>,
): Exclude<ApiCostGuardMetric, "manual"> {
  const workerPercent = percentageOf(Math.max(row?.reservedWorkersRequests ?? 0, row?.observedWorkersRequests ?? 0), limits.workersRequests);
  const readPercent = percentageOf(Math.max(row?.reservedRowsRead ?? 0, row?.observedRowsRead ?? 0), limits.d1RowsRead);
  const writePercent = percentageOf(Math.max(row?.reservedRowsWritten ?? 0, row?.observedRowsWritten ?? 0), limits.d1RowsWritten);
  if (workerPercent >= readPercent && workerPercent >= writePercent) return "workers_requests";
  return readPercent >= writePercent ? "d1_rows_read" : "d1_rows_written";
}

function publicReadAnonymousSession(): AnonymousSession {
  return { id: "anon_public_read_only", isNew: false, verified: false };
}

function apiCostGuardSnapshotEnv(env: Env): Env {
  return {
    ...env,
    DB: undefined,
    PHOTOS: undefined,
    IMAGES: undefined,
    PLACE_ROOM: undefined,
    REGION_ROOM: undefined,
    GLOBAL_ROOM: undefined,
  };
}

async function transitionApiCostGuardMode(
  mode: Exclude<ApiCostGuardMode, "running">,
  reason: string,
  metric: Exclude<ApiCostGuardMetric, "manual">,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = requireD1(env);
  const current = await readApiCostGuardControlFromD1(db);
  const rank: Record<ApiCostGuardMode, number> = { running: 0, degraded: 1, stopped: 2 };
  if (rank[current.mode] >= rank[mode]) {
    return;
  }
  const updatedAt = new Date().toISOString();
  const nextGeneration = current.generation + 1;
  await runAtomicD1Batch(db, [
    db.prepare(
      `UPDATE api_cost_guard_control
       SET mode = ?, reason = ?, generation = ?, automatic_metric = ?, updated_by = 'system:api-cost-guard', updated_at = ?
       WHERE id = 1 AND generation = ? AND mode = ?`,
    ).bind(mode, reason, nextGeneration, metric, updatedAt, current.generation, current.mode),
    db.prepare(
      `INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at)
       SELECT ?, 'system:api-cost-guard', 'api_cost_guard', 'api_cost_guard', 'global', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM api_cost_guard_control WHERE id = 1 AND generation = ? AND updated_at = ?
       )`,
    ).bind(`admin_${crypto.randomUUID()}`, `${mode}:${reason}`, updatedAt, nextGeneration, updatedAt),
  ], "API_COST_GUARD_UNAVAILABLE", "서비스 비용 보호 상태를 안전하게 변경할 수 없습니다.");

  const updated = await readApiCostGuardControlFromD1(db);
  if (updated.generation !== nextGeneration || updated.mode !== mode || updated.updatedAt !== updatedAt) {
    return;
  }
  await mirrorApiCostGuardControl(updated, env, false);
  enqueueApiCostGuardAlert(ctx, env, updated);
}

async function readApiCostGuardControlFromD1(db: D1Database): Promise<ApiCostGuardControlRow> {
  try {
    const row = await db
      .prepare(
        `SELECT mode, reason, generation, automatic_metric AS automaticMetric,
                updated_by AS updatedBy, updated_at AS updatedAt
         FROM api_cost_guard_control WHERE id = 1`,
      )
      .first<ApiCostGuardControlRow>();
    if (!row || !isApiCostGuardControlRow(row)) {
      throw new Error("API_COST_GUARD_CONTROL_INVALID");
    }
    return row;
  } catch {
    throw new HttpError(503, "API_COST_GUARD_UNAVAILABLE", "서비스 비용 보호 상태를 확인할 수 없습니다.");
  }
}

async function mirrorApiCostGuardControl(control: ApiCostGuardControlRow, env: Env, required: boolean): Promise<void> {
  if (!env.COST_GUARD_STATE) {
    if (required) {
      throw new HttpError(503, "API_COST_GUARD_STATE_MIRROR_UNAVAILABLE", "비용 보호 제어 저장소를 사용할 수 없습니다.");
    }
    return;
  }
  try {
    await env.COST_GUARD_STATE.put(apiCostGuardStateKey, JSON.stringify(control));
  } catch {
    if (required) {
      throw new HttpError(503, "API_COST_GUARD_STATE_MIRROR_UNAVAILABLE", "비용 보호 제어 저장소를 사용할 수 없습니다.");
    }
  }
}

async function getApiCostGuard(env: Env): Promise<Response> {
  const db = requireD1(env);
  const control = await readApiCostGuardControlFromD1(db);
  const dayUtc = utcDayKey(new Date());
  const daily = await readApiCostGuardDaily(db, dayUtc);
  const latestReconciliation = await db
    .prepare(
      `SELECT id, day_utc AS dayUtc, observed_workers_requests AS observedWorkersRequests,
              observed_d1_rows_read AS observedD1RowsRead, observed_d1_rows_written AS observedD1RowsWritten,
              observed_at AS observedAt, source, note, created_at AS createdAt
       FROM api_cost_guard_reconciliations
       WHERE day_utc = ? ORDER BY observed_at DESC LIMIT 1`,
    )
    .bind(dayUtc)
    .first<{
      id: string;
      dayUtc: string;
      observedWorkersRequests: number;
      observedD1RowsRead: number;
      observedD1RowsWritten: number;
      observedAt: string;
      source: string;
      note: string;
      createdAt: string;
    }>();
  const limits = apiCostGuardLimits(env);
  const usage = {
    workersRequests: Math.max(daily?.reservedWorkersRequests ?? 0, daily?.observedWorkersRequests ?? 0),
    d1RowsRead: Math.max(daily?.reservedRowsRead ?? 0, daily?.observedRowsRead ?? 0),
    d1RowsWritten: Math.max(daily?.reservedRowsWritten ?? 0, daily?.observedRowsWritten ?? 0),
  };
  return json(
    {
      control,
      dayUtc,
      usage,
      reserved: {
        workersRequests: daily?.reservedWorkersRequests ?? 0,
        d1RowsRead: daily?.reservedRowsRead ?? 0,
        d1RowsWritten: daily?.reservedRowsWritten ?? 0,
        criticalRequests: daily?.criticalRequests ?? 0,
        criticalRowsRead: daily?.criticalRowsRead ?? 0,
        criticalRowsWritten: daily?.criticalRowsWritten ?? 0,
        admittedRequests: daily?.admittedRequests ?? 0,
        highCostRequests: daily?.highCostRequests ?? 0,
        mutationRequests: daily?.mutationRequests ?? 0,
      },
      limits,
      meters: {
        workersPercent: percentageOf(usage.workersRequests, limits.workersRequests),
        d1ReadPercent: percentageOf(usage.d1RowsRead, limits.d1RowsRead),
        d1WritePercent: percentageOf(usage.d1RowsWritten, limits.d1RowsWritten),
      },
      latestReconciliation,
      reconciliationFresh: latestReconciliation
        ? Date.now() - Date.parse(latestReconciliation.observedAt) <= apiCostGuardReconciliationFreshnessMs
        : false,
    },
    {
      policy: "60 percent warning, 70 percent degradation, 80 percent stop; observed Cloudflare usage overrides lower app estimates",
      essentialFallback: "nationwide read-only snapshot",
      workerLimitBoundary: "requests are counted before Worker code, so dashboard/WAF reconciliation remains required",
    },
  );
}

async function updateApiCostGuard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  assertExactFields(body, ["mode", "reason", "expectedGeneration"]);
  const mode = enumField(body, "mode", ["running", "degraded", "stopped"] as const);
  const reason = stringField(body, "reason", 300);
  if (reason.length < 5) {
    throw new HttpError(400, "API_COST_GUARD_REASON_REQUIRED", "비용 보호 상태 변경 사유를 5자 이상 입력해 주세요.");
  }
  const expectedGeneration = integerField(body, "expectedGeneration", 1, Number.MAX_SAFE_INTEGER, 1);
  const current = await readApiCostGuardControlFromD1(db);
  if (current.generation !== expectedGeneration) {
    throw new HttpError(409, "API_COST_GUARD_GENERATION_CONFLICT", "비용 보호 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.");
  }
  const requiresResumeSafety = mode === "running" && current.mode !== "running";
  if (requiresResumeSafety) {
    await assertApiCostGuardResumeSafe(db, env);
  }

  const updatedAt = new Date().toISOString();
  const next: ApiCostGuardControlRow = {
    mode,
    reason,
    generation: current.generation + 1,
    automaticMetric: "manual",
    updatedBy: adminSubject(request),
    updatedAt,
  };
  if (mode !== "running") {
    await mirrorApiCostGuardControl(next, env, false);
  }
  const controlUpdate = requiresResumeSafety
    ? apiCostGuardSafeResumeStatement(db, env, next, expectedGeneration)
    : db.prepare(
        `UPDATE api_cost_guard_control
         SET mode = ?, reason = ?, generation = ?, automatic_metric = 'manual', updated_by = ?, updated_at = ?
         WHERE id = 1 AND generation = ?`,
      ).bind(next.mode, next.reason, next.generation, next.updatedBy, next.updatedAt, expectedGeneration);
  await runAtomicD1Batch(db, [
    controlUpdate,
    db.prepare(
      `INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at)
       SELECT ?, ?, 'api_cost_guard', 'api_cost_guard', 'global', ?, ?
       WHERE EXISTS (SELECT 1 FROM api_cost_guard_control WHERE id = 1 AND generation = ? AND updated_at = ?)`,
    ).bind(`admin_${crypto.randomUUID()}`, next.updatedBy, `${mode}:${reason}`, updatedAt, next.generation, updatedAt),
  ], "API_COST_GUARD_UPDATE_UNAVAILABLE", "비용 보호 상태와 감사 기록을 함께 저장할 수 없습니다.");
  const stored = await readApiCostGuardControlFromD1(db);
  if (stored.generation !== next.generation || stored.updatedAt !== updatedAt) {
    if (requiresResumeSafety) {
      await assertApiCostGuardResumeSafe(db, env);
    }
    throw new HttpError(409, "API_COST_GUARD_GENERATION_CONFLICT", "비용 보호 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.");
  }
  await mirrorApiCostGuardControl(stored, env, mode === "running" && Boolean(env.COST_GUARD_STATE));
  if (mode !== "running") {
    enqueueApiCostGuardAlert(ctx, env, stored);
  }
  return getApiCostGuard(env);
}

function apiCostGuardSafeResumeStatement(
  db: D1Database,
  env: Env,
  next: ApiCostGuardControlRow,
  expectedGeneration: number,
): D1PreparedStatement {
  const now = new Date();
  const dayUtc = utcDayKey(now);
  const freshAfter = new Date(now.getTime() - apiCostGuardReconciliationFreshnessMs).toISOString();
  const limits = apiCostGuardLimits(env);
  const workerThreshold = Math.floor((limits.workersRequests * limits.degradePercent) / 100);
  const readThreshold = Math.floor((limits.d1RowsRead * limits.degradePercent) / 100);
  const writeThreshold = Math.floor((limits.d1RowsWritten * limits.degradePercent) / 100);

  return db.prepare(
    `UPDATE api_cost_guard_control
     SET mode = ?, reason = ?, generation = ?, automatic_metric = 'manual', updated_by = ?, updated_at = ?
     WHERE id = 1 AND generation = ?
       AND EXISTS (
         SELECT 1 FROM api_cost_guard_reconciliations
         WHERE day_utc = ? AND observed_at >= ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM api_cost_guard_daily
         WHERE day_utc = ? AND (
           MAX(reserved_workers_requests, observed_workers_requests) >= ?
           OR MAX(reserved_rows_read, observed_rows_read) >= ?
           OR MAX(reserved_rows_written, observed_rows_written) >= ?
         )
       )`,
  ).bind(
    next.mode,
    next.reason,
    next.generation,
    next.updatedBy,
    next.updatedAt,
    expectedGeneration,
    dayUtc,
    freshAfter,
    dayUtc,
    workerThreshold,
    readThreshold,
    writeThreshold,
  );
}

async function assertApiCostGuardResumeSafe(db: D1Database, env: Env): Promise<void> {
  const dayUtc = utcDayKey(new Date());
  const latest = await db
    .prepare(
      `SELECT observed_at AS observedAt
       FROM api_cost_guard_reconciliations WHERE day_utc = ? ORDER BY observed_at DESC LIMIT 1`,
    )
    .bind(dayUtc)
    .first<{ observedAt: string }>();
  if (!latest || !Number.isFinite(Date.parse(latest.observedAt))
    || Date.now() - Date.parse(latest.observedAt) > apiCostGuardReconciliationFreshnessMs) {
    throw new HttpError(
      409,
      "API_COST_GUARD_RECONCILIATION_REQUIRED",
      "재개하려면 15분 이내의 Cloudflare 사용량 대조가 필요합니다.",
    );
  }
  const daily = await readApiCostGuardDaily(db, dayUtc);
  const limits = apiCostGuardLimits(env);
  const unsafeMetric = apiCostGuardThresholdMetric(daily ?? emptyApiCostGuardDaily(dayUtc), limits, limits.degradePercent);
  if (unsafeMetric) {
    throw new HttpError(
      409,
      "API_COST_GUARD_RECONCILIATION_FAILED",
      "70% 안전 기준 이상인 사용량이 남아 있어 서비스를 재개할 수 없습니다.",
      { unsafeMetric },
    );
  }
}

function emptyApiCostGuardDaily(dayUtc: string): ApiCostGuardDailyRow {
  return {
    dayUtc,
    admittedRequests: 0,
    reservedWorkersRequests: 0,
    reservedRowsRead: 0,
    reservedRowsWritten: 0,
    criticalRequests: 0,
    criticalRowsRead: 0,
    criticalRowsWritten: 0,
    highCostRequests: 0,
    mutationRequests: 0,
    observedWorkersRequests: 0,
    observedRowsRead: 0,
    observedRowsWritten: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function recordApiCostGuardReconciliation(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  assertExactFields(body, [
    "observedWorkersRequests",
    "observedD1RowsRead",
    "observedD1RowsWritten",
    "observedAt",
    "source",
    "note",
    "rebaseReservedEstimates",
    "expectedGeneration",
  ]);
  const observedWorkersRequests = integerField(body, "observedWorkersRequests", 0, workersDailyRequestFreeSafetyCeiling * 10, 0);
  const observedD1RowsRead = integerField(body, "observedD1RowsRead", 0, d1DailyReadFreeSafetyCeiling * 10, 0);
  const observedD1RowsWritten = integerField(body, "observedD1RowsWritten", 0, d1DailyWriteFreeSafetyCeiling * 10, 0);
  const observedAt = stringField(body, "observedAt", 40);
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs) || observedAtMs > Date.now() + 60_000 || observedAtMs < Date.now() - oneDayMs) {
    throw new HttpError(400, "API_COST_GUARD_OBSERVED_AT_INVALID", "관측 시각이 올바르지 않습니다.");
  }
  const normalizedObservedAt = new Date(observedAtMs).toISOString();
  const source = enumField(body, "source", ["cloudflare-dashboard", "graphql-api"] as const);
  const note = stringField(body, "note", 300);
  if (note.length < 5) {
    throw new HttpError(400, "API_COST_GUARD_NOTE_REQUIRED", "사용량 대조 메모를 5자 이상 입력해 주세요.");
  }
  const rebaseReservedEstimates = body.rebaseReservedEstimates === undefined
    ? false
    : booleanField(body, "rebaseReservedEstimates");
  const expectedGeneration = body.expectedGeneration === undefined
    ? null
    : integerField(body, "expectedGeneration", 1, Number.MAX_SAFE_INTEGER, 1);
  const dayUtc = normalizedObservedAt.slice(0, 10);
  const createdAt = new Date().toISOString();
  let reservationBefore: ApiCostGuardDailyRow | null = null;
  if (rebaseReservedEstimates) {
    if (expectedGeneration === null) {
      throw new HttpError(
        400,
        "API_COST_GUARD_REBASE_GENERATION_REQUIRED",
        "예약 원장 재기준화에는 최신 비용 보호 세대번호가 필요합니다.",
      );
    }
    if (dayUtc !== utcDayKey(new Date()) || Date.now() - observedAtMs > apiCostGuardReconciliationFreshnessMs) {
      throw new HttpError(
        400,
        "API_COST_GUARD_REBASE_OBSERVATION_STALE",
        "예약 원장 재기준화에는 15분 이내의 당일 Cloudflare 관측값이 필요합니다.",
      );
    }
    const control = await readApiCostGuardControlFromD1(db);
    if (control.generation !== expectedGeneration) {
      throw new HttpError(
        409,
        "API_COST_GUARD_GENERATION_CONFLICT",
        "비용 보호 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.",
      );
    }
    if (control.mode === "running") {
      throw new HttpError(
        409,
        "API_COST_GUARD_REBASE_NOT_ALLOWED",
        "예약 원장은 비용 보호가 중단 또는 축소된 동안에만 재기준화할 수 있습니다.",
      );
    }
    reservationBefore = await readApiCostGuardDaily(db, dayUtc);
  }

  const adminSubjectValue = adminSubject(request);
  const reconciliationId = `api_cost_reconcile_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO api_cost_guard_reconciliations (
         id, day_utc, observed_workers_requests, observed_d1_rows_read, observed_d1_rows_written,
         observed_at, source, admin_subject, note, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      reconciliationId,
      dayUtc,
      observedWorkersRequests,
      observedD1RowsRead,
      observedD1RowsWritten,
      normalizedObservedAt,
      source,
      adminSubjectValue,
      note,
      createdAt,
    ),
    db.prepare(
      `INSERT INTO api_cost_guard_daily (
         day_utc, observed_workers_requests, observed_rows_read, observed_rows_written, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day_utc) DO UPDATE SET
         observed_workers_requests = MAX(api_cost_guard_daily.observed_workers_requests, excluded.observed_workers_requests),
         observed_rows_read = MAX(api_cost_guard_daily.observed_rows_read, excluded.observed_rows_read),
         observed_rows_written = MAX(api_cost_guard_daily.observed_rows_written, excluded.observed_rows_written),
         updated_at = excluded.updated_at`,
    ).bind(dayUtc, observedWorkersRequests, observedD1RowsRead, observedD1RowsWritten, createdAt),
  ];
  let rebaseAuditId: string | null = null;
  if (rebaseReservedEstimates && expectedGeneration !== null) {
    rebaseAuditId = `admin_${crypto.randomUUID()}`;
    const rebaseReason = [
      "rebase_reserved_estimates=1",
      `reserved_workers_before=${reservationBefore?.reservedWorkersRequests ?? 0}`,
      `reserved_rows_read_before=${reservationBefore?.reservedRowsRead ?? 0}`,
      `reserved_rows_written_before=${reservationBefore?.reservedRowsWritten ?? 0}`,
      `source=${source}`,
    ].join(";");
    statements.push(
      db.prepare(
        `UPDATE api_cost_guard_daily
         SET reserved_workers_requests = observed_workers_requests,
             reserved_rows_read = observed_rows_read,
             reserved_rows_written = observed_rows_written,
             updated_at = ?
         WHERE day_utc = ?
           AND EXISTS (
             SELECT 1 FROM api_cost_guard_control
             WHERE id = 1 AND generation = ? AND mode <> 'running'
           )`,
      ).bind(createdAt, dayUtc, expectedGeneration),
      db.prepare(
        `INSERT INTO admin_actions (
           id, admin_subject, action_type, target_type, target_id, reason, created_at
         )
         SELECT ?, ?, 'api_cost_guard_reconciliation', 'api_cost_guard', 'global', ?, ?
         WHERE EXISTS (
           SELECT 1 FROM api_cost_guard_control
           WHERE id = 1 AND generation = ? AND mode <> 'running'
         )`,
      ).bind(rebaseAuditId, adminSubjectValue, rebaseReason, createdAt, expectedGeneration),
    );
  }
  await runAtomicD1Batch(
    db,
    statements,
    "API_COST_GUARD_RECONCILIATION_UNAVAILABLE",
    "Cloudflare 사용량 대조를 안전하게 저장할 수 없습니다.",
  );
  if (rebaseAuditId) {
    const audit = await db.prepare("SELECT id FROM admin_actions WHERE id = ?").bind(rebaseAuditId).first<{ id: string }>();
    if (!audit) {
      throw new HttpError(
        409,
        "API_COST_GUARD_GENERATION_CONFLICT",
        "비용 보호 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.",
      );
    }
  }

  if (dayUtc === utcDayKey(new Date())) {
    const row = await readApiCostGuardDaily(db, dayUtc);
    const limits = apiCostGuardLimits(env);
    await claimAndEnqueueApiCostGuardWarning(db, row, limits, env, ctx);
    const stopMetric = apiCostGuardThresholdMetric(row ?? emptyApiCostGuardDaily(dayUtc), limits, limits.stopPercent);
    const degradeMetric = apiCostGuardThresholdMetric(row ?? emptyApiCostGuardDaily(dayUtc), limits, limits.degradePercent);
    if (stopMetric) {
      await transitionApiCostGuardMode("stopped", `reconciled-${limits.stopPercent}-percent-${stopMetric}`, stopMetric, env, ctx);
    } else if (degradeMetric) {
      await transitionApiCostGuardMode("degraded", `reconciled-${limits.degradePercent}-percent-${degradeMetric}`, degradeMetric, env, ctx);
    }
  }
  return getApiCostGuard(env);
}

function enqueueApiCostGuardAlert(ctx: ExecutionContext, env: Env, control: ApiCostGuardControlRow): "webhook" | "none" {
  const limits = apiCostGuardLimits(env);
  const thresholdPercent = control.automaticMetric === "manual"
    ? null
    : control.mode === "stopped"
      ? limits.stopPercent
      : control.mode === "degraded"
        ? limits.degradePercent
        : null;
  return enqueueApiCostGuardWebhook(ctx, env, {
    type: "cost.api-guard.changed",
    mode: control.mode,
    reason: control.reason,
    metric: control.automaticMetric,
    thresholdPercent,
    generation: control.generation,
    environment: env.ENVIRONMENT ?? "development",
    guardPath: "/api/admin/api-cost-guard",
    createdAt: control.updatedAt,
  });
}

function enqueueApiCostGuardWarning(
  ctx: ExecutionContext,
  env: Env,
  control: ApiCostGuardControlRow,
  metric: Exclude<ApiCostGuardMetric, "manual">,
  thresholdPercent: number,
): "webhook" | "none" {
  return enqueueApiCostGuardWebhook(ctx, env, {
    type: "cost.api-guard.warning",
    mode: control.mode,
    reason: `automatic-${thresholdPercent}-percent-${metric}`,
    metric,
    thresholdPercent,
    generation: control.generation,
    environment: env.ENVIRONMENT ?? "development",
    guardPath: "/api/admin/api-cost-guard",
    createdAt: new Date().toISOString(),
  });
}

function enqueueApiCostGuardWebhook(
  ctx: ExecutionContext,
  env: Env,
  payload: ApiCostGuardAlertPayload,
): "webhook" | "none" {
  if (!env.COST_ALERT_WEBHOOK_URL?.trim()) {
    return "none";
  }
  ctx.waitUntil(sendApiCostGuardAlert(env, payload).catch(() => undefined));
  return "webhook";
}

async function sendApiCostGuardAlert(env: Env, payload: ApiCostGuardAlertPayload): Promise<void> {
  const rawUrl = env.COST_ALERT_WEBHOOK_URL?.trim();
  if (!rawUrl) return;
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new HttpError(503, "COST_ALERT_WEBHOOK_INVALID", "비용 보호 알림 webhook은 HTTPS만 허용합니다.");
  }
  const headers = new Headers({ "content-type": "application/json" });
  const token = env.COST_ALERT_WEBHOOK_TOKEN?.trim();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new HttpError(502, "COST_ALERT_WEBHOOK_FAILED", "비용 보호 알림 webhook 전송에 실패했습니다.");
  }
}

async function enforceCloudflarePublicApiRateLimit(request: Request, env: Env): Promise<void> {
  const required = env.SILSIGAN_PUBLIC_RATE_LIMIT_REQUIRED?.trim() === "1";
  if (!env.PUBLIC_API_RATE_LIMITER) {
    if (required) {
      throw new HttpError(503, "PUBLIC_API_RATE_LIMITER_UNAVAILABLE", "공개 API 공격 방지 장치를 사용할 수 없습니다.");
    }
    return;
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "PUBLIC_API_CLIENT_IP_REQUIRED", "공개 API 요청의 네트워크 출처를 확인할 수 없습니다.");
  }

  let result: { success: boolean };
  try {
    result = await env.PUBLIC_API_RATE_LIMITER.limit({ key: await sha256Hex(`public-api:${clientIp}`) });
  } catch {
    throw new HttpError(503, "PUBLIC_API_RATE_LIMITER_UNAVAILABLE", "공개 API 공격 방지 장치를 사용할 수 없습니다.");
  }

  if (!result.success) {
    throw new HttpError(429, "PUBLIC_API_RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function enforceCloudflareAdminApiRateLimit(request: Request, env: Env): Promise<void> {
  await enforceCloudflareCostGuardRateLimit(
    "admin-api",
    request,
    env,
    env.ADMIN_API_RATE_LIMITER,
    "ADMIN_API_RATE_LIMITER_UNAVAILABLE",
    "ADMIN_API_RATE_LIMITED",
  );
}

async function enforceCloudflareHighCostApiRateLimit(request: Request, env: Env): Promise<void> {
  await enforceCloudflareCostGuardRateLimit(
    "high-cost-api",
    request,
    env,
    env.HIGH_COST_API_RATE_LIMITER,
    "HIGH_COST_API_RATE_LIMITER_UNAVAILABLE",
    "HIGH_COST_API_RATE_LIMITED",
  );
}

async function enforceCloudflareCostGuardRateLimit(
  scope: string,
  request: Request,
  env: Env,
  binding: RateLimitBinding | undefined,
  unavailableCode: string,
  limitedCode: string,
): Promise<void> {
  if (!binding) {
    if (apiCostGuardRequired(env)) {
      throw new HttpError(503, unavailableCode, "서비스 공격 방지 속도 제한기를 사용할 수 없습니다.");
    }
    return;
  }
  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "API_CLIENT_IP_REQUIRED", "요청의 네트워크 출처를 확인할 수 없습니다.");
  }
  let result: { success: boolean };
  try {
    result = await binding.limit({ key: await sha256Hex(`${scope}:${clientIp}`) });
  } catch {
    throw new HttpError(503, unavailableCode, "서비스 공격 방지 속도 제한기를 사용할 수 없습니다.");
  }
  if (!result.success) {
    throw new HttpError(429, limitedCode, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function enforceCloudflareAnonymousSessionRateLimit(request: Request, env: Env): Promise<void> {
  if (!env.ANONYMOUS_SESSION_RATE_LIMITER) {
    if (isProductionEnvironment(env)) {
      throw new HttpError(
        503,
        "ANONYMOUS_SESSION_RATE_LIMITER_UNAVAILABLE",
        "익명 세션 발급 공격 방지 장치를 사용할 수 없습니다.",
      );
    }
    return;
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "ANONYMOUS_SESSION_CLIENT_IP_REQUIRED", "익명 세션 요청의 네트워크 출처를 확인할 수 없습니다.");
  }

  let result: { success: boolean };
  try {
    result = await env.ANONYMOUS_SESSION_RATE_LIMITER.limit({ key: await sha256Hex(`anonymous-session:${clientIp}`) });
  } catch {
    throw new HttpError(
      503,
      "ANONYMOUS_SESSION_RATE_LIMITER_UNAVAILABLE",
      "익명 세션 발급 공격 방지 장치를 사용할 수 없습니다.",
    );
  }

  if (!result.success) {
    throw new HttpError(429, "ANONYMOUS_SESSION_RATE_LIMITED", "익명 세션 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function enforceCloudflarePhotoRateLimit(scope: "ticket" | "write", request: Request, env: Env): Promise<void> {
  if (!env.PHOTO_UPLOAD_RATE_LIMITER) {
    if (isProductionEnvironment(env)) {
      throw new HttpError(503, "PHOTO_RATE_LIMITER_UNAVAILABLE", "사진 업로드 속도 보호장치를 사용할 수 없습니다.");
    }
    return;
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "PHOTO_CLIENT_IP_REQUIRED", "사진 업로드 요청의 네트워크 출처를 확인할 수 없습니다.");
  }

  let result: { success: boolean };
  try {
    result = await env.PHOTO_UPLOAD_RATE_LIMITER.limit({ key: await sha256Hex(`photo:${scope}:${clientIp}`) });
  } catch {
    throw new HttpError(503, "PHOTO_RATE_LIMITER_UNAVAILABLE", "사진 업로드 속도 보호장치를 사용할 수 없습니다.");
  }

  if (!result.success) {
    throw new HttpError(429, "PHOTO_UPLOAD_RATE_LIMITED", "사진 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function enforceCloudflarePhotoReadRateLimit(request: Request, env: Env): Promise<void> {
  if (!env.PHOTO_READ_RATE_LIMITER) {
    if (isProductionEnvironment(env)) {
      throw new HttpError(503, "PHOTO_READ_RATE_LIMITER_UNAVAILABLE", "사진 조회 속도 보호장치를 사용할 수 없습니다.");
    }
    return;
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(403, "PHOTO_CLIENT_IP_REQUIRED", "사진 조회 요청의 네트워크 출처를 확인할 수 없습니다.");
  }

  let result: { success: boolean };
  try {
    result = await env.PHOTO_READ_RATE_LIMITER.limit({ key: await sha256Hex(`photo:read:${clientIp}`) });
  } catch {
    throw new HttpError(503, "PHOTO_READ_RATE_LIMITER_UNAVAILABLE", "사진 조회 속도 보호장치를 사용할 수 없습니다.");
  }

  if (!result.success) {
    throw new HttpError(429, "PHOTO_READ_RATE_LIMITED", "사진 조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function trustedCloudflareClientIp(request: Request, env: Env): string | null {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp && /^[0-9a-f:.]{3,64}$/i.test(cloudflareIp)) {
    return cloudflareIp;
  }

  if (isProductionEnvironment(env)) {
    return null;
  }

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedIp && /^[0-9a-f:.]{3,64}$/i.test(forwardedIp)) {
    return forwardedIp;
  }

  return "local-development";
}

function photoUploadSecuritySecret(env: Env): string | null {
  const secret = env.SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return secret;
  }

  if (secret || isProductionEnvironment(env)) {
    throw new HttpError(503, "PHOTO_UPLOAD_SECRET_REQUIRED", "사진 업로드 보안 키가 설정되지 않았습니다.");
  }

  return null;
}

function photoUploadTicketTtlSeconds(env: Env): number {
  return boundedFreeTierLimit(env.SILSIGAN_PHOTO_TICKET_TTL_SECONDS, photoUploadTicketTtlSafetyCeilingSeconds);
}

async function issuePhotoUploadTicket(
  claims: PhotoUploadTicketClaims,
  session: AnonymousSession,
  env: Env,
  now: Date,
): Promise<{ signature: string; expiresAt: string } | null> {
  const secret = photoUploadSecuritySecret(env);
  if (!secret) {
    return null;
  }

  const expiresAt = new Date(now.getTime() + photoUploadTicketTtlSeconds(env) * 1_000).toISOString();
  const signature = await hmacSha256Hex(secret, photoUploadTicketMessage(claims, session.id, expiresAt));
  return { signature, expiresAt };
}

async function assertPhotoUploadTicket(input: PhotoCompletionPayload, session: AnonymousSession, env: Env): Promise<boolean> {
  const secret = photoUploadSecuritySecret(env);
  if (!secret) {
    return false;
  }

  if (!/^upload_[0-9a-f-]{36}$/i.test(input.uploadId) || !input.ticket || !input.ticketExpiresAt) {
    throw new HttpError(403, "PHOTO_UPLOAD_TICKET_INVALID", "사진 업로드 티켓이 올바르지 않습니다.");
  }

  const expiresAtMs = Date.parse(input.ticketExpiresAt);
  const nowMs = Date.now();
  const maxExpiresAtMs = nowMs + photoUploadTicketTtlSeconds(env) * 1_000 + photoUploadTicketClockSkewMs;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs - photoUploadTicketClockSkewMs || expiresAtMs > maxExpiresAtMs) {
    throw new HttpError(403, "PHOTO_UPLOAD_TICKET_EXPIRED", "사진 업로드 티켓이 만료되었거나 유효 시간이 올바르지 않습니다.");
  }

  const expected = await hmacSha256Hex(secret, photoUploadTicketMessage(input, session.id, input.ticketExpiresAt));
  if (!(await timingSafeEqualString(input.ticket, expected))) {
    throw new HttpError(403, "PHOTO_UPLOAD_TICKET_INVALID", "사진 업로드 티켓이 올바르지 않습니다.");
  }

  return true;
}

function photoUploadTicketMessage(claims: PhotoUploadTicketClaims, anonymousSessionId: string, expiresAt: string): string {
  return JSON.stringify([
    "silsigan-photo-ticket-v3",
    claims.uploadId,
    anonymousSessionId,
    claims.placeId,
    claims.mimeType,
    claims.byteSize,
    claims.width,
    claims.height,
    claims.proximityRadiusM ?? null,
    claims.proximityAccuracyBucket ?? "unknown",
    expiresAt,
  ]);
}

async function claimPhotoUploadTicket(
  db: D1Database,
  uploadId: string,
  anonymousUserId: string,
  expiresAt: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO photo_upload_claims (upload_id, anonymous_user_id, expires_at, consumed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(uploadId, anonymousUserId, expiresAt, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE constraint|PRIMARY KEY/i.test(message)) {
      throw new HttpError(409, "PHOTO_UPLOAD_TICKET_REPLAYED", "이미 사용된 사진 업로드 티켓입니다.");
    }
    throw new HttpError(503, "PHOTO_ABUSE_GUARD_UNAVAILABLE", "사진 업로드 악용 방지 원장을 사용할 수 없습니다.");
  }
}

function photoAbuseBudgetLimits(env: Env): { dailyUploadLimit: number; dailyBytesLimit: number } {
  return {
    dailyUploadLimit: boundedFreeTierLimit(env.SILSIGAN_PHOTO_DAILY_UPLOAD_LIMIT, photoDailyUploadFreeSafetyCeiling),
    dailyBytesLimit: boundedFreeTierLimit(env.SILSIGAN_PHOTO_DAILY_BYTES_LIMIT, photoDailyBytesFreeSafetyCeiling),
  };
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function reservePhotoAbuseBudget(
  db: D1Database,
  request: Request,
  byteSize: number,
  env: Env,
  now = new Date(),
): Promise<PhotoAbuseBudgetReservation> {
  const secret = photoUploadSecuritySecret(env);
  const clientIp = trustedCloudflareClientIp(request, env);
  if (!secret || !clientIp) {
    throw new HttpError(503, "PHOTO_ABUSE_GUARD_UNAVAILABLE", "사진 업로드 악용 방지 원장을 사용할 수 없습니다.");
  }

  const principalHash = `hmac-sha256:${await hmacSha256Hex(secret, `photo-abuse-ip:${clientIp}`)}`;
  const dayUtc = utcDayKey(now);
  const updatedAt = now.toISOString();
  const { dailyUploadLimit, dailyBytesLimit } = photoAbuseBudgetLimits(env);
  let reservation: D1PhotoAbuseBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `INSERT INTO photo_abuse_budget (principal_hash, day_utc, upload_count, bytes_in_period, updated_at)
         SELECT ?, ?, 1, ?, ?
         WHERE 1 <= ? AND ? <= ?
         ON CONFLICT(principal_hash, day_utc) DO UPDATE SET
           upload_count = photo_abuse_budget.upload_count + 1,
           bytes_in_period = photo_abuse_budget.bytes_in_period + excluded.bytes_in_period,
           updated_at = excluded.updated_at
         WHERE photo_abuse_budget.upload_count + 1 <= ?
           AND photo_abuse_budget.bytes_in_period + excluded.bytes_in_period <= ?
         RETURNING upload_count AS uploadCount, bytes_in_period AS bytesInPeriod`,
      )
      .bind(
        principalHash,
        dayUtc,
        byteSize,
        updatedAt,
        dailyUploadLimit,
        byteSize,
        dailyBytesLimit,
        dailyUploadLimit,
        dailyBytesLimit,
      )
      .first<D1PhotoAbuseBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_ABUSE_GUARD_UNAVAILABLE", "사진 업로드 악용 방지 원장을 사용할 수 없습니다.");
  }

  if (reservation) {
    return { ...reservation, dayUtc, dailyUploadLimit, dailyBytesLimit };
  }

  let current: D1PhotoAbuseBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT upload_count AS uploadCount, bytes_in_period AS bytesInPeriod
         FROM photo_abuse_budget
         WHERE principal_hash = ? AND day_utc = ?`,
      )
      .bind(principalHash, dayUtc)
      .first<D1PhotoAbuseBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_ABUSE_GUARD_UNAVAILABLE", "사진 업로드 악용 방지 원장을 사용할 수 없습니다.");
  }

  const uploadCount = current?.uploadCount ?? 0;
  const bytesInPeriod = current?.bytesInPeriod ?? 0;
  if (uploadCount + 1 > dailyUploadLimit) {
    throw new HttpError(429, "PHOTO_DAILY_UPLOAD_LIMIT_EXHAUSTED", "오늘 허용된 사진 업로드 횟수에 도달했습니다.", {
      dayUtc,
      uploadCount,
      dailyUploadLimit,
    });
  }
  if (bytesInPeriod + byteSize > dailyBytesLimit) {
    throw new HttpError(429, "PHOTO_DAILY_BYTES_LIMIT_EXHAUSTED", "오늘 허용된 사진 업로드 용량에 도달했습니다.", {
      dayUtc,
      bytesInPeriod,
      dailyBytesLimit,
    });
  }

  throw new HttpError(503, "PHOTO_ABUSE_GUARD_UNAVAILABLE", "사진 업로드 악용 방지 원장을 사용할 수 없습니다.");
}

function photoStorageBudgetLimits(env: Env): {
  storageMaxBytes: number;
  storageStopBytes: number;
  monthlyWriteLimit: number;
  monthlyWriteStopLimit: number;
  monthlyTransformLimit: number;
  monthlyTransformStopLimit: number;
  monthlyReadLimit: number;
  monthlyReadStopLimit: number;
  dailyReadLimit: number;
  dailyReadStopLimit: number;
} {
  const storageMaxBytes = boundedFreeTierLimit(env.SILSIGAN_PHOTO_STORAGE_MAX_BYTES, photoStorageFreeSafetyCeilingBytes);
  const monthlyWriteLimit = boundedFreeTierLimit(env.SILSIGAN_PHOTO_MONTHLY_WRITE_LIMIT, photoMonthlyWriteFreeSafetyCeiling);
  const monthlyTransformLimit = boundedFreeTierLimit(
    env.SILSIGAN_PHOTO_MONTHLY_TRANSFORM_LIMIT,
    photoMonthlyTransformFreeSafetyCeiling,
  );
  const monthlyReadLimit = boundedFreeTierLimit(env.SILSIGAN_PHOTO_MONTHLY_READ_LIMIT, photoMonthlyReadFreeSafetyCeiling);
  const dailyReadLimit = boundedFreeTierLimit(env.SILSIGAN_PHOTO_DAILY_READ_LIMIT, photoDailyReadFreeSafetyCeiling);
  return {
    storageMaxBytes,
    storageStopBytes: costGuardStopThreshold(storageMaxBytes),
    monthlyWriteLimit,
    monthlyWriteStopLimit: costGuardStopThreshold(monthlyWriteLimit),
    monthlyTransformLimit,
    monthlyTransformStopLimit: costGuardStopThreshold(monthlyTransformLimit),
    monthlyReadLimit,
    monthlyReadStopLimit: costGuardStopThreshold(monthlyReadLimit),
    dailyReadLimit,
    dailyReadStopLimit: costGuardStopThreshold(dailyReadLimit),
  };
}

function costGuardStopThreshold(limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor((limit * photoCostGuardStopPercent) / 100));
}

function boundedFreeTierLimit(raw: string | undefined, ceiling: number): number {
  if (raw === undefined || raw.trim() === "") {
    return ceiling;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return ceiling;
  }

  return Math.min(parsed, ceiling);
}

function utcMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

async function reservePhotoTransformBudget(
  db: D1Database,
  env: Env,
  now = new Date(),
): Promise<PhotoTransformBudgetReservation> {
  const { monthlyTransformLimit, monthlyTransformStopLimit } = photoStorageBudgetLimits(env);
  const periodUtc = utcMonthKey(now);
  const updatedAt = now.toISOString();
  let reservation: D1PhotoTransformBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `UPDATE photo_transform_budget
         SET period_utc = ?,
             transforms_in_period = CASE WHEN period_utc = ? THEN transforms_in_period + 1 ELSE 1 END,
             updated_at = ?
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM photo_upload_control
             WHERE photo_upload_control.id = 1 AND photo_upload_control.uploads_enabled = 1
           )
           AND CASE WHEN period_utc = ? THEN transforms_in_period + 1 ELSE 1 END <= ?
         RETURNING period_utc AS periodUtc, transforms_in_period AS transformsInPeriod`,
      )
      .bind(periodUtc, periodUtc, updatedAt, periodUtc, monthlyTransformStopLimit)
      .first<D1PhotoTransformBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_TRANSFORM_COST_GUARD_UNAVAILABLE", "이미지 변환 비용 보호장치를 확인할 수 없습니다.");
  }

  if (reservation) {
    const automaticStopTriggered = reservation.transformsInPeriod >= monthlyTransformStopLimit;
    return {
      ...reservation,
      monthlyTransformLimit,
      monthlyTransformStopLimit,
      automaticStopTriggered,
    };
  }

  let current: D1PhotoTransformBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT
           b.period_utc AS periodUtc,
           b.transforms_in_period AS transformsInPeriod,
           COALESCE(c.uploads_enabled, 0) AS uploadsEnabled
         FROM photo_transform_budget b
         LEFT JOIN photo_upload_control c ON c.id = b.id
         WHERE b.id = 1`,
      )
      .first<D1PhotoTransformBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_TRANSFORM_COST_GUARD_UNAVAILABLE", "이미지 변환 비용 보호장치를 확인할 수 없습니다.");
  }

  if (!current) {
    throw new HttpError(503, "PHOTO_TRANSFORM_COST_GUARD_UNAVAILABLE", "이미지 변환 비용 보호장치를 확인할 수 없습니다.");
  }
  if (current.uploadsEnabled !== 1) {
    throw new HttpError(503, "PHOTO_UPLOADS_DISABLED", "비용 보호 또는 운영자 조치로 사진 업로드가 일시 중단되었습니다.");
  }

  const currentTransforms = current.periodUtc === periodUtc ? current.transformsInPeriod : 0;
  if (currentTransforms + 1 > monthlyTransformLimit) {
    await disablePhotoUploadsForCostGuard(db, "automatic-monthly-transform-hard-cap", now);
    throw new HttpError(429, "PHOTO_MONTHLY_TRANSFORM_BUDGET_EXHAUSTED", "이번 달 무료 이미지 변환 안전 한도에 도달해 사진 업로드를 잠시 중단했습니다.", {
      periodUtc,
      transformsInPeriod: currentTransforms,
      monthlyTransformLimit,
    });
  }
  if (currentTransforms + 1 > monthlyTransformStopLimit) {
    await disablePhotoUploadsForCostGuard(db, "automatic-80-percent-transform-cost-guard", now);
    throw new HttpError(429, "PHOTO_TRANSFORM_COST_GUARD_80_PERCENT_STOP", "무료 이미지 변환량 80%에 도달하기 전에 사진 업로드를 자동 중단했습니다.", {
      stopPercent: photoCostGuardStopPercent,
      transformsInPeriod: currentTransforms,
      monthlyTransformStopLimit,
    });
  }

  throw new HttpError(503, "PHOTO_TRANSFORM_COST_GUARD_UNAVAILABLE", "이미지 변환 비용 보호장치를 확인할 수 없습니다.");
}

async function reservePhotoStorageBudget(db: D1Database, byteSize: number, env: Env, now = new Date()): Promise<PhotoStorageBudgetReservation> {
  const { storageMaxBytes, storageStopBytes, monthlyWriteLimit, monthlyWriteStopLimit } = photoStorageBudgetLimits(env);
  const periodUtc = utcMonthKey(now);
  const updatedAt = now.toISOString();
  let reservation: D1PhotoStorageBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `UPDATE photo_storage_budget
         SET active_bytes = active_bytes + ?,
             period_utc = ?,
             writes_in_period = CASE WHEN period_utc = ? THEN writes_in_period + 1 ELSE 1 END,
             updated_at = ?
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM photo_upload_control
             WHERE photo_upload_control.id = 1 AND photo_upload_control.uploads_enabled = 1
           )
           AND active_bytes + ? <= ?
           AND CASE WHEN period_utc = ? THEN writes_in_period + 1 ELSE 1 END <= ?
         RETURNING active_bytes AS activeBytes, period_utc AS periodUtc, writes_in_period AS writesInPeriod`,
      )
      .bind(byteSize, periodUtc, periodUtc, updatedAt, byteSize, storageStopBytes, periodUtc, monthlyWriteStopLimit)
      .first<D1PhotoStorageBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
  }

  if (reservation) {
    const automaticStopTriggered =
      reservation.activeBytes >= storageStopBytes || reservation.writesInPeriod >= monthlyWriteStopLimit;
    if (automaticStopTriggered) {
      await disablePhotoUploadsForCostGuard(db, "automatic-80-percent-cost-guard", now);
    }
    return {
      ...reservation,
      storageMaxBytes,
      storageStopBytes,
      monthlyWriteLimit,
      monthlyWriteStopLimit,
      automaticStopTriggered,
    };
  }

  let current: D1PhotoStorageBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT
           active_bytes AS activeBytes,
           period_utc AS periodUtc,
           writes_in_period AS writesInPeriod,
           COALESCE((SELECT uploads_enabled FROM photo_upload_control WHERE id = 1), 0) AS uploadsEnabled
         FROM photo_storage_budget
         WHERE id = 1`,
      )
      .first<D1PhotoStorageBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
  }

  if (!current) {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
  }

  if (current.uploadsEnabled !== 1) {
    throw new HttpError(503, "PHOTO_UPLOADS_DISABLED", "비용 보호 또는 운영자 조치로 사진 업로드가 일시 중단되었습니다.");
  }

  const currentWrites = current.periodUtc === periodUtc ? current.writesInPeriod : 0;
  if (current.activeBytes + byteSize > storageMaxBytes) {
    await disablePhotoUploadsForCostGuard(db, "automatic-storage-hard-cap", now);
    throw new HttpError(429, "PHOTO_STORAGE_BUDGET_EXHAUSTED", "무료 저장 안전 한도에 도달해 사진 업로드를 잠시 중단했습니다.", {
      activeBytes: current.activeBytes,
      storageMaxBytes,
    });
  }

  if (currentWrites + 1 > monthlyWriteLimit) {
    await disablePhotoUploadsForCostGuard(db, "automatic-monthly-write-hard-cap", now);
    throw new HttpError(429, "PHOTO_MONTHLY_WRITE_BUDGET_EXHAUSTED", "이번 달 무료 쓰기 안전 한도에 도달해 사진 업로드를 잠시 중단했습니다.", {
      periodUtc,
      writesInPeriod: currentWrites,
      monthlyWriteLimit,
    });
  }

  if (current.activeBytes + byteSize > storageStopBytes || currentWrites + 1 > monthlyWriteStopLimit) {
    await disablePhotoUploadsForCostGuard(db, "automatic-80-percent-cost-guard", now);
    throw new HttpError(429, "PHOTO_COST_GUARD_80_PERCENT_STOP", "무료 사용량 안전 기준에 도달하기 전에 사진 업로드를 자동 중단했습니다.", {
      stopPercent: photoCostGuardStopPercent,
      activeBytes: current.activeBytes,
      storageStopBytes,
      writesInPeriod: currentWrites,
      monthlyWriteStopLimit,
    });
  }

  throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
}

async function reservePhotoReadBudget(db: D1Database, env: Env, now = new Date()): Promise<PhotoReadBudgetReservation> {
  const { monthlyReadLimit, monthlyReadStopLimit, dailyReadLimit, dailyReadStopLimit } = photoStorageBudgetLimits(env);
  const periodUtc = utcMonthKey(now);
  const dayUtc = utcDayKey(now);
  const updatedAt = now.toISOString();
  let reservation: D1PhotoReadBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `UPDATE photo_read_budget
         SET period_utc = ?,
             reads_in_period = CASE WHEN period_utc = ? THEN reads_in_period + 1 ELSE 1 END,
             day_utc = ?,
             reads_in_day = CASE WHEN day_utc = ? THEN reads_in_day + 1 ELSE 1 END,
             updated_at = ?
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM photo_read_control
             WHERE photo_read_control.id = 1 AND photo_read_control.reads_enabled = 1
           )
           AND CASE WHEN period_utc = ? THEN reads_in_period + 1 ELSE 1 END <= ?
           AND CASE WHEN day_utc = ? THEN reads_in_day + 1 ELSE 1 END <= ?
         RETURNING
           period_utc AS periodUtc,
           reads_in_period AS readsInPeriod,
           day_utc AS dayUtc,
           reads_in_day AS readsInDay`,
      )
      .bind(periodUtc, periodUtc, dayUtc, dayUtc, updatedAt, periodUtc, monthlyReadStopLimit, dayUtc, dailyReadStopLimit)
      .first<D1PhotoReadBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
  }

  if (reservation) {
    const monthlyStopTriggered = reservation.readsInPeriod >= monthlyReadStopLimit;
    const dailyStopTriggered = reservation.readsInDay >= dailyReadStopLimit;
    const automaticStopTriggered = monthlyStopTriggered || dailyStopTriggered;
    const automaticStopReason = dailyStopTriggered
      ? "automatic-80-percent-daily-read-cost-guard"
      : monthlyStopTriggered
        ? "automatic-80-percent-monthly-read-cost-guard"
        : null;
    if (automaticStopTriggered) {
      await disablePhotoReadsForCostGuard(db, automaticStopReason ?? "automatic-80-percent-read-cost-guard", now);
    }
    return {
      ...reservation,
      monthlyReadLimit,
      monthlyReadStopLimit,
      dailyReadLimit,
      dailyReadStopLimit,
      automaticStopTriggered,
      automaticStopReason,
    };
  }

  let current: D1PhotoReadBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT
           b.period_utc AS periodUtc,
           b.reads_in_period AS readsInPeriod,
           b.day_utc AS dayUtc,
           b.reads_in_day AS readsInDay,
           COALESCE(c.reads_enabled, 0) AS readsEnabled
         FROM photo_read_budget b
         LEFT JOIN photo_read_control c ON c.id = b.id
         WHERE b.id = 1`,
      )
      .first<D1PhotoReadBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
  }

  if (!current) {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
  }
  if (current.readsEnabled !== 1) {
    throw new HttpError(503, "PHOTO_READS_DISABLED", "비용 보호 또는 운영자 조치로 사진 조회가 일시 중단되었습니다.");
  }

  const currentReads = current.periodUtc === periodUtc ? current.readsInPeriod : 0;
  const currentDailyReads = current.dayUtc === dayUtc ? current.readsInDay : 0;
  if (currentReads + 1 > monthlyReadLimit) {
    await disablePhotoReadsForCostGuard(db, "automatic-monthly-read-hard-cap", now);
    throw new HttpError(429, "PHOTO_MONTHLY_READ_BUDGET_EXHAUSTED", "이번 달 무료 조회 안전 한도에 도달해 사진 조회를 잠시 중단했습니다.", {
      periodUtc,
      readsInPeriod: currentReads,
      monthlyReadLimit,
    });
  }
  if (currentDailyReads + 1 > dailyReadLimit) {
    await disablePhotoReadsForCostGuard(db, "automatic-daily-read-hard-cap", now);
    throw new HttpError(429, "PHOTO_DAILY_READ_BUDGET_EXHAUSTED", "오늘의 D1 무료 쓰기 안전 한도에 도달해 사진 조회를 잠시 중단했습니다.", {
      dayUtc,
      readsInDay: currentDailyReads,
      dailyReadLimit,
    });
  }
  if (currentReads + 1 > monthlyReadStopLimit) {
    await disablePhotoReadsForCostGuard(db, "automatic-80-percent-read-cost-guard", now);
    throw new HttpError(429, "PHOTO_READ_COST_GUARD_80_PERCENT_STOP", "무료 사용량 안전 기준에 도달하기 전에 사진 조회를 자동 중단했습니다.", {
      stopPercent: photoCostGuardStopPercent,
      readsInPeriod: currentReads,
      monthlyReadStopLimit,
    });
  }
  if (currentDailyReads + 1 > dailyReadStopLimit) {
    await disablePhotoReadsForCostGuard(db, "automatic-80-percent-daily-read-cost-guard", now);
    throw new HttpError(429, "PHOTO_DAILY_READ_COST_GUARD_80_PERCENT_STOP", "D1 무료 일일 쓰기 안전 기준에 도달하기 전에 사진 조회를 자동 중단했습니다.", {
      stopPercent: photoCostGuardStopPercent,
      readsInDay: currentDailyReads,
      dailyReadStopLimit,
    });
  }

  throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
}

function photoReadAbuseDailyLimit(env: Env): number {
  return boundedFreeTierLimit(env.SILSIGAN_PHOTO_DAILY_IP_READ_LIMIT, photoDailyIpReadFreeSafetyCeiling);
}

async function reservePhotoReadAbuseBudget(
  db: D1Database,
  request: Request,
  env: Env,
  now = new Date(),
): Promise<D1PhotoReadAbuseBudgetRow | null> {
  const secret = env.SILSIGAN_PHOTO_UPLOAD_HMAC_SECRET?.trim();
  if (!secret) {
    if (!isProductionEnvironment(env)) {
      return null;
    }
    throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
  }
  if (secret.length < 32) {
    throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
  }

  const clientIp = trustedCloudflareClientIp(request, env);
  if (!clientIp) {
    throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
  }

  const principalHash = `hmac-sha256:${await hmacSha256Hex(secret, `photo-read-abuse-ip:${clientIp}`)}`;
  const dayUtc = utcDayKey(now);
  const updatedAt = now.toISOString();
  const dailyReadLimit = photoReadAbuseDailyLimit(env);
  let reservation: D1PhotoReadAbuseBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `INSERT INTO photo_read_abuse_budget (principal_hash, day_utc, read_count, updated_at)
         SELECT ?, ?, 1, ?
         WHERE 1 <= ?
         ON CONFLICT(principal_hash, day_utc) DO UPDATE SET
           read_count = photo_read_abuse_budget.read_count + 1,
           updated_at = excluded.updated_at
         WHERE photo_read_abuse_budget.read_count + 1 <= ?
         RETURNING read_count AS readCount`,
      )
      .bind(principalHash, dayUtc, updatedAt, dailyReadLimit, dailyReadLimit)
      .first<D1PhotoReadAbuseBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
  }

  if (reservation) {
    return reservation;
  }

  let current: D1PhotoReadAbuseBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT read_count AS readCount
         FROM photo_read_abuse_budget
         WHERE principal_hash = ? AND day_utc = ?`,
      )
      .bind(principalHash, dayUtc)
      .first<D1PhotoReadAbuseBudgetRow>();
  } catch {
    throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
  }

  const readCount = current?.readCount ?? 0;
  if (readCount + 1 > dailyReadLimit) {
    throw new HttpError(429, "PHOTO_DAILY_IP_READ_LIMIT_EXHAUSTED", "오늘 허용된 사진 조회 횟수에 도달했습니다.", {
      dayUtc,
      readCount,
      dailyReadLimit,
    });
  }

  throw new HttpError(503, "PHOTO_READ_ABUSE_GUARD_UNAVAILABLE", "사진 조회 악용 방지 장치를 사용할 수 없습니다.");
}

async function disablePhotoUploadsForCostGuard(db: D1Database, reason: string, now = new Date()): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE photo_upload_control
         SET uploads_enabled = 0, reason = ?, updated_by = 'system:photo-cost-guard', updated_at = ?
         WHERE id = 1 AND uploads_enabled = 1`,
      )
      .bind(reason, now.toISOString())
      .run();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 중단 상태로 전환할 수 없습니다.");
  }
}

async function disablePhotoReadsForCostGuard(db: D1Database, reason: string, now = new Date()): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE photo_read_control
         SET reads_enabled = 0, reason = ?, updated_by = 'system:photo-cost-guard', updated_at = ?
         WHERE id = 1 AND reads_enabled = 1`,
      )
      .bind(reason, now.toISOString())
      .run();
  } catch {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 중단 상태로 전환할 수 없습니다.");
  }
}

async function assertPhotoUploadsEnabled(db: D1Database): Promise<void> {
  let state: { uploadsEnabled: number } | null;
  try {
    state = await db
      .prepare("SELECT uploads_enabled AS uploadsEnabled FROM photo_upload_control WHERE id = 1")
      .first<{ uploadsEnabled: number }>();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
  }

  if (!state) {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 저장 비용 보호장치를 확인할 수 없습니다.");
  }
  if (state.uploadsEnabled !== 1) {
    throw new HttpError(503, "PHOTO_UPLOADS_DISABLED", "비용 보호 또는 운영자 조치로 사진 업로드가 일시 중단되었습니다.");
  }
}

async function assertPhotoReadsEnabled(db: D1Database): Promise<void> {
  let state: { readsEnabled: number } | null;
  try {
    state = await db
      .prepare("SELECT reads_enabled AS readsEnabled FROM photo_read_control WHERE id = 1")
      .first<{ readsEnabled: number }>();
  } catch {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
  }

  if (!state) {
    throw new HttpError(503, "PHOTO_READ_COST_GUARD_UNAVAILABLE", "사진 조회 비용 보호장치를 확인할 수 없습니다.");
  }
  if (state.readsEnabled !== 1) {
    throw new HttpError(503, "PHOTO_READS_DISABLED", "비용 보호 또는 운영자 조치로 사진 조회가 일시 중단되었습니다.");
  }
}

async function getPhotoCostGuard(env: Env): Promise<Response> {
  const db = requireD1(env);
  let state: {
    activeBytes: number;
    periodUtc: string;
    writesInPeriod: number;
    uploadsEnabled: number;
    readPeriodUtc: string;
    readsInPeriod: number;
    readsEnabled: number;
    transformPeriodUtc: string;
    transformsInPeriod: number;
    dayUtc: string;
    readsInDay: number;
    reason: string | null;
    updatedBy: string;
    updatedAt: string;
  } | null;
  try {
    state = await db
      .prepare(
        `SELECT
           b.active_bytes AS activeBytes,
           b.period_utc AS periodUtc,
           b.writes_in_period AS writesInPeriod,
           c.uploads_enabled AS uploadsEnabled,
           rb.period_utc AS readPeriodUtc,
           rb.reads_in_period AS readsInPeriod,
           tb.period_utc AS transformPeriodUtc,
           tb.transforms_in_period AS transformsInPeriod,
           rb.day_utc AS dayUtc,
           rb.reads_in_day AS readsInDay,
           rc.reads_enabled AS readsEnabled,
           CASE
             WHEN c.uploads_enabled = 0 THEN c.reason
             WHEN rc.reads_enabled = 0 THEN rc.reason
             ELSE COALESCE(c.reason, rc.reason)
           END AS reason,
           CASE WHEN c.updated_at >= rc.updated_at THEN c.updated_by ELSE rc.updated_by END AS updatedBy,
           CASE WHEN c.updated_at >= rc.updated_at THEN c.updated_at ELSE rc.updated_at END AS updatedAt
         FROM photo_storage_budget b
         JOIN photo_upload_control c ON c.id = b.id
         JOIN photo_read_budget rb ON rb.id = b.id
         JOIN photo_read_control rc ON rc.id = b.id
         JOIN photo_transform_budget tb ON tb.id = b.id
         WHERE b.id = 1`,
      )
      .first<{
        activeBytes: number;
        periodUtc: string;
        writesInPeriod: number;
        uploadsEnabled: number;
        readPeriodUtc: string;
        readsInPeriod: number;
        readsEnabled: number;
        transformPeriodUtc: string;
        transformsInPeriod: number;
        dayUtc: string;
        readsInDay: number;
        reason: string | null;
        updatedBy: string;
        updatedAt: string;
      }>();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 비용 보호장치를 확인할 수 없습니다.");
  }
  if (!state) {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 비용 보호장치를 확인할 수 없습니다.");
  }

  const limits = photoStorageBudgetLimits(env);
  return json(
    {
      uploadsEnabled: state.uploadsEnabled === 1,
      readsEnabled: state.readsEnabled === 1,
      reason: state.reason,
      activeBytes: state.activeBytes,
      storageMaxBytes: limits.storageMaxBytes,
      storageStopBytes: limits.storageStopBytes,
      storagePercent: percentageOf(state.activeBytes, limits.storageMaxBytes),
      storageStopPercent: percentageOf(state.activeBytes, limits.storageStopBytes),
      periodUtc: state.periodUtc,
      writesInPeriod: state.writesInPeriod,
      monthlyWriteLimit: limits.monthlyWriteLimit,
      monthlyWriteStopLimit: limits.monthlyWriteStopLimit,
      writePercent: percentageOf(state.writesInPeriod, limits.monthlyWriteLimit),
      writeStopPercent: percentageOf(state.writesInPeriod, limits.monthlyWriteStopLimit),
      transformPeriodUtc: state.transformPeriodUtc,
      transformsInPeriod: state.transformsInPeriod,
      monthlyTransformLimit: limits.monthlyTransformLimit,
      monthlyTransformStopLimit: limits.monthlyTransformStopLimit,
      transformPercent: percentageOf(state.transformsInPeriod, limits.monthlyTransformLimit),
      transformStopPercent: percentageOf(state.transformsInPeriod, limits.monthlyTransformStopLimit),
      readPeriodUtc: state.readPeriodUtc,
      readsInPeriod: state.readsInPeriod,
      monthlyReadLimit: limits.monthlyReadLimit,
      monthlyReadStopLimit: limits.monthlyReadStopLimit,
      readPercent: percentageOf(state.readsInPeriod, limits.monthlyReadLimit),
      readStopPercent: percentageOf(state.readsInPeriod, limits.monthlyReadStopLimit),
      dayUtc: state.dayUtc,
      readsInDay: state.readsInDay,
      dailyReadLimit: limits.dailyReadLimit,
      dailyReadStopLimit: limits.dailyReadStopLimit,
      dailyReadPercent: percentageOf(state.readsInDay, limits.dailyReadLimit),
      dailyReadStopPercent: percentageOf(state.readsInDay, limits.dailyReadStopLimit),
      updatedBy: state.updatedBy,
      updatedAt: state.updatedAt,
    },
    {
      mode: "manual-emergency-stop-plus-atomic-hard-cap",
      stopPercent: photoCostGuardStopPercent,
      policy: "uploads, Cloudflare Images transformations, and Class B reads stop at 80 percent of conservative application caps; the daily read cap also stays below the D1 Free daily write allowance",
    },
  );
}

async function updatePhotoCostGuard(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const db = requireD1(env);
  const body = await readJson(request);
  const uploadsEnabled = booleanField(body, "uploadsEnabled");
  const readsEnabled = body.readsEnabled === undefined ? uploadsEnabled : booleanField(body, "readsEnabled");
  const reconciliationAcknowledged =
    body.reconciliationAcknowledged === undefined
      ? false
      : booleanField(body, "reconciliationAcknowledged");
  const reason = stringField(body, "reason", 300);
  const updatedAt = new Date().toISOString();
  const updatedBy = adminSubject(request);

  let current: {
    activeBytes: number;
    periodUtc: string;
    writesInPeriod: number;
    uploadsEnabled: number;
    transformPeriodUtc: string;
    transformsInPeriod: number;
    readPeriodUtc: string;
    readsInPeriod: number;
    dayUtc: string;
    readsInDay: number;
    readsEnabled: number;
  } | null;
  try {
    current = await db
      .prepare(
        `SELECT
           b.active_bytes AS activeBytes,
           b.period_utc AS periodUtc,
           b.writes_in_period AS writesInPeriod,
           c.uploads_enabled AS uploadsEnabled,
           tb.period_utc AS transformPeriodUtc,
           tb.transforms_in_period AS transformsInPeriod,
           rb.period_utc AS readPeriodUtc,
           rb.reads_in_period AS readsInPeriod,
           rb.day_utc AS dayUtc,
           rb.reads_in_day AS readsInDay,
           rc.reads_enabled AS readsEnabled
         FROM photo_storage_budget b
         JOIN photo_upload_control c ON c.id = b.id
         JOIN photo_transform_budget tb ON tb.id = b.id
         JOIN photo_read_budget rb ON rb.id = b.id
         JOIN photo_read_control rc ON rc.id = b.id
         WHERE b.id = 1`,
      )
      .first<{
        activeBytes: number;
        periodUtc: string;
        writesInPeriod: number;
        uploadsEnabled: number;
        transformPeriodUtc: string;
        transformsInPeriod: number;
        readPeriodUtc: string;
        readsInPeriod: number;
        dayUtc: string;
        readsInDay: number;
        readsEnabled: number;
      }>();
  } catch {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 비용 보호장치를 확인할 수 없습니다.");
  }
  if (!current) {
    throw new HttpError(503, "PHOTO_COST_GUARD_UNAVAILABLE", "사진 비용 보호장치를 확인할 수 없습니다.");
  }

  const reenablingUploads = uploadsEnabled && current.uploadsEnabled !== 1;
  const reenablingReads = readsEnabled && current.readsEnabled !== 1;
  if ((reenablingUploads || reenablingReads) && !reconciliationAcknowledged) {
    throw new HttpError(
      400,
      "PHOTO_COST_GUARD_RECONCILIATION_REQUIRED",
      "사진 비용 보호를 재개하려면 Cloudflare 사용량과 D1 원장 대조 확인이 필요합니다.",
    );
  }

  if (reenablingUploads || reenablingReads) {
    const limits = photoStorageBudgetLimits(env);
    const monthUtc = utcMonthKey(new Date(updatedAt));
    const dayUtc = utcDayKey(new Date(updatedAt));
    const blockedDimensions: string[] = [];
    if (reenablingUploads) {
      if (current.activeBytes >= limits.storageStopBytes) blockedDimensions.push("storage");
      if (current.periodUtc === monthUtc && current.writesInPeriod >= limits.monthlyWriteStopLimit) blockedDimensions.push("writes");
      if (current.transformPeriodUtc === monthUtc && current.transformsInPeriod >= limits.monthlyTransformStopLimit) {
        blockedDimensions.push("transforms");
      }
    }
    if (reenablingReads) {
      if (current.readPeriodUtc === monthUtc && current.readsInPeriod >= limits.monthlyReadStopLimit) blockedDimensions.push("monthly_reads");
      if (current.dayUtc === dayUtc && current.readsInDay >= limits.dailyReadStopLimit) blockedDimensions.push("daily_reads");
    }
    if (blockedDimensions.length > 0) {
      throw new HttpError(
        409,
        "PHOTO_COST_GUARD_RECONCILIATION_FAILED",
        "80% 안전 기준 이상인 사용량이 남아 있어 사진 비용 보호를 재개할 수 없습니다.",
        { blockedDimensions },
      );
    }
  }

  await runD1Batch(db, [
    db.prepare(
      `UPDATE photo_upload_control
       SET uploads_enabled = ?, reason = ?, updated_by = ?, updated_at = ?
       WHERE id = 1`,
    )
      .bind(uploadsEnabled ? 1 : 0, reason, updatedBy, updatedAt),
    db.prepare(
      `UPDATE photo_read_control
       SET reads_enabled = ?, reason = ?, updated_by = ?, updated_at = ?
       WHERE id = 1`,
    )
      .bind(readsEnabled ? 1 : 0, reason, updatedBy, updatedAt),
  ]);
  await recordAdminAction(
    db,
    request,
    "photo_cost_guard",
    "photo_cost_guard",
    "global",
    `uploads_enabled=${uploadsEnabled ? 1 : 0}; reads_enabled=${readsEnabled ? 1 : 0}; reconciliation_acknowledged=${reconciliationAcknowledged ? 1 : 0}; reason=${reason}`,
  );

  if (!uploadsEnabled || !readsEnabled) {
    enqueuePhotoCostAlert(ctx, env, {
      type: "cost.photo-r2.stopped",
      reason: `manual:${reason}`,
      activeBytes: null,
      storageStopBytes: null,
      writesInPeriod: null,
      monthlyWriteStopLimit: null,
    });
  }

  return getPhotoCostGuard(env);
}

function percentageOf(value: number, limit: number): number {
  if (limit <= 0) {
    return value > 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((value / limit) * 10_000) / 100);
}

async function releasePhotoStorageBytes(
  db: D1Database,
  storageKey: string,
  byteSize: number,
  now = new Date(),
): Promise<boolean> {
  const budget = await db.prepare("SELECT id FROM photo_storage_budget WHERE id = 1").first<{ id: number }>();
  if (!budget) {
    throw new HttpError(503, "PHOTO_STORAGE_BUDGET_LEDGER_MISSING", "사진 저장량 원장을 확인할 수 없습니다.");
  }

  const releasedAt = now.toISOString();
  const releaseToken = `storage_release_${crypto.randomUUID()}`;
  await runAtomicD1Batch(
    db,
    [
      db.prepare(
        `INSERT OR IGNORE INTO photo_storage_releases (storage_key, byte_size, release_token, released_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(storageKey, byteSize, releaseToken, releasedAt),
      db.prepare(
        `UPDATE photo_storage_budget
         SET active_bytes = MAX(0, active_bytes - ?), updated_at = ?
         WHERE id = 1
           AND EXISTS (
             SELECT 1 FROM photo_storage_releases
             WHERE storage_key = ? AND release_token = ?
           )`,
      ).bind(byteSize, releasedAt, storageKey, releaseToken),
    ],
    "PHOTO_STORAGE_RELEASE_ATOMICITY_REQUIRED",
    "사진 저장량 차감을 원자적으로 기록할 수 없습니다.",
  );

  const release = await db
    .prepare("SELECT storage_key AS storageKey FROM photo_storage_releases WHERE storage_key = ? AND release_token = ?")
    .bind(storageKey, releaseToken)
    .first<{ storageKey: string }>();
  return Boolean(release);
}

async function claimD1PhotoDeletion(db: D1Database, photoId: string, deletedAt: string): Promise<boolean> {
  const claimed = await db
    .prepare(
      `UPDATE photos
       SET status = 'rejected', hidden_at = ?, deleted_at = ?
       WHERE id = ? AND deleted_at IS NULL
       RETURNING id`,
    )
    .bind(deletedAt, deletedAt, photoId)
    .first<{ id: string }>();

  return Boolean(claimed);
}

function d1PhotoPersistenceStatements(
  db: D1Database,
  photo: PhotoRecord,
  imageHash: string | null,
  sanitizedPhoto: SanitizedPhoto | null,
): D1PreparedStatement[] {
  return [
    db
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
      ),
    db.prepare(`
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
        clientReportedProximity: photo.clientReportedProximity === true,
        proximityRadiusM: photo.proximityRadiusM ?? null,
        proximityAccuracyBucket: photo.proximityAccuracyBucket ?? "unknown",
        locationEvidence: photo.clientReportedProximity === true ? photoLocationEvidence : "none",
        metadataRemoved: sanitizedPhoto?.metadataRemoved ?? false,
        pixelsReencoded: sanitizedPhoto?.pixelsReencoded ?? false,
        duplicateCheck: imageHash ? "passed" : "not_available",
        malwareScan: "manual_required",
      }),
      JSON.stringify(["face_review_required", "plate_review_required", "content_safety_review_required"]),
      photo.createdAt,
      photo.createdAt,
    ),
  ];
}

async function completePhotoPayload(
  input: PhotoCompletionPayload,
  request: Request,
  session: AnonymousSession,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { uploadId, placeId } = input;
  const place = await resolvePlaceRecord(placeId, env);
  const requestedMimeType = input.mimeType;
  const requestedByteSize = input.byteSize;
  const requestedWidth = input.width;
  const requestedHeight = input.height;
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
    clientReencoded: input.clientReencoded,
    originalFilename: input.originalFilename,
  });
  const ticketSecured = await assertPhotoUploadTicket(input, session, env);
  if (env.DB && ticketSecured) {
    await claimPhotoUploadTicket(env.DB, uploadId, anonymousUserId, input.ticketExpiresAt ?? "");
  }
  const abuseReservation =
    env.DB && env.PHOTOS && ticketSecured
      ? await reservePhotoAbuseBudget(env.DB, request, requestedByteSize, env)
      : null;
  const processedPhoto = env.PHOTOS
      ? await processPhotoForR2(
        input.imageBytes ?? input.imageBase64 ?? null,
        requestedMimeType,
        requestedWidth,
        requestedHeight,
        env,
        ctx,
      )
    : null;
  const sanitizedPhoto = processedPhoto?.photo ?? null;
  const transformReservation = processedPhoto?.transformReservation ?? null;
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
    clientReportedProximity: Boolean(input.proximityRadiusM),
    proximityRadiusM: input.proximityRadiusM ?? null,
    proximityAccuracyBucket: input.proximityAccuracyBucket ?? "unknown",
    status: moderationRequired ? "pending" : "ready",
    deletedAt: null,
    createdAt: new Date().toISOString(),
  };

  let budgetReservation: PhotoStorageBudgetReservation | null = null;
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

    if (env.DB) {
      try {
        budgetReservation = await reservePhotoStorageBudget(env.DB, photo.byteSize, env);
      } catch (error) {
        if (
          error instanceof HttpError &&
          ["PHOTO_COST_GUARD_80_PERCENT_STOP", "PHOTO_STORAGE_BUDGET_EXHAUSTED", "PHOTO_MONTHLY_WRITE_BUDGET_EXHAUSTED"].includes(error.code)
        ) {
          enqueuePhotoCostAlert(ctx, env, photoCostAlertDetails(error));
        }
        throw error;
      }
      if (budgetReservation.automaticStopTriggered) {
        enqueuePhotoCostAlert(ctx, env, {
          reason: "automatic-80-percent-cost-guard",
          activeBytes: budgetReservation.activeBytes,
          storageStopBytes: budgetReservation.storageStopBytes,
          writesInPeriod: budgetReservation.writesInPeriod,
          monthlyWriteStopLimit: budgetReservation.monthlyWriteStopLimit,
        });
      }
      if (transformReservation?.automaticStopTriggered) {
        await disablePhotoUploadsForCostGuard(env.DB, "automatic-80-percent-transform-cost-guard");
        enqueuePhotoCostAlert(ctx, env, {
          reason: "automatic-80-percent-transform-cost-guard",
          activeBytes: null,
          storageStopBytes: null,
          writesInPeriod: null,
          monthlyWriteStopLimit: null,
          transformsInPeriod: transformReservation.transformsInPeriod,
          monthlyTransformStopLimit: transformReservation.monthlyTransformStopLimit,
        });
      }
    }

    try {
      await env.PHOTOS.put(result.storageKey, arrayBufferForBytes(sanitizedPhoto.bytes), {
        httpMetadata: { contentType: photo.mimeType },
        customMetadata: {
          placeId,
          uploadId,
          originalFilenameStored: "false",
          metadataRemoved: sanitizedPhoto.metadataRemoved ? "true" : "none-found",
          serverPixelReencoded: sanitizedPhoto.pixelsReencoded ? "true" : "false",
          gpsExifStripped: "true",
          clientReportedProximity: photo.clientReportedProximity ? "true" : "false",
          proximityRadiusM: photo.proximityRadiusM ? String(photo.proximityRadiusM) : "none",
          proximityAccuracyBucket: photo.proximityAccuracyBucket ?? "unknown",
          locationEvidence: photo.clientReportedProximity ? photoLocationEvidence : "none",
          processing: sanitizedPhoto.processing,
          originalBytes: String(sanitizedPhoto.originalBytes),
          sanitizedBytes: String(sanitizedPhoto.sanitizedBytes),
        },
      });

      if (env.DB) {
        await runD1Batch(env.DB, d1PhotoPersistenceStatements(env.DB, photo, imageHash, sanitizedPhoto));
      }
    } catch (error) {
      if (env.DB && budgetReservation) {
        let storageRemoved = false;
        try {
          await env.PHOTOS.delete(result.storageKey);
          storageRemoved = true;
        } catch {
          try {
            await enqueuePhotoCleanupJob(env.DB, null, result.storageKey, photo.byteSize, "upload_persist_failed");
          } catch {
            // Keep the reservation charged when cleanup cannot be proven.
          }
        }
        if (storageRemoved) {
          await releasePhotoStorageBytes(env.DB, result.storageKey, photo.byteSize);
        }
      }
      throw error;
    }
  }

  if (env.DB && !env.PHOTOS) {
    await runD1Batch(env.DB, d1PhotoPersistenceStatements(env.DB, photo, imageHash, sanitizedPhoto));
  } else if (!env.DB) {
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
      photo: photoToPublicPhoto(photo, new URL(request.url), env, anonymousUserId),
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
      photoCostGuard: budgetReservation
        ? {
            mode: "d1-atomic-free-tier-safety-ceiling",
            activeBytes: budgetReservation.activeBytes,
            storageMaxBytes: budgetReservation.storageMaxBytes,
            storageStopBytes: budgetReservation.storageStopBytes,
            periodUtc: budgetReservation.periodUtc,
            writesInPeriod: budgetReservation.writesInPeriod,
            monthlyWriteLimit: budgetReservation.monthlyWriteLimit,
            monthlyWriteStopLimit: budgetReservation.monthlyWriteStopLimit,
            stopPercent: photoCostGuardStopPercent,
            automaticStopTriggered: budgetReservation.automaticStopTriggered,
          }
        : { mode: env.PHOTOS ? "development-memory" : "r2-not-configured" },
      photoTransformGuard: transformReservation
        ? {
            mode: "d1-atomic-cloudflare-images-free-tier-safety-ceiling",
            periodUtc: transformReservation.periodUtc,
            transformsInPeriod: transformReservation.transformsInPeriod,
            monthlyTransformLimit: transformReservation.monthlyTransformLimit,
            monthlyTransformStopLimit: transformReservation.monthlyTransformStopLimit,
            stopPercent: photoCostGuardStopPercent,
            automaticStopTriggered: transformReservation.automaticStopTriggered,
          }
        : { mode: env.IMAGES ? "development-unmetered" : "images-not-configured" },
      photoAbuseGuard: abuseReservation
        ? {
            mode: "cloudflare-ip-rate-plus-d1-daily-budget",
            dayUtc: abuseReservation.dayUtc,
            uploadCount: abuseReservation.uploadCount,
            dailyUploadLimit: abuseReservation.dailyUploadLimit,
            bytesInPeriod: abuseReservation.bytesInPeriod,
            dailyBytesLimit: abuseReservation.dailyBytesLimit,
          }
        : { mode: ticketSecured ? "signed-ticket-only" : "development-unsecured" },
    },
    201,
  );
}

async function processPhotoForR2(
  image: string | Uint8Array | null,
  mimeType: PhotoRecord["mimeType"],
  width: number,
  height: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<ProcessedPhotoForR2> {
  const metadataStripped = sanitizePhotoForR2(image, mimeType);
  if (!env.IMAGES) {
    return { photo: metadataStripped, transformReservation: null };
  }

  let transformReservation: PhotoTransformBudgetReservation | null = null;
  if (env.DB) {
    try {
      transformReservation = await reservePhotoTransformBudget(env.DB, env);
    } catch (error) {
      if (
        error instanceof HttpError &&
        ["PHOTO_TRANSFORM_COST_GUARD_80_PERCENT_STOP", "PHOTO_MONTHLY_TRANSFORM_BUDGET_EXHAUSTED"].includes(error.code)
      ) {
        enqueuePhotoCostAlert(ctx, env, photoCostAlertDetails(error));
      }
      throw error;
    }
  }

  const photo = await reencodePhotoWithImagesBinding(metadataStripped, env.IMAGES, width, height);
  return { photo, transformReservation };
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

function sanitizePhotoForR2(image: string | Uint8Array | null, mimeType: PhotoRecord["mimeType"]): SanitizedPhoto {
  if (!image) {
    throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "R2 저장에는 정화할 이미지 파일이 필요합니다.");
  }

  const original = typeof image === "string" ? decodeImageBase64(image) : image;
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

  throw new HttpError(400, "PHOTO_MIME_TYPE", "WebP 또는 JPEG 사진만 업로드할 수 있습니다.");
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

async function servePhotoFile(photoId: string, request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.PHOTOS) {
    return errorResponse(404, "PHOTO_FILE_NOT_AVAILABLE", "사진 파일을 찾을 수 없습니다.");
  }

  if (env.DB) {
    await assertPhotoReadsEnabled(env.DB);
  }

  const photo = env.DB
    ? await getD1PublicRecentPhoto(env.DB, photoId)
    : photos.find((candidate) => candidate.id === photoId && candidate.status === "ready" && !candidate.deletedAt && isActiveRecentContent(candidate.createdAt));
  if (!photo) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  const cache = defaultPhotoCache();
  const cacheKey = photoFileCacheKey(photoId);
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Cache is an optimization. The atomic D1 and R2 guards remain authoritative.
    }
  }

  if (env.DB) {
    await reservePhotoReadAbuseBudget(env.DB, request, env);
    let reservation: PhotoReadBudgetReservation;
    try {
      reservation = await reservePhotoReadBudget(env.DB, env);
    } catch (error) {
      if (
        error instanceof HttpError &&
        [
          "PHOTO_READ_COST_GUARD_80_PERCENT_STOP",
          "PHOTO_MONTHLY_READ_BUDGET_EXHAUSTED",
          "PHOTO_DAILY_READ_COST_GUARD_80_PERCENT_STOP",
          "PHOTO_DAILY_READ_BUDGET_EXHAUSTED",
        ].includes(error.code)
      ) {
        const details = isRecord(error.details) ? error.details : {};
        const reason =
          error.code === "PHOTO_MONTHLY_READ_BUDGET_EXHAUSTED"
            ? "automatic-monthly-read-hard-cap"
            : error.code === "PHOTO_DAILY_READ_BUDGET_EXHAUSTED"
              ? "automatic-daily-read-hard-cap"
              : error.code === "PHOTO_DAILY_READ_COST_GUARD_80_PERCENT_STOP"
                ? "automatic-80-percent-daily-read-cost-guard"
                : "automatic-80-percent-monthly-read-cost-guard";
        enqueuePhotoCostAlert(ctx, env, {
          type: "cost.photo-reads.stopped",
          reason,
          activeBytes: null,
          storageStopBytes: null,
          writesInPeriod: null,
          monthlyWriteStopLimit: null,
          readsInPeriod: finiteNumberOrNull(details.readsInPeriod),
          monthlyReadStopLimit: finiteNumberOrNull(details.monthlyReadStopLimit ?? details.monthlyReadLimit),
          readsInDay: finiteNumberOrNull(details.readsInDay),
          dailyReadStopLimit: finiteNumberOrNull(details.dailyReadStopLimit ?? details.dailyReadLimit),
        });
      }
      throw error;
    }
    if (reservation.automaticStopTriggered) {
      enqueuePhotoCostAlert(ctx, env, {
        type: "cost.photo-reads.stopped",
        reason: reservation.automaticStopReason ?? "automatic-80-percent-read-cost-guard",
        activeBytes: null,
        storageStopBytes: null,
        writesInPeriod: null,
        monthlyWriteStopLimit: null,
        readsInPeriod: reservation.readsInPeriod,
        monthlyReadStopLimit: reservation.monthlyReadStopLimit,
        readsInDay: reservation.readsInDay,
        dailyReadStopLimit: reservation.dailyReadStopLimit,
      });
    }
  }

  const object = await env.PHOTOS.get(photo.storageKey);
  if (!object) {
    return errorResponse(404, "PHOTO_FILE_NOT_FOUND", "사진 파일을 찾을 수 없습니다.");
  }

  const response = new Response(object.body, {
    headers: {
      ...corsHeaders(),
      "content-type": object.httpMetadata?.contentType ?? photo.mimeType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });

  if (cache) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  }

  return response;
}

function defaultPhotoCache(): WorkerCache | null {
  const runtime = globalThis as unknown as { caches?: { default?: WorkerCache } };
  return runtime.caches?.default ?? null;
}

function photoFileCacheKey(photoId: string): Request {
  return new Request(`https://silsigan-photo-cache.invalid/v1/${encodeURIComponent(photoId)}`, { method: "GET" });
}

async function deletePhoto(photoId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const photo = await getD1OwnedPhoto(env.DB, photoId);
    if (!photo) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    if (photo.anonymousUserId !== anonymousUserId) {
      return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
    }

    const deletedAt = new Date().toISOString();
    if (!(await claimD1PhotoDeletion(env.DB, photoId, deletedAt))) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    let storageDeleted = !env.PHOTOS;
    let cleanupQueued = false;
    let budgetReleased = false;
    if (env.PHOTOS) {
      try {
        await env.PHOTOS.delete(photo.storageKey);
        storageDeleted = true;
        budgetReleased = await releasePhotoStorageBytes(env.DB, photo.storageKey, photo.byteSize);
      } catch {
        try {
          await enqueuePhotoCleanupJob(env.DB, photo.id, photo.storageKey, photo.byteSize, "user_delete");
          cleanupQueued = true;
        } catch {
          throw new HttpError(503, "PHOTO_STORAGE_CLEANUP_REQUIRED", "사진 삭제 후 저장소 정리를 예약하지 못했습니다.");
        }
      }
    }

    return json(
      { photoId, deleted: true, storageDeleted, cleanupQueued, budgetReleased },
      { storage: "d1", deletionPolicy: cleanupQueued ? "hidden-now-r2-cleanup-queued" : "hidden-and-r2-delete-attempted" },
      cleanupQueued ? 202 : 200,
    );
  }

  const photo = photos.find((candidate) => candidate.id === photoId);
  if (!photo || photo.deletedAt) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  if (photo.anonymousUserId !== session.id) {
    return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
  }

  photo.deletedAt = new Date().toISOString();
  let storageDeleted = !env.PHOTOS;
  if (env.PHOTOS) {
    await env.PHOTOS.delete(photo.storageKey);
    storageDeleted = true;
  }

  return json({ photoId, deleted: true, storageDeleted, cleanupQueued: false });
}

async function enqueuePhotoCleanupJob(
  db: D1Database,
  photoId: string | null,
  storageKey: string,
  byteSize: number,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO photo_cleanup_jobs
        (id, photo_id, storage_key, byte_size, reason, status, attempts, next_attempt_at,
         last_error_code, completed_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'pending', 0, ?, 'R2_DELETE_FAILED', NULL, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM photo_cleanup_jobs WHERE storage_key = ?
       )`,
    )
    .bind(`photo_cleanup_${crypto.randomUUID()}`, photoId, storageKey, byteSize, reason, now, now, now, storageKey)
    .run();
}

async function createPublicReport(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  if (isModerationReportBody(body)) {
    return createModerationReportFromBody(body, session, env, ctx);
  }

  return createFieldReportFromBody(body, session, env);
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
        moderation_status AS moderationStatus,
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
  if (report.moderationStatus !== "approved") {
    throw new HttpError(409, "FIELD_REPORT_NOT_PUBLIC", "검수가 끝난 공개 제보에만 상태 확인 투표를 할 수 있습니다.");
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
  const locationVerification = await verifyFieldReportLocation(place, optionalClientLocationField(body), env);
  const locationVerified = locationVerification.verificationMethod !== "none";
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
  const claimedRequest = await db
    .prepare(
      `INSERT INTO account_deletion_requests
        (id, actor_type, anonymous_user_id, profile_id, status, requested_at)
       SELECT ?, ?, ?, ?, 'processing', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM account_deletion_requests
         WHERE anonymous_user_id = ? AND status IN ('processing', 'completed')
       )
       RETURNING id`,
    )
    .bind(requestId, actorType, anonymousUserId, linkedProfile?.id ?? null, requestedAt, anonymousUserId)
    .first<{ id: string }>();
  if (!claimedRequest) {
    const existingRequest = await db
      .prepare(
        `SELECT status FROM account_deletion_requests
         WHERE anonymous_user_id = ? AND status IN ('processing', 'completed')
         ORDER BY requested_at DESC
         LIMIT 1`,
      )
      .bind(anonymousUserId)
      .first<{ status: "processing" | "completed" }>();
    if (existingRequest?.status === "completed") {
      return json({ deleted: true, actorType: "anonymous", alreadyCompleted: true }, { storage: "d1" });
    }
    throw new HttpError(409, "ACCOUNT_DELETION_IN_PROGRESS", "계정 삭제가 이미 진행 중입니다.");
  }

  try {
    const { results: photoRows = [] } = await db
      .prepare("SELECT r2_key AS storageKey, byte_size AS byteSize FROM photos WHERE anonymous_user_id = ? AND deleted_at IS NULL")
      .bind(anonymousUserId)
      .all<{ storageKey: string; byteSize: number }>();
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
      try {
        await env.PHOTOS.delete(photoRows.map((photo) => photo.storageKey));
        for (const photo of photoRows) {
          await releasePhotoStorageBytes(db, photo.storageKey, photo.byteSize);
        }
      } catch {
        for (const photo of photoRows) {
          await enqueuePhotoCleanupJob(db, null, photo.storageKey, photo.byteSize, "account_deletion");
        }
        throw new HttpError(503, "PHOTO_STORAGE_CLEANUP_REQUIRED", "계정 삭제 후 사진 저장소 정리를 예약했습니다. 잠시 후 다시 확인해 주세요.");
      }
    }
    await db.prepare("DELETE FROM report_votes WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM likes WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM user_blocks WHERE blocker_anonymous_user_id = ? OR blocked_anonymous_user_id = ?").bind(anonymousUserId, anonymousUserId).run();
    await db.prepare("DELETE FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM identity_links WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
    await db.prepare("DELETE FROM consents WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM terms_acceptances WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM saved_places WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM saved_posts WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM followed_topics WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM notification_subscriptions WHERE actor_identity_key = ?").bind(`anonymous:${anonymousUserId}`).run();
    await db.prepare("DELETE FROM place_addition_requests WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
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
    if (anonymousSessionBindingRequired(env)) {
      await revokeAnonymousSessionRecord(session, env);
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

async function createFieldReportFromBody(body: JsonObject, session: AnonymousSession, env: Env): Promise<Response> {
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
  const photoIds = photoIdsField(body, "photoIds", 4);
  const hashtagNames = hashtagNamesField(body, "hashtagNames", 5);
  const clientRequestId = optionalClientRequestIdField(body, "clientRequestId");
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
    const existing = clientRequestId
      ? await findD1FieldReportPublicationByRequestId(env.DB, anonymousUserId, clientRequestId)
      : null;
    if (existing) {
      if (existing.placeId !== place.id) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청 식별자를 다른 장소에 다시 사용할 수 없습니다.");
      }
      return json(existing.response, {
        storage: "d1",
        contractVersion: 3,
        idempotentReplay: true,
        moderationStatus: existing.response.report.moderationStatus,
      });
    }
    await validateD1FieldReportPublicationPhotos(env.DB, photoIds, anonymousUserId, place.id);
  } else if (clientRequestId) {
    const existing = fieldReportPublicationResponses.get(`${anonymousUserId}:${clientRequestId}`);
    if (existing) {
      if (existing.placeId !== place.id) {
        throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청 식별자를 다른 장소에 다시 사용할 수 없습니다.");
      }
      return json(existing.response, {
        storage: "memory-fallback",
        contractVersion: 3,
        idempotentReplay: true,
        moderationStatus: existing.response.report.moderationStatus,
      });
    }
    validateMemoryFieldReportPublicationPhotos(photoIds, anonymousUserId, place.id);
  }

  const locationVerification = await verifyFieldReportLocation(place, clientLocation, env);
  const verifiedRadiusM = locationVerification.verifiedRadiusM;
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
    verificationMethod: locationVerification.verificationMethod,
    accuracyBucket: locationAccuracyBucketForMeters(clientLocation?.accuracyM),
    moderationStatus: "pending",
    createdAt,
    expiresAt,
    hasPhoto: Boolean(photoUrl) || photoIds.length > 0,
  };
  const publication: FieldReportPublication = { clientRequestId, photoIds, hashtagNames };
  const response = fieldReportResponse(report, publication);

  if (env.DB) {
    try {
      await persistD1FieldReportAggregate(env.DB, place, report, publication, comment ?? null, response);
    } catch (error) {
      const replay = clientRequestId
        ? await findD1FieldReportPublicationByRequestId(env.DB, anonymousUserId, clientRequestId)
        : null;
      if (replay && replay.placeId === place.id) {
        return json(replay.response, {
          storage: "d1",
          contractVersion: 3,
          idempotentReplay: true,
          moderationStatus: replay.response.report.moderationStatus,
        });
      }
      throw error;
    }
    await recomputeD1PlaceStatus(env.DB, place.id, new Date(createdAt));
    return json(response, { ...fieldReportMeta("d1", report), contractVersion: 3 }, 201);
  }

  fieldReports.unshift(report);
  liveSignals.unshift(...liveSignalsForFieldReport(report));
  fieldReportPublicationsByReportId.set(report.id, publication);
  if (clientRequestId) {
    fieldReportPublicationResponses.set(`${anonymousUserId}:${clientRequestId}`, { placeId: place.id, response });
  }
  return json(response, { ...fieldReportMeta("memory-fallback", report), contractVersion: 3 }, 201);
}

async function findD1FieldReportPublicationByRequestId(
  db: D1Database,
  anonymousUserId: string,
  clientRequestId: string,
): Promise<{ placeId: string; response: FieldReportPublicationResponse } | null> {
  const row = await db
    .prepare(
      `SELECT place_id AS placeId, response_json AS responseJson
       FROM field_report_publications
       WHERE anonymous_user_id = ? AND client_request_id = ?
       LIMIT 1`,
    )
    .bind(anonymousUserId, clientRequestId)
    .first<{ placeId: string; responseJson: string }>();
  if (!row) {
    return null;
  }

  try {
    return { placeId: row.placeId, response: JSON.parse(row.responseJson) as FieldReportPublicationResponse };
  } catch {
    throw new HttpError(503, "PUBLICATION_REPLAY_UNAVAILABLE", "이전 제보 결과를 안전하게 복구하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

async function validateD1FieldReportPublicationPhotos(
  db: D1Database,
  photoIds: readonly string[],
  anonymousUserId: string,
  placeId: string,
): Promise<void> {
  if (photoIds.length === 0) {
    return;
  }

  const placeholders = photoIds.map(() => "?").join(", ");
  const { results = [] } = await db
    .prepare(
      `SELECT
        p.id,
        p.place_id AS placeId,
        p.anonymous_user_id AS anonymousUserId,
        p.status,
        p.deleted_at AS deletedAt,
        p.hidden_at AS hiddenAt,
        frm.report_id AS linkedReportId
       FROM photos p
       LEFT JOIN field_report_media frm ON frm.photo_id = p.id
       WHERE p.id IN (${placeholders})`,
    )
    .bind(...photoIds)
    .all<{ id: string; placeId: string; anonymousUserId: string; status: PhotoRecord["status"]; deletedAt: string | null; hiddenAt: string | null; linkedReportId: string | null }>();
  const byId = new Map(results.map((photo) => [photo.id, photo]));
  const valid = photoIds.every((photoId) => {
    const photo = byId.get(photoId);
    return Boolean(
      photo &&
      photo.placeId === placeId &&
      photo.anonymousUserId === anonymousUserId &&
      photo.status !== "rejected" &&
      !photo.deletedAt &&
      !photo.hiddenAt,
    );
  });
  if (!valid) {
    throw new HttpError(400, "PUBLICATION_PHOTO_INVALID", "이 장소에 직접 올린 활성 사진만 제보에 연결할 수 있습니다.");
  }
  if (photoIds.some((photoId) => Boolean(byId.get(photoId)?.linkedReportId))) {
    throw new HttpError(409, "PUBLICATION_PHOTO_ALREADY_LINKED", "이미 다른 제보에 연결된 사진은 다시 사용할 수 없습니다.");
  }
}

function validateMemoryFieldReportPublicationPhotos(photoIds: readonly string[], anonymousUserId: string, placeId: string): void {
  const alreadyLinked = photoIds.some((photoId) =>
    [...fieldReportPublicationResponses.values()].some((entry) => entry.response.publication?.photoIds.includes(photoId)),
  );
  if (alreadyLinked) {
    throw new HttpError(409, "PUBLICATION_PHOTO_ALREADY_LINKED", "이미 다른 제보에 연결된 사진은 다시 사용할 수 없습니다.");
  }
  const valid = photoIds.every((photoId) => {
    const photo = photos.find((candidate) => candidate.id === photoId);
    return Boolean(photo && photo.placeId === placeId && photo.anonymousUserId === anonymousUserId && photo.status !== "rejected" && !photo.deletedAt);
  });
  if (!valid) {
    throw new HttpError(400, "PUBLICATION_PHOTO_INVALID", "이 장소에 직접 올린 활성 사진만 제보에 연결할 수 있습니다.");
  }
}

async function persistD1FieldReportAggregate(
  db: D1Database,
  place: PlaceRecord,
  report: FieldReportRecord,
  publication: FieldReportPublication,
  comment: string | null,
  response: FieldReportPublicationResponse,
): Promise<void> {
  const eventOptions: D1PlaceEventOptions = {
    id: report.id,
    source: "field_report",
    crowdLevel: report.crowdLevel,
    lineStatus: report.lineStatus,
    parkingStatus: report.parkingStatus,
    verifiedRadiusM: report.verifiedRadiusM,
    verificationMethod: report.verificationMethod,
    accuracyBucket: report.accuracyBucket,
    moderationStatus: report.moderationStatus,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
  };
  const statements = [
    d1PlaceEventInsertStatement(db, place, report.anonymousUserId, "report", eventOptions),
    ...d1HourlyAggregateStatements(db, place, "report", report.createdAt),
    ...liveSignalsForFieldReport(report).map((signal) => d1LiveSignalInsertStatement(db, signal, report.anonymousUserId)),
    ...d1FieldReportPublicationStatements(db, report, publication, comment, response),
  ];
  await runD1Batch(db, statements);
}

function d1FieldReportPublicationStatements(
  db: D1Database,
  report: FieldReportRecord,
  publication: FieldReportPublication,
  comment: string | null,
  response: FieldReportPublicationResponse,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [db
    .prepare(
      `INSERT INTO field_report_publications
        (report_id, place_id, anonymous_user_id, client_request_id, comment, response_json, moderation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      report.id,
      report.placeId,
      report.anonymousUserId,
      publication.clientRequestId,
      comment,
      JSON.stringify(response),
      report.moderationStatus,
      report.createdAt,
      report.createdAt,
    )];

  for (const [position, photoId] of publication.photoIds.entries()) {
    statements.push(db
      .prepare("INSERT INTO field_report_media (report_id, photo_id, position, created_at) VALUES (?, ?, ?, ?)")
      .bind(report.id, photoId, position, report.createdAt));
  }
  for (const [position, hashtagName] of publication.hashtagNames.entries()) {
    statements.push(db
      .prepare(
        `INSERT INTO hashtags (name, tag_type, moderation_status, post_count, last_post_at, created_at, updated_at)
         VALUES (?, ?, 'approved', 1, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           post_count = hashtags.post_count + 1,
           last_post_at = excluded.last_post_at,
           updated_at = excluded.updated_at`,
      )
      .bind(hashtagName, classifyHashtag(hashtagName), report.createdAt, report.createdAt, report.createdAt));
    statements.push(db
      .prepare("INSERT INTO field_report_hashtags (report_id, hashtag_name, position, created_at) VALUES (?, ?, ?, ?)")
      .bind(report.id, hashtagName, position, report.createdAt));
  }
  return statements;
}

async function runD1Batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    await statement.run();
  }
}

async function runAtomicD1Batch(
  db: D1Database,
  statements: D1PreparedStatement[],
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  if (!db.batch) {
    throw new HttpError(503, errorCode, errorMessage);
  }

  await db.batch(statements);
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
    accuracyM: optionalAccuracyField(value, "accuracyM"),
  };
}

async function verifyFieldReportLocation(
  place: PlaceRecord,
  clientLocation: ClientLocation | null,
  env: Env,
): Promise<ReturnType<typeof verifyFieldLocation>> {
  const context = await resolvePlaceVerificationContext(place, env);
  const result = verifyFieldLocation(
    clientLocation
      ? {
          latitude: clientLocation.latitude,
          longitude: clientLocation.longitude,
        }
      : null,
    clientLocation?.accuracyM ?? null,
    context,
  );

  if (result.reason === "outside_radius") {
    throw new HttpError(400, "LOCATION_NOT_VERIFIED", "장소 인증 반경 밖에서는 현장 인증 제보를 만들 수 없습니다.");
  }

  if (result.reason === "outside_polygon") {
    throw new HttpError(400, "LOCATION_NOT_VERIFIED", "장소 인증 구역 밖에서는 현장 인증 제보를 만들 수 없습니다.");
  }

  return result;
}

async function resolvePlaceVerificationContext(place: PlaceRecord, env: Env): Promise<PlaceVerificationContext> {
  const fallback: PlaceVerificationContext = {
    placeKind: "POINT",
    center: { latitude: place.latitude, longitude: place.longitude },
    geometry: null,
    verificationRadiusM: null,
  };
  if (!env.DB) {
    return fallback;
  }

  const row = await env.DB
    .prepare(
      `SELECT
        place_kind AS placeKind,
        geometry_json AS geometryJson,
        verification_radius_m AS verificationRadiusM
       FROM place_metadata
       WHERE place_id = ?
       LIMIT 1`,
    )
    .bind(place.id)
    .first<D1PlaceVerificationRow>();
  if (!row) {
    return fallback;
  }

  const placeKinds: VerificationPlaceKind[] = ["POINT", "AREA", "ROUTE", "FACILITY_GROUP"];
  if (!placeKinds.includes(row.placeKind)) {
    throw new HttpError(503, "PLACE_VERIFICATION_NOT_CONFIGURED", "장소 인증 설정을 확인할 수 없습니다.");
  }

  let geometry = null;
  if (row.geometryJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.geometryJson);
    } catch {
      throw new HttpError(503, "PLACE_VERIFICATION_GEOMETRY_INVALID", "장소 인증 구역 설정을 확인할 수 없습니다.");
    }
    geometry = parseVerificationGeometry(parsed);
    if (!geometry) {
      throw new HttpError(503, "PLACE_VERIFICATION_GEOMETRY_INVALID", "장소 인증 구역 설정을 확인할 수 없습니다.");
    }
  }

  return {
    placeKind: row.placeKind,
    center: fallback.center,
    geometry,
    verificationRadiusM: row.verificationRadiusM,
  };
}

function fieldReportResponse(report: FieldReportRecord, publication?: FieldReportPublication): {
  report: ReturnType<typeof publicFieldReport>;
  credits: FieldReportCredit[];
  safetyWarning: string | null;
  privacyNotice: string;
  publication?: FieldReportPublication;
} {
  return {
    report: publicFieldReport(report, publication),
    credits: fieldReportCredits(report),
    safetyWarning: fieldReportSafetyWarning(report.category),
    privacyNotice: "클라이언트 좌표와 원본 정확도는 반경 검증에만 사용되며 D1·응답·분석에 저장하지 않습니다. 공개 응답에는 정확도 구간만 포함합니다.",
    ...(publication ? { publication } : {}),
  };
}

function publicFieldReport(report: FieldReportRecord, publication?: FieldReportPublication): PublicFieldReportRecord {
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
    verificationMethod: report.verificationMethod,
    accuracyBucket: report.accuracyBucket,
    moderationStatus: report.moderationStatus,
    photoIds: publication?.photoIds ?? [],
    hashtagNames: publication?.hashtagNames ?? [],
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
    verificationMethod: report.verificationMethod,
    accuracyBucket: report.accuracyBucket,
    moderationStatus: report.moderationStatus,
    photoIds: parseFieldReportJoinedValues(report.photoIds),
    hashtagNames: parseFieldReportJoinedValues(report.hashtagNames),
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
  };
}

function adminD1FieldReport(report: D1FieldReportRow) {
  return {
    ...publicD1FieldReport(report),
    placeName: report.placeName ?? report.placeId,
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
  const verified = report.verificationMethod !== "none";
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
    isPubliclyVisible: report.moderationStatus === "approved",
    evidenceType: "user_report",
    evidenceId: report.id,
    metadata: {
      actorKey: report.anonymousUserId,
      verifiedRadiusM: report.verifiedRadiusM,
      verificationMethod: report.verificationMethod,
    },
  }));
}

function d1LiveSignalInsertStatement(db: D1Database, candidate: LiveSignal, actorId: string): D1PreparedStatement {
  const signal = validateLiveSignal(candidate);
  return db
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
      signal.expiresAt,
      signal.confidenceScore,
      signal.isEstimated ? 1 : 0,
      signal.isPubliclyVisible ? 1 : 0,
      signal.evidenceType ?? null,
      signal.evidenceId ?? null,
      actorId,
      `${signal.evidenceId}:${signal.dimension}:${signal.id}`,
      JSON.stringify(signal.metadata ?? {}),
    );
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
  return publicPost(post, await resolvePlaceRecord(post.placeId, env), env);
}

function publicPost(post: PostRecord, place: PlaceRecord, env?: Env) {
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
    shareCard: buildPostShareCard(post, place, undefined, env),
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

function postSubmitResponse(post: PostRecord, place: PlaceRecord, recommendedHashtags: string[], env?: Env) {
  return {
    post: publicPost(post, place, env),
    credits: postCredits(post),
    recommendedHashtags,
    safetyWarning: placeSafetyWarning(place.categoryId),
    privacyNotice: "정확한 좌표는 저장하지 않고 장소 반경 검증 결과만 남깁니다.",
  };
}

function publicPostUserId(postId: string): string {
  return `public_${postId}`;
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

type HashtagQueryOptions = {
  name: string;
  regionId: string | null;
  placeId: string | null;
  hasPhoto: boolean;
  activeOnly: boolean;
  cursor: string | null;
  limit: number;
};

async function listD1PostsForHashtags(
  db: D1Database,
  options: Pick<HashtagQueryOptions, "name" | "regionId" | "placeId" | "hasPhoto">,
): Promise<PostRecord[]> {
  const where = ["po.status = 'visible'", "po.hidden_at IS NULL", "pl.is_active = 1", "pl.coordinate_status = 'verified'"];
  const values: D1Value[] = [];
  if (options.name) {
    where.push("po.hashtag_names LIKE ?");
    values.push(`%\"${options.name}\"%`);
  }
  if (options.regionId) {
    where.push("pl.region_id = ?");
    values.push(options.regionId);
  }
  if (options.placeId) {
    where.push("po.place_id = ?");
    values.push(options.placeId);
  }
  if (options.hasPhoto) {
    where.push("po.photo_count > 0");
  }

  const { results = [] } = await db
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
      JOIN places pl ON pl.id = po.place_id
      WHERE ${where.join(" AND ")}
      ORDER BY po.created_at DESC
      LIMIT 500`,
    )
    .bind(...values)
    .all<D1PostRow>();

  return results.map(d1PostRowToRecord);
}

async function listD1FieldReportHashtags(db: D1Database, options: HashtagQueryOptions): Promise<HashtagRecord[]> {
  const where = [
    "fp.moderation_status = 'approved'",
    "pe.moderation_status = 'approved'",
    "h.moderation_status = 'approved'",
    "pl.is_active = 1",
    "pl.coordinate_status = 'verified'",
    "ph.status = 'ready'",
    "ph.hidden_at IS NULL",
    "ph.deleted_at IS NULL",
  ];
  const values: D1Value[] = [];
  if (options.activeOnly) {
    where.push(`pe.expires_at > ${D1_NOW_SQL}`);
  }
  if (options.name) {
    where.push("h.name = ?");
    values.push(options.name);
  }
  if (options.regionId) {
    where.push("pl.region_id = ?");
    values.push(options.regionId);
  }
  if (options.placeId) {
    where.push("pe.place_id = ?");
    values.push(options.placeId);
  }
  if (!options.hasPhoto) {
    return [];
  }

  const { results = [] } = await db
    .prepare(
      `SELECT
        h.name,
        h.tag_type AS tagType,
        COUNT(DISTINCT pe.id) AS postCount,
        MIN(pe.created_at) AS createdAt,
        MAX(pe.created_at) AS latestObservedAt,
        COUNT(DISTINCT pe.place_id) AS activePlaceCount,
        COUNT(DISTINCT ph.id) AS recentPhotoCount
       FROM field_report_hashtags frh
       JOIN hashtags h ON h.name = frh.hashtag_name
       JOIN field_report_publications fp ON fp.report_id = frh.report_id
       JOIN place_events pe ON pe.id = fp.report_id
       JOIN places pl ON pl.id = pe.place_id
       JOIN field_report_media fm ON fm.report_id = pe.id
       JOIN photos ph ON ph.id = fm.photo_id
       WHERE ${where.join(" AND ")}
       GROUP BY h.name, h.tag_type
       ORDER BY latestObservedAt DESC, h.name ASC
       LIMIT 500`,
    )
    .bind(...values)
    .all<{
      name: string;
      tagType: HashtagRecord["tagType"];
      postCount: number;
      createdAt: string;
      latestObservedAt: string;
      activePlaceCount: number;
      recentPhotoCount: number;
    }>();

  if (!options.name || results.length === 0) {
    return results.map((row) => ({
      id: `hashtag_${row.name}`,
      ...row,
      recentMedia: [],
      nextCursor: null,
    }));
  }

  const cursor = parseHashtagMediaCursor(options.cursor);
  const mediaWhere = [...where, "frh.hashtag_name = ?"];
  const mediaValues: D1Value[] = [...values, options.name];
  if (cursor) {
    mediaWhere.push("(pe.created_at < ? OR (pe.created_at = ? AND pe.id < ?))");
    mediaValues.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  mediaValues.push(options.limit + 1);
  const { results: mediaRows = [] } = await db
    .prepare(
      `SELECT
        pe.id,
        pe.place_id AS placeId,
        pe.category,
        pe.created_at AS createdAt,
        pe.expires_at AS expiresAt,
        COALESCE((
          SELECT GROUP_CONCAT(fm2.photo_id, ',' ORDER BY fm2.position)
          FROM field_report_media fm2
          JOIN photos ph2 ON ph2.id = fm2.photo_id
          WHERE fm2.report_id = pe.id
            AND ph2.status = 'ready'
            AND ph2.hidden_at IS NULL
            AND ph2.deleted_at IS NULL
        ), '') AS photoIds,
        COALESCE((
          SELECT GROUP_CONCAT(frh2.hashtag_name, ',' ORDER BY frh2.position)
          FROM field_report_hashtags frh2
          JOIN hashtags h2 ON h2.name = frh2.hashtag_name
          WHERE frh2.report_id = pe.id AND h2.moderation_status = 'approved'
        ), '') AS hashtagNames
       FROM field_report_hashtags frh
       JOIN hashtags h ON h.name = frh.hashtag_name
       JOIN field_report_publications fp ON fp.report_id = frh.report_id
       JOIN place_events pe ON pe.id = fp.report_id
       JOIN places pl ON pl.id = pe.place_id
       JOIN field_report_media fm ON fm.report_id = pe.id
       JOIN photos ph ON ph.id = fm.photo_id
       WHERE ${mediaWhere.join(" AND ")}
       GROUP BY pe.id
       ORDER BY pe.created_at DESC, pe.id DESC
       LIMIT ?`,
    )
    .bind(...mediaValues)
    .all<{ id: string; placeId: string; category: string; createdAt: string; expiresAt: string; photoIds: string; hashtagNames: string }>();
  const hasNextPage = mediaRows.length > options.limit;
  const pageRows = mediaRows.slice(0, options.limit);
  const recentMedia = pageRows.map<HashtagRecentMediaRecord>((row) => ({
    id: row.id,
    placeId: row.placeId,
    category: row.category,
    moderationStatus: "approved",
    photoIds: parseFieldReportJoinedValues(row.photoIds),
    hashtagNames: parseFieldReportJoinedValues(row.hashtagNames),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
  const last = hasNextPage ? pageRows.at(-1) : undefined;

  return results.map((row) => ({
    id: `hashtag_${row.name}`,
    ...row,
    recentMedia,
    nextCursor: last ? `${last.createdAt}|${last.id}` : null,
  }));
}

function listMemoryFieldReportHashtags(options: HashtagQueryOptions): HashtagRecord[] {
  if (!options.hasPhoto) {
    return [];
  }

  const now = Date.now();
  const cursor = parseHashtagMediaCursor(options.cursor);
  const eligibleReports = fieldReports
    .filter((report) => report.moderationStatus === "approved")
    .filter((report) => !options.activeOnly || Date.parse(report.expiresAt) > now)
    .filter((report) => !options.placeId || report.placeId === options.placeId)
    .filter((report) => !options.regionId || findPlaceRecord(report.placeId).regionId === options.regionId)
    .map((report) => ({ report, publication: fieldReportPublicationsByReportId.get(report.id) }))
    .filter((entry) => entry.publication?.photoIds.some((photoId) => {
      const photo = photos.find((candidate) => candidate.id === photoId);
      return Boolean(photo && photo.status === "ready" && !photo.deletedAt);
    }))
    .filter((entry) => !options.name || entry.publication?.hashtagNames.includes(options.name));
  const names = options.name
    ? [options.name]
    : [...new Set(eligibleReports.flatMap((entry) => entry.publication?.hashtagNames ?? []))];

  return names.map((name) => {
    const matching = eligibleReports.filter((entry) => entry.publication?.hashtagNames.includes(name));
    const ordered = [...matching].sort((left, right) =>
      right.report.createdAt.localeCompare(left.report.createdAt) || right.report.id.localeCompare(left.report.id));
    const afterCursor = cursor
      ? ordered.filter(({ report }) => report.createdAt < cursor.createdAt || (report.createdAt === cursor.createdAt && report.id < cursor.id))
      : ordered;
    const page = options.name ? afterCursor.slice(0, options.limit + 1) : [];
    const hasNextPage = page.length > options.limit;
    const visiblePage = page.slice(0, options.limit);
    const latestObservedAt = ordered[0]?.report.createdAt ?? null;
    const photoIds = new Set(matching.flatMap((entry) => entry.publication?.photoIds ?? []));
    const last = hasNextPage ? visiblePage.at(-1)?.report : undefined;

    return {
      id: `hashtag_${name}`,
      name,
      tagType: classifyHashtag(name),
      postCount: matching.length,
      createdAt: ordered.at(-1)?.report.createdAt ?? latestObservedAt ?? new Date(0).toISOString(),
      latestObservedAt,
      activePlaceCount: new Set(matching.map((entry) => entry.report.placeId)).size,
      recentPhotoCount: photoIds.size,
      recentMedia: visiblePage.map(({ report, publication }) => ({
        id: report.id,
        placeId: report.placeId,
        category: report.category,
        moderationStatus: "approved" as const,
        photoIds: publication?.photoIds ?? [],
        hashtagNames: publication?.hashtagNames ?? [],
        createdAt: report.createdAt,
        expiresAt: report.expiresAt,
      })),
      nextCursor: last ? `${last.createdAt}|${last.id}` : null,
    };
  }).filter((record) => record.postCount > 0);
}

function hashtagBooleanParam(value: string | null, fallback: boolean, field: string): boolean {
  if (value === null || value === "") {
    return fallback;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new HttpError(400, "HASHTAG_FILTER_INVALID", `${field} 필터가 올바르지 않습니다.`);
}

function parseHashtagMediaCursor(value: string | null): { createdAt: string; id: string } | null {
  if (!value) {
    return null;
  }
  const separatorIndex = value.lastIndexOf("|");
  const createdAt = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);
  if (separatorIndex <= 0 || !id || !Number.isFinite(Date.parse(createdAt))) {
    throw new HttpError(400, "HASHTAG_CURSOR_INVALID", "해시태그 사진 페이지 위치가 올바르지 않습니다.");
  }
  return { createdAt, id };
}

function mergeHashtagRecords(records: readonly HashtagRecord[]): HashtagRecord[] {
  const merged = new Map<string, HashtagRecord>();
  for (const record of records) {
    const current = merged.get(record.name);
    merged.set(record.name, {
      ...record,
      postCount: (current?.postCount ?? 0) + record.postCount,
      createdAt: current && current.createdAt < record.createdAt ? current.createdAt : record.createdAt,
      latestObservedAt:
        current?.latestObservedAt && record.latestObservedAt
          ? (current.latestObservedAt > record.latestObservedAt ? current.latestObservedAt : record.latestObservedAt)
          : current?.latestObservedAt ?? record.latestObservedAt,
      activePlaceCount: (current?.activePlaceCount ?? 0) + record.activePlaceCount,
      recentPhotoCount: (current?.recentPhotoCount ?? 0) + record.recentPhotoCount,
      recentMedia: record.recentMedia.length > 0 ? record.recentMedia : current?.recentMedia ?? [],
      nextCursor: record.nextCursor ?? current?.nextCursor ?? null,
    });
  }
  return [...merged.values()].sort((left, right) => right.postCount - left.postCount || left.name.localeCompare(right.name, "ko"));
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
    latestObservedAt: createdAt,
    activePlaceCount: 0,
    recentPhotoCount: 0,
    recentMedia: [],
    nextCursor: null,
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

type SharePostInput = Pick<
  PostRecord,
  | "crowdLevel"
  | "parkingStatus"
  | "lineStatus"
  | "photoCount"
  | "weatherFeel"
  | "hashtagNames"
  | "createdAt"
  | "caption"
  | "locationVerified"
>;

function buildPostShareCard(post: SharePostInput, place: PlaceRecord, status?: PlaceStatusData, env?: Env): ShareCardRecord {
  const statusText = [crowdStatusLabel(post.crowdLevel), `주차 ${parkingStatusLabel(post.parkingStatus)}`, `줄 ${lineStatusLabel(post.lineStatus)}`].join(" · ");
  const hasLiveStatus = status?.dataMode === "live";
  const statusLabel = shareStatusLabel(status?.status ?? "insufficient");
  const sourceNames = hasLiveStatus ? [...new Set(status?.currentSignals.map((signal) => signal.sourceName) ?? [])].slice(0, 3) : [];
  const observedText = status?.observedAt ? `${minutesAgoLabel(status.observedAt)} 관측` : "현재 관측시각 없음";
  const evidenceText = hasLiveStatus
    ? `현재 판단: ${statusLabel} · 현재 근거 ${status?.currentSignals.length ?? 0}개 · ${observedText}`
    : "현재 판단: 정보 부족 · 승인된 현재 상태 근거 없음";
  const sourceText = sourceNames.length > 0 ? `출처: ${sourceNames.join(", ")}` : "출처: 현재 공개 가능한 근거 없음";
  const reportType = post.locationVerified ? "현장 인증 제보" : "사용자 제보";

  return {
    headline: hasLiveStatus ? `${place.name} ${statusLabel}` : `${place.name} 현장 제보`,
    body: `${evidenceText}\n${sourceText}\n${minutesAgoLabel(post.createdAt)} ${reportType}\n제보 내용: ${statusText}\n${post.caption ?? "지금 현장 상태를 확인해 보세요."}`,
    url: `${resolvePublicSiteUrl(env)}/place/${place.id}`,
    hashtags: post.hashtagNames.slice(0, 5),
    variant: "neutral",
  };
}

function resolvePublicSiteUrl(env?: Env) {
  const configuredUrl = env?.SILSIGAN_PUBLIC_SITE_URL?.trim();
  if (!configuredUrl) {
    return defaultPublicSiteUrl;
  }

  try {
    const parsed = new URL(configuredUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || isLocalHost) {
      return defaultPublicSiteUrl;
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return defaultPublicSiteUrl;
  }
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

function shareStatusLabel(status: PlaceStatusData["status"]): string {
  if (status === "likely_good") return "방문 전 확인하면 무난할 가능성";
  if (status === "check_before_visit") return "방문 전 확인 필요";
  if (status === "likely_crowded") return "혼잡할 가능성";
  return "현재 정보 부족";
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

function parseFieldReportJoinedValues(value: string | null | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
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
  if (report.verificationMethod !== "none") {
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
    verifiedLocation: report.verificationMethod !== "none",
    verificationMethod: report.verificationMethod,
    accuracyPolicy: "accuracyM-required-for-verification;-low-or-missing-falls-back-to-unverified",
    accuracyBucket: report.accuracyBucket,
    moderationStatus: report.moderationStatus,
  };
}

async function listFieldReports(url: URL, session: AnonymousSession, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const regionId = url.searchParams.get("regionId") ?? url.searchParams.get("region");
  const mine = url.searchParams.get("mine") === "1";
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

    if (mine) {
      where.push("anonymous_user_id = ?");
      values.push(await ensureD1AnonymousUser(env.DB, session));
    } else {
      where.push("moderation_status = 'approved'");
      where.push(`expires_at > ${D1_NOW_SQL}`);
    }

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
          verification_method AS verificationMethod,
          accuracy_bucket AS accuracyBucket,
          moderation_status AS moderationStatus,
          COALESCE((
            SELECT GROUP_CONCAT(fm.photo_id, ',' ORDER BY fm.position)
            FROM field_report_media fm
            JOIN photos ph ON ph.id = fm.photo_id
            WHERE fm.report_id = place_events.id
              AND ph.status = 'ready'
              AND ph.hidden_at IS NULL
              AND ph.deleted_at IS NULL
          ), '') AS photoIds,
          COALESCE((
            SELECT GROUP_CONCAT(frh.hashtag_name, ',' ORDER BY frh.position)
            FROM field_report_hashtags frh
            JOIN hashtags h ON h.name = frh.hashtag_name
            WHERE frh.report_id = place_events.id
              AND h.moderation_status = 'approved'
          ), '') AS hashtagNames,
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
      mine,
      includeExpired: mine,
      storage: "d1",
      privacy: "clientLocation and photoUrl are not persisted in place_events or returned",
    });
  }

  const now = new Date();
  const data = fieldReports
    .filter((report) => !placeId || report.placeId === placeId)
    .filter((report) => !regionId || findPlaceRecord(report.placeId).regionId === regionId)
    .filter((report) => (mine ? report.anonymousUserId === session.id : report.moderationStatus === "approved"))
    .filter((report) => mine || new Date(report.expiresAt).getTime() > now.getTime())
    .slice(0, limit)
    .map((report) => publicFieldReport(report, fieldReportPublicationsByReportId.get(report.id)));

  return json(data, {
    limit,
    mine,
    includeExpired: mine,
    storage: "memory-fallback",
    privacy: "clientLocation and photoUrl are not persisted in field report responses",
  });
}

async function listFieldReportModerationQueue(url: URL, env: Env): Promise<Response> {
  const db = requireD1(env);
  const requestedStatus = url.searchParams.get("status");
  const statuses: FieldReportModerationStatus[] = ["pending", "approved", "rejected", "hidden"];
  if (requestedStatus && !statuses.includes(requestedStatus as FieldReportModerationStatus)) {
    throw new HttpError(400, "VALIDATION_ERROR", "status 값이 올바르지 않습니다.");
  }

  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);
  const where = ["e.event_type = 'report'", "e.source = 'field_report'"];
  const values: D1Value[] = [];
  if (requestedStatus) {
    where.push("e.moderation_status = ?");
    values.push(requestedStatus);
  }
  values.push(limit);

  const { results = [] } = await db
    .prepare(
      `SELECT
        e.id,
        e.place_id AS placeId,
        p.name AS placeName,
        e.category,
        e.crowd_level AS crowdLevel,
        e.line_status AS lineStatus,
        e.parking_status AS parkingStatus,
        e.verified_radius_m AS verifiedRadiusM,
        e.verification_method AS verificationMethod,
        e.accuracy_bucket AS accuracyBucket,
        e.moderation_status AS moderationStatus,
        e.created_at AS createdAt,
        e.expires_at AS expiresAt
      FROM place_events e
      JOIN places p ON p.id = e.place_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE e.moderation_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        e.created_at DESC
      LIMIT ?`,
    )
    .bind(...values)
    .all<D1FieldReportRow>();

  return json(results.map(adminD1FieldReport), {
    limit,
    status: requestedStatus ?? "all",
    authz: "moderator-role",
    storage: "d1",
    privacy: "anonymous reporter identity is not returned",
  });
}

async function moderateFieldReport(reportId: string, request: Request, env: Env): Promise<Response> {
  const db = requireD1(env);
  if (!/^field_report_[a-zA-Z0-9-]{8,100}$/.test(reportId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "reportId 값이 올바르지 않습니다.");
  }

  const body = await readJson(request);
  const status = enumField(body, "status", ["approved", "rejected", "hidden"] as const);
  const reason = moderationReasonField(body);
  const report = await db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        moderation_status AS moderationStatus,
        expires_at AS expiresAt
      FROM place_events
      WHERE id = ? AND event_type = 'report' AND source = 'field_report'
      LIMIT 1`,
    )
    .bind(reportId)
    .first<Pick<D1FieldReportEventRow, "id" | "placeId" | "moderationStatus" | "expiresAt">>();
  if (!report) {
    throw new HttpError(404, "FIELD_REPORT_NOT_FOUND", "현장 제보를 찾을 수 없습니다.");
  }

  const now = new Date().toISOString();
  const publicVisible = status === "approved" ? 1 : 0;
  const action: AdminActionType =
    status === "approved" ? "field_report_approved" : status === "rejected" ? "field_report_rejected" : "field_report_hidden";
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE place_events SET moderation_status = ? WHERE id = ?").bind(status, report.id),
    db
      .prepare("UPDATE live_signals SET is_publicly_visible = ? WHERE evidence_type = 'user_report' AND evidence_id = ?")
      .bind(publicVisible, report.id),
    db
      .prepare(
        `UPDATE field_report_publications
         SET moderation_status = ?,
             response_json = json_set(response_json, '$.report.moderationStatus', ?),
             updated_at = ?
         WHERE report_id = ?`,
      )
      .bind(status, status, now, report.id),
    db
      .prepare(
        `INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at)
         VALUES (?, ?, ?, 'field_report', ?, ?, ?)`,
      )
      .bind(`admin_${crypto.randomUUID()}`, adminSubject(request), action, report.id, reason, now),
  ];

  if (status === "approved" && report.moderationStatus !== "approved") {
    statements.push(
      db
        .prepare(
          `INSERT INTO publication_outbox (
             id, aggregate_type, aggregate_id, event_type, payload_json,
             status, attempts, available_at, created_at, updated_at
           ) VALUES (?, 'field_report', ?, 'field_report.created', ?, 'pending', 0, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             payload_json = excluded.payload_json,
             status = 'pending',
             attempts = 0,
             available_at = excluded.available_at,
             lease_token = NULL,
             lease_expires_at = NULL,
             last_error_code = NULL,
             published_at = NULL,
             dead_lettered_at = NULL,
             updated_at = excluded.updated_at
           WHERE publication_outbox.status IN ('published', 'failed')`,
        )
        .bind(
          `outbox_field_report_${report.id}`,
          report.id,
          JSON.stringify({ reportId: report.id, placeId: report.placeId }),
          now,
          now,
          now,
        ),
    );
  }

  await runAtomicD1Batch(
    db,
    statements,
    "FIELD_REPORT_MODERATION_ATOMICITY_REQUIRED",
    "현장 제보 검수 상태와 실시간 발행 기록을 원자적으로 저장할 수 없습니다.",
  );
  await recomputeD1PlaceStatus(db, report.placeId, new Date(now));

  const updated = await db
    .prepare(
      `SELECT
        e.id,
        e.place_id AS placeId,
        p.name AS placeName,
        e.category,
        e.crowd_level AS crowdLevel,
        e.line_status AS lineStatus,
        e.parking_status AS parkingStatus,
        e.verified_radius_m AS verifiedRadiusM,
        e.verification_method AS verificationMethod,
        e.accuracy_bucket AS accuracyBucket,
        e.moderation_status AS moderationStatus,
        e.created_at AS createdAt,
        e.expires_at AS expiresAt
      FROM place_events e
      JOIN places p ON p.id = e.place_id
      WHERE e.id = ?
      LIMIT 1`,
    )
    .bind(report.id)
    .first<D1FieldReportRow>();
  if (!updated) {
    throw new HttpError(500, "FIELD_REPORT_UPDATE_FAILED", "현장 제보 상태를 확인하지 못했습니다.");
  }

  return json(adminD1FieldReport(updated), {
    status,
    previousStatus: report.moderationStatus,
    authz: "moderator-role",
    auditPolicy: "admin_actions",
    storage: "d1",
    expiresAt: report.expiresAt,
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
  const reason = moderationReasonField(body);

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
      byte_size AS byteSize,
      status,
      deleted_at AS deletedAt
    FROM photos
    WHERE id = ?
  `).bind(photoId).first<{
    id: string;
    placeId: string;
    anonymousUserId: string;
    storageKey: string;
    byteSize: number;
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
  let cleanupQueued = false;
  if (decision === "rejected") {
    if (!(await claimD1PhotoDeletion(db, photo.id, now))) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }
    if (env.PHOTOS) {
      try {
        await env.PHOTOS.delete(photo.storageKey);
        r2Deleted = true;
        await releasePhotoStorageBytes(db, photo.storageKey, photo.byteSize);
      } catch {
        try {
          await enqueuePhotoCleanupJob(db, photo.id, photo.storageKey, photo.byteSize, "moderation_rejected");
          cleanupQueued = true;
        } catch {
          throw new HttpError(503, "PHOTO_STORAGE_CLEANUP_REQUIRED", "거절된 사진의 저장소 정리를 예약하지 못했습니다.");
        }
      }
    }
  } else {
    const approved = await db
      .prepare("UPDATE photos SET status = 'ready', hidden_at = NULL WHERE id = ? AND deleted_at IS NULL RETURNING id")
      .bind(photo.id)
      .first<{ id: string }>();
    if (!approved) {
      return errorResponse(409, "PHOTO_FILE_REMOVED", "삭제된 사진은 승인할 수 없습니다.");
    }
  }
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
    cleanupQueued,
  }, {
    authz: "moderator-role",
    auditPolicy: "admin_actions",
    storage: "d1",
  }, cleanupQueued ? 202 : 200);
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
  let cleanupQueued = false;
  const deletingPhoto = action === "delete" && targetType === "photo";
  if (deletingPhoto) {
    const storageKey = target.storageKey;
    if (!storageKey || !(await claimD1PhotoDeletion(env.DB, targetId, new Date().toISOString()))) {
      return errorResponse(404, "MODERATION_TARGET_NOT_FOUND", "운영 조치 대상을 찾을 수 없습니다.");
    }
    if (env.PHOTOS) {
      try {
        await env.PHOTOS.delete(storageKey);
        r2Deleted = true;
        await releasePhotoStorageBytes(env.DB, storageKey, target.byteSize);
      } catch {
        try {
          await enqueuePhotoCleanupJob(env.DB, targetId, storageKey, target.byteSize, "admin_delete");
          cleanupQueued = true;
        } catch {
          throw new HttpError(503, "PHOTO_STORAGE_CLEANUP_REQUIRED", "삭제된 사진의 저장소 정리를 예약하지 못했습니다.");
        }
      }
    }
  } else {
    await applyD1ModerationAction(env.DB, targetType, targetId, action, reason);
  }
  await recordAdminAction(env.DB, request, action, targetType, targetId, reason);
  const cacheInvalidation = await invalidateModerationCache(env, targetType, targetId, target);

  return json(
    {
      targetType,
      targetId,
      action,
      r2Deleted,
      cleanupQueued,
    },
    {
      auditPolicy: "admin_actions",
      storage: "d1",
      r2Policy: deletingPhoto ? "hide-first-delete-r2-with-idempotent-release-ledger" : "not-applicable",
      cacheInvalidation,
    },
    cleanupQueued ? 202 : 200,
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

  return routeRealtimeRoom(request, env, url, path);
}

async function routeRealtimeRoom(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const pathMatch = path.match(/^\/api\/realtime\/(place|region|global)(?:\/([^/]+))?$/);
  if (!pathMatch && path !== "/api/realtime") {
    return errorResponse(404, "NOT_FOUND", "라우트를 찾을 수 없습니다.");
  }
  const scope = pathMatch
    ? (pathMatch[1] as "place" | "region" | "global")
    : enumFromSearch(url, "scope", ["place", "region", "global"] as const, "global");
  const roomId = pathMatch?.[2] ? safelyDecodeRealtimeRoomId(pathMatch[2]) : url.searchParams.get("roomId") ?? (scope === "global" ? "global" : "");
  if (!roomId) {
    return errorResponse(400, "ROOM_ID_REQUIRED", "실시간 roomId가 필요합니다.");
  }
  await assertRealtimeRoomAvailable(scope, roomId, env);

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

function safelyDecodeRealtimeRoomId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "ROOM_ID_INVALID", "실시간 roomId 형식이 올바르지 않습니다.");
  }
}

async function assertRealtimeRoomAvailable(scope: RoomBroadcast["scope"], roomId: string, env: Env): Promise<void> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(roomId)) {
    throw new HttpError(400, "ROOM_ID_INVALID", "실시간 roomId 형식이 올바르지 않습니다.");
  }

  if (scope === "global") {
    if (roomId !== "global") {
      throw new HttpError(404, "ROOM_NOT_FOUND", "실시간 채널을 찾을 수 없습니다.");
    }
    return;
  }

  if (scope === "place") {
    await resolvePlaceRecord(roomId, env);
    return;
  }

  if (!env.DB) {
    if (!seedPlaces.some((place) => place.regionId === roomId)) {
      throw new HttpError(404, "ROOM_NOT_FOUND", "실시간 채널을 찾을 수 없습니다.");
    }
    return;
  }

  const region = await env.DB
    .prepare("SELECT id FROM regions WHERE id = ? AND is_active = 1 LIMIT 1")
    .bind(roomId)
    .first<{ id: string }>();
  if (!region) {
    throw new HttpError(404, "ROOM_NOT_FOUND", "실시간 채널을 찾을 수 없습니다.");
  }
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
  const key = `${scope}:${anonymousUserId}:${await clientIpHint(request)}`;
  const { result, capacityExceeded } = applyBoundedSlidingWindowRateLimit({
    buckets: rateBuckets,
    key,
    nowMs: Date.now(),
    limit,
    windowMs,
    capacity: rateBucketCapacity,
  });

  if (!result.allowed) {
    throw new HttpError(429, capacityExceeded ? "RATE_LIMIT_CAPACITY_REACHED" : "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

async function getAnonymousSession(
  request: Request,
  env: Env,
  proofRequired: boolean,
  forceBinding = false,
): Promise<AnonymousSession> {
  const headerId = request.headers.get("x-silsigan-anon-id")?.trim();
  const cookieId = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("silsigan_anon_id="))
    ?.split("=")[1];
  const candidate = headerId || cookieId;

  if (!forceBinding && !anonymousSessionBindingRequired(env)) {
    if (candidate && /^[a-zA-Z0-9_-]{12,80}$/.test(candidate)) {
      return { id: candidate, isNew: false, verified: true };
    }

    return { id: `anon_${crypto.randomUUID()}`, isNew: true, verified: true };
  }

  const proof = request.headers.get("x-silsigan-anon-proof")?.trim() ?? "";
  if (!candidate && !proof) {
    if (proofRequired) {
      throw new HttpError(401, "ANONYMOUS_SESSION_REQUIRED", "익명 세션을 먼저 발급해 주세요.");
    }

    return { id: `anon_public_${crypto.randomUUID()}`, isNew: false, verified: false };
  }

  if (!candidate || !/^[a-zA-Z0-9_-]{12,80}$/.test(candidate)) {
    throw new HttpError(401, "ANONYMOUS_SESSION_ID_REQUIRED", "올바른 익명 세션 ID가 필요합니다.");
  }

  if (!proof) {
    throw new HttpError(401, "ANONYMOUS_SESSION_PROOF_REQUIRED", "익명 세션 증명값이 필요합니다.");
  }

  if (!/^[a-zA-Z0-9_-]{43}$/.test(proof)) {
    throw new HttpError(403, "ANONYMOUS_SESSION_PROOF_INVALID", "익명 세션 증명값이 올바르지 않습니다.");
  }

  const db = requireD1(env);
  const session = { id: candidate, isNew: false, verified: true } satisfies AnonymousSession;
  const sessionHash = await anonymousSessionHash(session);
  const stored = await db
    .prepare(
      `SELECT proof_hash AS proofHash, status, expires_at AS expiresAt, last_seen_at AS lastSeenAt
       FROM anonymous_sessions
       WHERE session_hash = ?
       LIMIT 1`,
    )
    .bind(sessionHash)
    .first<D1AnonymousSessionRow>();
  const providedProofHash = await anonymousSessionProofHash(proof);

  if (!stored || !(await timingSafeEqualString(providedProofHash, stored.proofHash))) {
    throw new HttpError(403, "ANONYMOUS_SESSION_PROOF_INVALID", "익명 세션 증명값이 올바르지 않습니다.");
  }

  if (stored.status === "revoked") {
    throw new HttpError(403, "ANONYMOUS_SESSION_REVOKED", "폐기된 익명 세션입니다.");
  }

  if (!Number.isFinite(Date.parse(stored.expiresAt)) || Date.parse(stored.expiresAt) <= Date.now()) {
    throw new HttpError(403, "ANONYMOUS_SESSION_EXPIRED", "만료된 익명 세션입니다.");
  }

  const now = new Date();
  const lastSeenAtMs = Date.parse(stored.lastSeenAt);
  if (!Number.isFinite(lastSeenAtMs) || lastSeenAtMs <= now.getTime() - oneDayMs) {
    await db
      .prepare("UPDATE anonymous_sessions SET last_seen_at = ? WHERE session_hash = ? AND last_seen_at = ?")
      .bind(now.toISOString(), sessionHash, stored.lastSeenAt)
      .run();
  }

  return session;
}

function requiresVerifiedAnonymousSession(request: Request, url: URL, path: string): boolean {
  if (path.startsWith("/api/admin/")) {
    return false;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return true;
  }

  if (path === "/api/preferences" || path === "/api/my-questions" || path === "/api/blocks") {
    return true;
  }

  if (path === "/api/place-requests") {
    return url.searchParams.get("mine") === "1";
  }

  return path === "/api/reports" && url.searchParams.get("mine") === "1";
}

function anonymousSessionBindingRequired(env: Env): boolean {
  const configured = env.SILSIGAN_ANON_SESSION_REQUIRED?.trim();
  if (configured === "0") {
    return false;
  }
  return configured === "1" || isProductionEnvironment(env);
}

async function issueAnonymousSession(env: Env): Promise<Response> {
  const db = requireD1(env);
  const now = new Date();
  await reserveAnonymousSessionIssuanceBudget(db, env, now);
  const session = { id: `anon_${crypto.randomUUID()}`, isNew: true, verified: true } satisfies AnonymousSession;
  const proof = randomAnonymousSessionProof();
  const sessionHash = await anonymousSessionHash(session);
  const proofHash = await anonymousSessionProofHash(proof);
  const expiresAt = new Date(now.getTime() + 365 * oneDayMs).toISOString();

  await db
    .prepare(
      `INSERT INTO anonymous_sessions (
         session_hash, proof_hash, status, expires_at, created_at, last_seen_at, rotated_at, revoked_at
       ) VALUES (?, ?, 'active', ?, ?, ?, NULL, NULL)`,
    )
    .bind(sessionHash, proofHash, expiresAt, now.toISOString(), now.toISOString())
    .run();

  return json({ anonymousId: session.id, proof, expiresAt }, { contractVersion: 1 }, 201);
}

async function reserveAnonymousSessionIssuanceBudget(
  db: D1Database,
  env: Env,
  now: Date,
): Promise<void> {
  const dayUtc = utcDayKey(now);
  const updatedAt = now.toISOString();
  const dailyLimit = boundedFreeTierLimit(
    env.SILSIGAN_ANON_SESSION_DAILY_LIMIT,
    anonymousSessionDailyFreeSafetyCeiling,
  );
  let reservation: D1AnonymousSessionIssuanceBudgetRow | null;

  try {
    reservation = await db
      .prepare(
        `INSERT INTO anonymous_session_issuance_budget (day_utc, issue_count, updated_at)
         SELECT ?, 1, ?
         WHERE 1 <= ?
         ON CONFLICT(day_utc) DO UPDATE SET
           issue_count = anonymous_session_issuance_budget.issue_count + 1,
           updated_at = excluded.updated_at
         WHERE anonymous_session_issuance_budget.issue_count + 1 <= ?
         RETURNING issue_count AS issueCount`,
      )
      .bind(dayUtc, updatedAt, dailyLimit, dailyLimit)
      .first<D1AnonymousSessionIssuanceBudgetRow>();
  } catch {
    throw new HttpError(
      503,
      "ANONYMOUS_SESSION_COST_GUARD_UNAVAILABLE",
      "익명 세션 비용 보호장치를 사용할 수 없습니다.",
    );
  }

  if (reservation) {
    return;
  }

  let current: D1AnonymousSessionIssuanceBudgetRow | null;
  try {
    current = await db
      .prepare(
        `SELECT issue_count AS issueCount
         FROM anonymous_session_issuance_budget
         WHERE day_utc = ?`,
      )
      .bind(dayUtc)
      .first<D1AnonymousSessionIssuanceBudgetRow>();
  } catch {
    throw new HttpError(
      503,
      "ANONYMOUS_SESSION_COST_GUARD_UNAVAILABLE",
      "익명 세션 비용 보호장치를 사용할 수 없습니다.",
    );
  }

  const issueCount = current?.issueCount ?? 0;
  if (issueCount >= dailyLimit) {
    throw new HttpError(
      429,
      "ANONYMOUS_SESSION_DAILY_LIMIT_EXHAUSTED",
      "오늘 허용된 익명 세션 발급 횟수에 도달했습니다.",
      { dayUtc, issueCount, dailyLimit },
    );
  }

  throw new HttpError(
    503,
    "ANONYMOUS_SESSION_COST_GUARD_UNAVAILABLE",
    "익명 세션 비용 보호장치를 사용할 수 없습니다.",
  );
}

async function rotateAnonymousSession(session: AnonymousSession, env: Env): Promise<Response> {
  const db = requireD1(env);
  const proof = randomAnonymousSessionProof();
  const proofHash = await anonymousSessionProofHash(proof);
  const sessionHash = await anonymousSessionHash(session);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * oneDayMs).toISOString();

  await db
    .prepare(
      `UPDATE anonymous_sessions
       SET proof_hash = ?, expires_at = ?, last_seen_at = ?, rotated_at = ?, revoked_at = NULL, status = 'active'
       WHERE session_hash = ? AND status = 'active'`,
    )
    .bind(proofHash, expiresAt, now.toISOString(), now.toISOString(), sessionHash)
    .run();

  return json({ anonymousId: session.id, proof, expiresAt }, { contractVersion: 1 });
}

async function revokeAnonymousSession(session: AnonymousSession, env: Env): Promise<Response> {
  const revokedAt = await revokeAnonymousSessionRecord(session, env);
  return json({ revoked: true, revokedAt });
}

async function revokeAnonymousSessionRecord(session: AnonymousSession, env: Env): Promise<string> {
  const db = requireD1(env);
  const sessionHash = await anonymousSessionHash(session);
  const revokedAt = new Date().toISOString();

  await db
    .prepare(
      `UPDATE anonymous_sessions
       SET status = 'revoked', revoked_at = ?, last_seen_at = ?
       WHERE session_hash = ? AND status = 'active'`,
    )
    .bind(revokedAt, revokedAt, sessionHash)
    .run();

  return revokedAt;
}

function randomAnonymousSessionProof(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function anonymousSessionProofHash(proof: string): Promise<string> {
  return `sha256:${await sha256Hex(`silsigan-anon-proof:${proof}`)}`;
}

function sessionHeadersFor(session: AnonymousSession, env: Env): Headers {
  const headers = new Headers();
  if (anonymousSessionBindingRequired(env)) {
    if (session.verified) {
      headers.set("x-silsigan-anon-id", session.id);
    }
    return headers;
  }

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
       ON CONFLICT(session_hash) DO NOTHING`,
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

async function getD1OwnedPhoto(db: D1Database, photoId: string): Promise<D1PhotoRow | null> {
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
      WHERE id = ? AND deleted_at IS NULL
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
    return { exists: Boolean(row), storageKey: null, byteSize: 0, placeId: row?.id ?? null, regionId: row?.regionId ?? null };
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
    return { exists: Boolean(row), storageKey: null, byteSize: 0, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
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
    return { exists: Boolean(row), storageKey: null, byteSize: 0, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
  }

  const row = await db
    .prepare(
      `SELECT ph.id, ph.place_id AS placeId, p.region_id AS regionId, ph.r2_key AS storageKey, ph.byte_size AS byteSize
       FROM photos ph
       LEFT JOIN places p ON p.id = ph.place_id
       WHERE ph.id = ? AND ph.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(targetId)
    .first<{ id: string; placeId: string; regionId: string | null; storageKey: string; byteSize: number }>();
  return {
    exists: Boolean(row),
    storageKey: row?.storageKey ?? null,
    byteSize: row?.byteSize ?? 0,
    placeId: row?.placeId ?? null,
    regionId: row?.regionId ?? null,
  };
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
  targetType: ReportRecord["targetType"] | "anonymous_user" | "data_source" | "field_report" | "photo_cost_guard" | "place_request",
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
         AND expires_at > ${D1_NOW_SQL}
         AND (event_type != 'report' OR source != 'field_report' OR moderation_status = 'approved')`,
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
         AND expires_at > ${D1_NOW_SQL}
         AND (event_type != 'report' OR source != 'field_report' OR moderation_status = 'approved')`,
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
  await d1PlaceEventInsertStatement(db, place, anonymousUserId, eventType, options).run();
  const createdAt = options.createdAt ?? new Date().toISOString();
  await runD1Batch(db, d1HourlyAggregateStatements(db, place, eventType, createdAt));
}

function d1PlaceEventInsertStatement(
  db: D1Database,
  place: PlaceRecord,
  anonymousUserId: string,
  eventType: "click" | "like" | "comment" | "photo" | "report",
  options: D1PlaceEventOptions = {},
): D1PreparedStatement {
  const now = new Date();
  const createdAt = options.createdAt ?? now.toISOString();
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + REPORT_TTL_MS).toISOString();
  const eventId = options.id ?? `event_${crypto.randomUUID()}`;
  const source = options.source ?? "worker_api";
  return db
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
          accuracy_bucket,
          verification_method,
          moderation_status,
          created_at,
          expires_at
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      options.accuracyBucket ?? "unknown",
      options.verificationMethod ?? "none",
      options.moderationStatus ?? "approved",
      createdAt,
      expiresAt,
    );
}

function d1HourlyAggregateStatements(
  db: D1Database,
  place: PlaceRecord,
  eventType: "click" | "like" | "comment" | "photo" | "report",
  createdAt: string,
): D1PreparedStatement[] {
  const hourBucket = createdAt.slice(0, 13) + ":00:00.000Z";
  const nextHourBucket = new Date(new Date(hourBucket).getTime() + 60 * 60 * 1000).toISOString();
  const column = `${eventType}_count`;
  return [db
    .prepare(
      `INSERT INTO place_event_hourly
        (id, place_id, region_code, area_code, category, hour_bucket, ${column}, unique_user_count)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)
       ON CONFLICT(place_id, hour_bucket) DO UPDATE SET
         ${column} = ${column} + 1,
         unique_user_count = unique_user_count + 1`,
    )
    .bind(`hour_${crypto.randomUUID()}`, place.id, place.regionId, place.areaId, place.categoryId, hourBucket),
  db
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
    .bind(place.id, hourBucket, nextHourBucket, place.id, hourBucket)];
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

type PhotoCostAlertDetails = Pick<
  PhotoCostAlertPayload,
  "reason" | "activeBytes" | "storageStopBytes" | "writesInPeriod" | "monthlyWriteStopLimit"
> &
  Partial<
    Pick<
      PhotoCostAlertPayload,
      | "type"
      | "transformsInPeriod"
      | "monthlyTransformStopLimit"
      | "readsInPeriod"
      | "monthlyReadStopLimit"
      | "readsInDay"
      | "dailyReadStopLimit"
    >
  >;

function photoCostAlertDetails(error: HttpError): PhotoCostAlertDetails {
  const details = isRecord(error.details) ? error.details : {};
  const reason =
    error.code === "PHOTO_STORAGE_BUDGET_EXHAUSTED"
      ? "automatic-storage-hard-cap"
      : error.code === "PHOTO_MONTHLY_WRITE_BUDGET_EXHAUSTED"
        ? "automatic-monthly-write-hard-cap"
        : error.code === "PHOTO_MONTHLY_TRANSFORM_BUDGET_EXHAUSTED"
          ? "automatic-monthly-transform-hard-cap"
          : error.code === "PHOTO_TRANSFORM_COST_GUARD_80_PERCENT_STOP"
            ? "automatic-80-percent-transform-cost-guard"
        : "automatic-80-percent-cost-guard";
  return {
    reason,
    activeBytes: finiteNumberOrNull(details.activeBytes),
    storageStopBytes: finiteNumberOrNull(details.storageStopBytes ?? details.storageMaxBytes),
    writesInPeriod: finiteNumberOrNull(details.writesInPeriod),
    monthlyWriteStopLimit: finiteNumberOrNull(details.monthlyWriteStopLimit ?? details.monthlyWriteLimit),
    transformsInPeriod: finiteNumberOrNull(details.transformsInPeriod),
    monthlyTransformStopLimit: finiteNumberOrNull(details.monthlyTransformStopLimit ?? details.monthlyTransformLimit),
    readsInPeriod: null,
    monthlyReadStopLimit: null,
    readsInDay: null,
    dailyReadStopLimit: null,
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function enqueuePhotoCostAlert(ctx: ExecutionContext, env: Env, details: PhotoCostAlertDetails): "webhook" | "none" {
  if (!env.COST_ALERT_WEBHOOK_URL?.trim()) {
    return "none";
  }

  ctx.waitUntil(sendPhotoCostAlert(env, details).catch(() => undefined));
  return "webhook";
}

async function sendPhotoCostAlert(env: Env, details: PhotoCostAlertDetails): Promise<void> {
  const rawUrl = env.COST_ALERT_WEBHOOK_URL?.trim();
  if (!rawUrl) {
    return;
  }

  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new HttpError(503, "COST_ALERT_WEBHOOK_INVALID", "비용 보호 알림 webhook은 HTTPS만 허용합니다.");
  }

  const headers = new Headers({ "content-type": "application/json" });
  const token = env.COST_ALERT_WEBHOOK_TOKEN?.trim();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const payload: PhotoCostAlertPayload = {
    type: details.type ?? "cost.photo-uploads.stopped",
    reason: details.reason,
    activeBytes: details.activeBytes,
    storageStopBytes: details.storageStopBytes,
    writesInPeriod: details.writesInPeriod,
    monthlyWriteStopLimit: details.monthlyWriteStopLimit,
    transformsInPeriod: details.transformsInPeriod ?? null,
    monthlyTransformStopLimit: details.monthlyTransformStopLimit ?? null,
    readsInPeriod: details.readsInPeriod ?? null,
    monthlyReadStopLimit: details.monthlyReadStopLimit ?? null,
    readsInDay: details.readsInDay ?? null,
    dailyReadStopLimit: details.dailyReadStopLimit ?? null,
    environment: env.ENVIRONMENT ?? "development",
    stopPercent: photoCostGuardStopPercent,
    guardPath: "/api/admin/photo-cost-guard",
    createdAt: new Date().toISOString(),
  };
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new HttpError(502, "COST_ALERT_WEBHOOK_FAILED", "비용 보호 알림 webhook 전송에 실패했습니다.");
  }
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

async function readJson(request: Request, maxBytes = jsonRequestBodyMaxBytes): Promise<JsonObject> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON 요청만 지원합니다.");
  }

  const bytes = await readBoundedRequestBytes(request, maxBytes, {
    code: "JSON_BODY_TOO_LARGE",
    message: "JSON 요청 크기가 허용 한도를 초과했습니다.",
  });

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "JSON 객체가 필요합니다.");
  }
  if (!isRecord(body)) {
    throw new HttpError(400, "INVALID_JSON", "JSON 객체가 필요합니다.");
  }

  return body;
}

async function readBoundedRequestBytes(
  request: Request,
  maxBytes: number,
  tooLargeError: { code: string; message: string },
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new HttpError(400, "CONTENT_LENGTH_INVALID", "요청 크기 정보가 올바르지 않습니다.");
    }
    if (parsedLength > maxBytes) {
      throw new HttpError(413, tooLargeError.code, tooLargeError.message);
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new HttpError(413, tooLargeError.code, tooLargeError.message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function formStringField(formData: FormData, field: string, maxLength: number): string {
  const value = formData.get(field);
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function formOptionalStringField(formData: FormData, field: string, maxLength: number): string | undefined {
  const value = formData.get(field);
  if (value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function formNumberField(formData: FormData, field: string): number {
  const value = formStringField(formData, field, 40);
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return number;
}

function formOptionalPhotoVerifiedRadiusField(
  formData: FormData,
  field: string,
): 50 | 150 | 300 | null {
  const value = formOptionalStringField(formData, field, 3);
  if (value === undefined) {
    return null;
  }
  const radius = Number(value);
  if (radius !== 50 && radius !== 150 && radius !== 300) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return radius;
}

function formOptionalPhotoAccuracyBucketField(
  formData: FormData,
  field: string,
): LocationAccuracyBucket {
  const value = formOptionalStringField(formData, field, 10) ?? "unknown";
  if (!photoLocationAccuracyBuckets.includes(value as LocationAccuracyBucket)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return value as LocationAccuracyBucket;
}

function formBooleanField(formData: FormData, field: string): boolean {
  const value = formStringField(formData, field, 5);
  if (value !== "true" && value !== "false") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value === "true";
}

function stringField(body: JsonObject, field: string, maxLength: number): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function moderationReasonField(body: JsonObject): string {
  const reason = stringField(body, "reason", 300);
  if (reason.length < 5) {
    throw new HttpError(400, "MODERATION_REASON_REQUIRED", "운영 조치 사유를 5자 이상 입력해 주세요.");
  }
  return reason;
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

function photoIdsField(body: JsonObject, field: string, maxItems: number): string[] {
  const value = body[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  const photoIds = value.map((item) => {
    if (typeof item !== "string" || !/^photo_[a-zA-Z0-9-]{8,100}$/.test(item)) {
      throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
    }
    return item;
  });
  return [...new Set(photoIds)];
}

function optionalClientRequestIdField(body: JsonObject, field: string): string | null {
  const value = optionalStringField(body, field, 100);
  if (!value) {
    return null;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,99}$/.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
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

function optionalPhotoVerifiedRadiusField(
  body: JsonObject,
  field: string,
): 50 | 150 | 300 | null {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== 50 && value !== 150 && value !== 300) {
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

function optionalAccuracyField(body: JsonObject, field: string): number | null {
  const value = body[field];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) {
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
  const webSocket = (response as Response & { webSocket?: WorkerWebSocket }).webSocket;

  if (webSocket) {
    return createWebSocketResponse(webSocket, {
      status: response.status,
      statusText: response.statusText,
      headers,
      webSocket,
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withLegacyPhotoContractHeaders(response: Response, sessionHeaders: Headers, successorPath: string): Response {
  const headers = new Headers(sessionHeaders);
  headers.set("deprecation", "true");
  headers.set("link", `<${successorPath}>; rel="successor-version"`);
  headers.set("x-silsigan-photo-contract", "legacy");
  return withHeaders(response, headers);
}

function corsHeaders(request?: Request, env: Env = {}): Record<string, string> {
  const origin = request?.headers.get("origin")?.trim();
  const allowOrigin = isProductionEnvironment(env) && origin ? origin : "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-silsigan-anon-id,x-silsigan-anon-proof,x-silsigan-admin-token,x-silsigan-admin-subject",
    "access-control-expose-headers": "x-silsigan-anon-id",
    ...(allowOrigin === "*" ? {} : { vary: "Origin" }),
  };
}

function assertAllowedBrowserOrigin(request: Request, env: Env): void {
  if (!isProductionEnvironment(env)) {
    return;
  }

  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    return;
  }

  const allowedOrigins = configuredApiAllowedOrigins(env);
  if (allowedOrigins.size === 0) {
    throw new HttpError(503, "ORIGIN_POLICY_REQUIRED", "운영 API 브라우저 출처 정책이 설정되지 않았습니다.");
  }

  if (!allowedOrigins.has(origin)) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "허용되지 않은 브라우저 출처입니다.");
  }
}

function configuredApiAllowedOrigins(env: Env): Set<string> {
  const values = env.SILSIGAN_API_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return new Set(values.filter(isValidApiOrigin));
}

function isValidApiOrigin(value: string): boolean {
  if (value === "*" || value.includes("/", value.indexOf("://") + 3)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"));
  } catch {
    return false;
  }
}

function isProductionEnvironment(env: Env): boolean {
  return env.ENVIRONMENT === "staging" || env.ENVIRONMENT === "production";
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function featureRegionCode(url: URL): string | undefined {
  const value = url.searchParams.get("regionCode") ?? url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const normalized = value?.trim();
  return normalized || undefined;
}

async function clientIpHint(request: Request): Promise<string> {
  const raw = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return raw ? `ip-sha256:${await sha256Hex(raw)}` : "local";
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
        AND (event_type != 'report' OR source != 'field_report' OR moderation_status = 'approved')
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

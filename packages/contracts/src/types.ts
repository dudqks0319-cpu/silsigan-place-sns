export const liveSignalDimensions = [
  "weather",
  "local_condition",
  "crowd",
  "queue",
  "parking",
  "road_traffic",
  "entry",
  "business_status",
  "stream",
] as const;

export type LiveSignalDimension = (typeof liveSignalDimensions)[number];

export const liveSignalSourceTypes = [
  "official_live",
  "official_periodic",
  "official_static",
  "venue_operator",
  "verified_ugc",
  "ugc",
  "consensus",
  "model_estimate",
] as const;

export type LiveSignalSourceType = (typeof liveSignalSourceTypes)[number];

export const evidenceTypes = [
  "api",
  "camera_capture",
  "gallery_upload",
  "user_report",
  "operator_input",
  "stream",
] as const;

export type EvidenceType = (typeof evidenceTypes)[number];

export type LiveSignal = {
  id: string;
  placeId: string;
  dimension: LiveSignalDimension;
  valueCode: string;
  valueNumber?: number;
  valueText?: string;
  unit?: string;
  sourceId: string;
  sourceType: LiveSignalSourceType;
  sourceName: string;
  attributionText?: string;
  observedAt: string;
  fetchedAt: string;
  expiresAt?: string;
  confidenceScore: number;
  isEstimated: boolean;
  isPubliclyVisible: boolean;
  evidenceType?: EvidenceType;
  evidenceId?: string;
  metadata?: Record<string, unknown>;
};

export type AggregatedPlaceStatusCode =
  | "likely_good"
  | "check_before_visit"
  | "likely_crowded"
  | "insufficient";

export type DecisionDimensionRule = {
  dimension: LiveSignalDimension;
  required: boolean;
  importance: "critical" | "important" | "supporting";
  positiveValueCodes: readonly string[];
  negativeValueCodes: readonly string[];
};

export type DecisionProfile = {
  key: string;
  dimensions: readonly DecisionDimensionRule[];
};

export type AggregatedPlaceStatus = {
  status: AggregatedPlaceStatusCode;
  currentSignals: LiveSignal[];
  selectedSignals: Partial<Record<LiveSignalDimension, LiveSignal>>;
  missingRequiredDimensions: LiveSignalDimension[];
  conflictingDimensions: LiveSignalDimension[];
  independentSourceCount: number;
  confidenceScore: number;
  reasonCodes: string[];
  computedAt: string;
};

export const placeKinds = ["POINT", "AREA", "ROUTE", "FACILITY_GROUP"] as const;
export type PlaceKind = (typeof placeKinds)[number];

export type CanonicalPlace = {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  subcategory?: string;
  placeKind: PlaceKind;
  countryCode: string;
  regionCode: string;
  legalDongCode?: string;
  address: string;
  roadAddress?: string;
  centerLat: number;
  centerLng: number;
  geometry?: Record<string, unknown>;
  verificationRadiusM?: number;
  baseStatus: "active" | "paused" | "closed";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type CommercialUseStatus =
  | "pending"
  | "allowed"
  | "allowed_with_attribution"
  | "agreement_required"
  | "prohibited"
  | "unknown";

export type DataSource = {
  id: string;
  sourceKey: string;
  sourceName: string;
  providerName: string;
  sourceType: LiveSignalSourceType;
  baseUrl?: string;
  documentationUrl?: string;
  termsUrl?: string;
  licenseType?: string;
  attributionText?: string;
  commercialUseStatus: CommercialUseStatus;
  modificationAllowed?: boolean;
  redistributionAllowed?: boolean;
  imageUseAllowed?: boolean;
  videoUseAllowed?: boolean;
  agreementRequired: boolean;
  refreshIntervalSeconds?: number;
  defaultTtlSeconds?: number;
  requestQuota?: string;
  ipAllowlistRequired: boolean;
  enabled: boolean;
  enabledRegions: string[];
  lastTermsCheckedAt?: string;
  lastHealthCheckedAt?: string;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
  ownerContact?: string;
  internalNote?: string;
};

export type ActorIdentity =
  | { kind: "anonymous"; anonymousId: string }
  | { kind: "member"; profileId: string };

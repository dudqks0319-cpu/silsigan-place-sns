export const featureFlagKeys = [
  "QNA_ENABLED",
  "REWARDS_ENABLED",
  "ADS_ENABLED",
  "LIVE_STREAMS_ENABLED",
  "DEMO_DATA_ENABLED",
  "SEOUL_REALTIME_ENABLED",
  "SOCIAL_FEED_ENABLED",
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];

/**
 * Version recorded when a user confirms that each uploaded photo is their own
 * work or that they otherwise have permission to publish it.
 */
export const PHOTO_RIGHTS_TERMS_VERSION = "photo-rights-2026-07-20-v1" as const;

/** Final sanitized bytes accepted by the API and written to private object storage. */
export const PHOTO_UPLOAD_MAX_BYTES = 1 * 1024 * 1024;

/** Local-only source bound before browser/native re-encoding; these bytes are never uploaded as-is. */
export const PHOTO_LOCAL_SOURCE_MAX_BYTES = 12 * 1024 * 1024;

export const PHOTO_MAX_DIMENSION = 1280;

export const locationAccuracyBuckets = ["high", "medium", "low", "unknown"] as const;
export type LocationAccuracyBucket = (typeof locationAccuracyBuckets)[number];

/**
 * A browser/native location is eligible for field verification only when the
 * reported horizontal accuracy is at most this threshold. The raw accuracy
 * value is request-scoped and must never be persisted or sent to analytics.
 */
export const LOCATION_VERIFICATION_MAX_ACCURACY_M = 100;

export function locationAccuracyBucketForMeters(value: number | null | undefined): LocationAccuracyBucket {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unknown";
  }

  if (value <= 25) {
    return "high";
  }

  if (value <= LOCATION_VERIFICATION_MAX_ACCURACY_M) {
    return "medium";
  }

  return "low";
}

export function isLocationAccuracySufficient(value: number | null | undefined): boolean {
  const bucket = locationAccuracyBucketForMeters(value);
  return bucket === "high" || bucket === "medium";
}

export const FEATURE_GATED_API_FLAGS = {
  posts: "SOCIAL_FEED_ENABLED",
  questions: "QNA_ENABLED",
  myQuestions: "QNA_ENABLED",
  liveStreams: "LIVE_STREAMS_ENABLED",
  ads: "ADS_ENABLED",
} as const satisfies Record<"posts" | "questions" | "myQuestions" | "liveStreams" | "ads", FeatureFlagKey>;

export const DEFAULT_FEATURE_FLAGS: Readonly<Record<FeatureFlagKey, false>> = {
  QNA_ENABLED: false,
  REWARDS_ENABLED: false,
  ADS_ENABLED: false,
  LIVE_STREAMS_ENABLED: false,
  DEMO_DATA_ENABLED: false,
  SEOUL_REALTIME_ENABLED: false,
  SOCIAL_FEED_ENABLED: false,
};

export type FeatureFlagValue = {
  key: FeatureFlagKey;
  enabled: boolean;
  scopeType: "global" | "region";
  scopeKey: string;
};

export const INITIAL_DIMENSION_SETTINGS = [
  { settingKey: "weather", dimension: "weather", defaultTtlSeconds: 1800, currentEligible: true },
  { settingKey: "local_condition", dimension: "local_condition", defaultTtlSeconds: 3600, currentEligible: true },
  { settingKey: "crowd", dimension: "crowd", defaultTtlSeconds: 1800, currentEligible: true },
  { settingKey: "queue", dimension: "queue", defaultTtlSeconds: 1200, currentEligible: true },
  { settingKey: "parking", dimension: "parking", defaultTtlSeconds: 900, currentEligible: true },
  { settingKey: "road_traffic", dimension: "road_traffic", defaultTtlSeconds: 600, currentEligible: true },
  { settingKey: "entry", dimension: "entry", defaultTtlSeconds: 1800, currentEligible: true },
  { settingKey: "business_status", dimension: "business_status", defaultTtlSeconds: 3600, currentEligible: true },
  { settingKey: "stream", dimension: "stream", defaultTtlSeconds: 300, currentEligible: true },
  { settingKey: "photo_current", dimension: null, defaultTtlSeconds: 7200, currentEligible: true },
  { settingKey: "photo_feed", dimension: null, defaultTtlSeconds: 86400, currentEligible: false },
  { settingKey: "report_current", dimension: null, defaultTtlSeconds: 10800, currentEligible: false },
] as const;

export function resolveFeatureFlag(
  key: FeatureFlagKey,
  values: readonly FeatureFlagValue[],
  regionCode?: string,
): boolean {
  if (regionCode) {
    const regionValue = values.find(
      (value) => value.key === key && value.scopeType === "region" && value.scopeKey === regionCode,
    );
    if (regionValue) {
      return regionValue.enabled === true;
    }
  }

  const globalValue = values.find(
    (value) => value.key === key && value.scopeType === "global" && value.scopeKey === "*",
  );
  return globalValue?.enabled === true;
}

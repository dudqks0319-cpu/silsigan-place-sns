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

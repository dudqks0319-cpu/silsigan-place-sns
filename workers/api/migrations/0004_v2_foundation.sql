PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  auth_subject TEXT UNIQUE,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 60),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'deletion_requested', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS identity_links (
  anonymous_user_id TEXT PRIMARY KEY REFERENCES anonymous_users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official_live',
    'official_periodic',
    'official_static',
    'venue_operator',
    'verified_ugc',
    'ugc',
    'consensus',
    'model_estimate'
  )),
  base_url TEXT,
  documentation_url TEXT,
  terms_url TEXT,
  license_type TEXT,
  attribution_text TEXT,
  commercial_use_status TEXT NOT NULL DEFAULT 'pending' CHECK (commercial_use_status IN (
    'pending',
    'allowed',
    'allowed_with_attribution',
    'agreement_required',
    'prohibited',
    'unknown'
  )),
  modification_allowed INTEGER CHECK (modification_allowed IS NULL OR modification_allowed IN (0, 1)),
  redistribution_allowed INTEGER CHECK (redistribution_allowed IS NULL OR redistribution_allowed IN (0, 1)),
  image_use_allowed INTEGER CHECK (image_use_allowed IS NULL OR image_use_allowed IN (0, 1)),
  video_use_allowed INTEGER CHECK (video_use_allowed IS NULL OR video_use_allowed IN (0, 1)),
  agreement_required INTEGER NOT NULL DEFAULT 0 CHECK (agreement_required IN (0, 1)),
  refresh_interval_seconds INTEGER CHECK (refresh_interval_seconds IS NULL OR refresh_interval_seconds > 0),
  default_ttl_seconds INTEGER CHECK (default_ttl_seconds IS NULL OR default_ttl_seconds > 0),
  request_quota TEXT,
  ip_allowlist_required INTEGER NOT NULL DEFAULT 0 CHECK (ip_allowlist_required IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_regions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_regions_json)),
  last_terms_checked_at TEXT,
  last_health_checked_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'down')),
  owner_contact TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_metadata (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  subcategory TEXT,
  place_kind TEXT NOT NULL DEFAULT 'POINT' CHECK (place_kind IN ('POINT', 'AREA', 'ROUTE', 'FACILITY_GROUP')),
  country_code TEXT NOT NULL DEFAULT 'KR',
  legal_dong_code TEXT,
  road_address TEXT,
  geometry_json TEXT CHECK (geometry_json IS NULL OR json_valid(geometry_json)),
  verification_radius_m INTEGER CHECK (verification_radius_m IS NULL OR verification_radius_m BETWEEN 50 AND 5000),
  base_status TEXT NOT NULL DEFAULT 'active' CHECK (base_status IN ('active', 'paused', 'closed')),
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_aliases (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (place_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS place_source_mappings (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  external_place_id TEXT NOT NULL,
  external_name TEXT,
  external_address TEXT,
  external_lat REAL CHECK (external_lat IS NULL OR external_lat BETWEEN -90 AND 90),
  external_lng REAL CHECK (external_lng IS NULL OR external_lng BETWEEN -180 AND 180),
  match_score REAL CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  match_method TEXT NOT NULL CHECK (match_method IN ('provider_id', 'normalized_name', 'address', 'distance', 'phone', 'building', 'manual')),
  manually_verified INTEGER NOT NULL DEFAULT 0 CHECK (manually_verified IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source_id, external_place_id)
);

CREATE TABLE IF NOT EXISTS source_health_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS api_ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  region_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'quota_exceeded')),
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  normalized_count INTEGER NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS dimension_settings (
  setting_key TEXT PRIMARY KEY,
  dimension TEXT CHECK (dimension IS NULL OR dimension IN (
    'weather',
    'local_condition',
    'crowd',
    'queue',
    'parking',
    'road_traffic',
    'entry',
    'business_status',
    'stream'
  )),
  default_ttl_seconds INTEGER NOT NULL CHECK (default_ttl_seconds > 0),
  current_eligible INTEGER NOT NULL DEFAULT 1 CHECK (current_eligible IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'region')),
  scope_key TEXT NOT NULL,
  flag_key TEXT NOT NULL CHECK (flag_key IN (
    'QNA_ENABLED',
    'REWARDS_ENABLED',
    'ADS_ENABLED',
    'LIVE_STREAMS_ENABLED',
    'DEMO_DATA_ENABLED',
    'SEOUL_REALTIME_ENABLED',
    'SOCIAL_FEED_ENABLED'
  )),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scope_type, scope_key, flag_key)
);

CREATE TABLE IF NOT EXISTS decision_profiles (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL UNIQUE,
  place_kind TEXT NOT NULL,
  minimum_independent_sources INTEGER NOT NULL DEFAULT 2 CHECK (minimum_independent_sources >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS decision_profile_dimensions (
  profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
    'weather',
    'local_condition',
    'crowd',
    'queue',
    'parking',
    'road_traffic',
    'entry',
    'business_status',
    'stream'
  )),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  importance TEXT NOT NULL CHECK (importance IN ('critical', 'important', 'supporting')),
  positive_value_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(positive_value_codes_json)),
  negative_value_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negative_value_codes_json)),
  PRIMARY KEY (profile_id, dimension)
);

CREATE TABLE IF NOT EXISTS place_decision_profiles (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE RESTRICT,
  assigned_by TEXT NOT NULL DEFAULT 'system',
  manually_verified INTEGER NOT NULL DEFAULT 0 CHECK (manually_verified IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_identity_links_profile ON identity_links(profile_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_normalized ON place_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_place_source_mappings_place ON place_source_mappings(place_id, source_id);
CREATE INDEX IF NOT EXISTS idx_source_health_source_checked ON source_health_logs(source_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_source_started ON api_ingestion_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_flags_scope ON feature_flags(flag_key, scope_type, scope_key);

INSERT OR IGNORE INTO dimension_settings (setting_key, dimension, default_ttl_seconds, current_eligible) VALUES
  ('weather', 'weather', 1800, 1),
  ('local_condition', 'local_condition', 3600, 1),
  ('crowd', 'crowd', 1800, 1),
  ('queue', 'queue', 1200, 1),
  ('parking', 'parking', 900, 1),
  ('road_traffic', 'road_traffic', 600, 1),
  ('entry', 'entry', 1800, 1),
  ('business_status', 'business_status', 3600, 1),
  ('stream', 'stream', 300, 1),
  ('photo_current', NULL, 7200, 1),
  ('photo_feed', NULL, 86400, 0),
  ('report_current', NULL, 10800, 0);

INSERT OR IGNORE INTO feature_flags (scope_type, scope_key, flag_key, enabled) VALUES
  ('global', '*', 'QNA_ENABLED', 0),
  ('global', '*', 'REWARDS_ENABLED', 0),
  ('global', '*', 'ADS_ENABLED', 0),
  ('global', '*', 'LIVE_STREAMS_ENABLED', 0),
  ('global', '*', 'DEMO_DATA_ENABLED', 0),
  ('global', '*', 'SEOUL_REALTIME_ENABLED', 0),
  ('global', '*', 'SOCIAL_FEED_ENABLED', 0);

INSERT OR IGNORE INTO data_sources (
  id,
  source_key,
  source_name,
  provider_name,
  source_type,
  documentation_url,
  commercial_use_status,
  agreement_required,
  enabled,
  enabled_regions_json,
  health_status
) VALUES
  ('source-user-report', 'user_report', 'User field report', 'Silsigan', 'ugc', NULL, 'allowed', 0, 1, '["*"]', 'healthy'),
  ('source-kma-weather', 'kma_weather', 'KMA short-term forecast', 'Korea Meteorological Administration', 'official_periodic', 'https://www.data.go.kr/data/15084084/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-tour-api', 'tour_api', 'Korean tourism information', 'Korea Tourism Organization', 'official_static', 'https://www.data.go.kr/data/15101578/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-parking', 'national_parking', 'National parking standard data', 'Public Data Portal', 'official_static', 'https://www.data.go.kr/data/15012896/standard.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-traffic', 'national_traffic', 'National road traffic', 'Ministry of Land Infrastructure and Transport', 'official_live', 'https://www.data.go.kr/data/15040463/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-cctv', 'national_cctv', 'National CCTV metadata', 'Ministry of Land Infrastructure and Transport', 'official_static', 'https://www.data.go.kr/data/15040466/openapi.do', 'pending', 1, 0, '[]', 'unknown'),
  ('source-seoul-realtime', 'seoul_realtime_city', 'Seoul realtime city data', 'Seoul Metropolitan Government', 'official_live', 'https://data.seoul.go.kr/dataList/OA-21285/A/1/datasetView.do', 'pending', 0, 0, '["seoul"]', 'unknown'),
  ('source-youtube-live', 'youtube_live', 'YouTube live embed status', 'YouTube', 'official_periodic', 'https://developers.google.com/youtube/iframe_api_reference', 'pending', 1, 0, '[]', 'unknown');
UPDATE data_sources
SET
  commercial_use_status = 'allowed_with_attribution',
  attribution_text = '기상청',
  refresh_interval_seconds = 3600,
  default_ttl_seconds = 1800,
  owner_contact = 'data-operations',
  last_terms_checked_at = '2026-07-10T00:00:00.000Z',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_key = 'kma_weather';

UPDATE data_sources
SET
  owner_contact = CASE
    WHEN source_key IN ('national_cctv', 'youtube_live') THEN 'legal-safety'
    ELSE 'data-operations'
  END,
  internal_note = CASE
    WHEN source_key = 'tour_api' THEN 'Static place metadata only. Provider images stay disabled until item-level usage rights are verified.'
    WHEN source_key = 'national_parking' THEN 'Static facility metadata only. Never interpret missing or stale rows as current availability.'
    WHEN source_key = 'national_traffic' THEN 'Adapter-ready only. Keep disabled until commercial use, attribution, credentials, and health checks are approved.'
    WHEN source_key = 'national_cctv' THEN 'Metadata only. Do not store, proxy, restream, or expose provider video URLs.'
    WHEN source_key = 'seoul_realtime_city' THEN 'Region-scoped and feature-flagged off until source rights and health checks are approved.'
    WHEN source_key = 'youtube_live' THEN 'Embedding and live-stream feature remain disabled until channel ownership and platform policy review are complete.'
    ELSE internal_note
  END,
  image_use_allowed = CASE WHEN source_key = 'tour_api' THEN 0 ELSE image_use_allowed END,
  video_use_allowed = CASE WHEN source_key IN ('national_cctv', 'youtube_live') THEN 0 ELSE video_use_allowed END,
  enabled = 0,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_key IN ('tour_api', 'national_parking', 'national_traffic', 'national_cctv', 'seoul_realtime_city', 'youtube_live');

INSERT OR IGNORE INTO decision_profiles (id, profile_key, place_kind) VALUES
  ('profile-restaurant', 'restaurant', 'restaurant'),
  ('profile-beach', 'beach', 'beach'),
  ('profile-park', 'park', 'park'),
  ('profile-festival', 'festival', 'festival'),
  ('profile-ski-resort', 'ski_resort', 'ski_resort');

INSERT OR IGNORE INTO decision_profile_dimensions (
  profile_id,
  dimension,
  required,
  importance,
  positive_value_codes_json,
  negative_value_codes_json
) VALUES
  ('profile-restaurant', 'queue', 1, 'critical', '["none","under_10"]', '["30_to_60","60_plus"]'),
  ('profile-restaurant', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-restaurant', 'parking', 0, 'supporting', '["available"]', '["full","closed"]'),
  ('profile-beach', 'weather', 1, 'critical', '["clear","calm"]', '["storm","closed"]'),
  ('profile-beach', 'local_condition', 0, 'critical', '["safe"]', '["danger","closed"]'),
  ('profile-beach', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-beach', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-beach', 'road_traffic', 0, 'supporting', '["smooth"]', '["blocked"]'),
  ('profile-park', 'weather', 1, 'critical', '["clear","calm"]', '["storm"]'),
  ('profile-park', 'local_condition', 0, 'critical', '["safe"]', '["danger","closed"]'),
  ('profile-park', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-park', 'parking', 0, 'supporting', '["available"]', '["full","closed"]'),
  ('profile-festival', 'crowd', 1, 'critical', '["quiet","normal"]', '["packed"]'),
  ('profile-festival', 'entry', 1, 'critical', '["open"]', '["restricted","closed"]'),
  ('profile-festival', 'queue', 0, 'important', '["none","under_10"]', '["30_to_60","60_plus"]'),
  ('profile-festival', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-festival', 'road_traffic', 0, 'important', '["smooth"]', '["blocked"]'),
  ('profile-ski-resort', 'weather', 1, 'critical', '["clear","snow_good"]', '["storm","closed"]'),
  ('profile-ski-resort', 'road_traffic', 1, 'critical', '["smooth"]', '["blocked","chains_required"]'),
  ('profile-ski-resort', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-ski-resort', 'business_status', 1, 'important', '["open"]', '["closed"]'),
  ('profile-ski-resort', 'stream', 0, 'supporting', '["healthy"]', '["down"]');

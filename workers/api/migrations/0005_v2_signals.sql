PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_signals (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
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
  value_code TEXT NOT NULL CHECK (length(value_code) BETWEEN 1 AND 80),
  value_number REAL,
  value_text TEXT CHECK (value_text IS NULL OR length(value_text) <= 500),
  unit TEXT CHECK (unit IS NULL OR length(unit) <= 30),
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
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
  source_name TEXT NOT NULL,
  attribution_text TEXT,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1)),
  is_publicly_visible INTEGER NOT NULL DEFAULT 0 CHECK (is_publicly_visible IN (0, 1)),
  evidence_type TEXT CHECK (evidence_type IS NULL OR evidence_type IN (
    'api',
    'camera_capture',
    'gallery_upload',
    'user_report',
    'operator_input',
    'stream'
  )),
  evidence_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'anonymous', 'member')),
  actor_id TEXT,
  idempotency_key TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at IS NULL OR expires_at > observed_at),
  CHECK (
    (actor_type = 'system' AND actor_id IS NULL) OR
    (actor_type IN ('anonymous', 'member') AND actor_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS official_observations (
  id TEXT PRIMARY KEY,
  live_signal_id TEXT NOT NULL UNIQUE REFERENCES live_signals(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  external_observation_id TEXT,
  raw_payload_hash TEXT NOT NULL CHECK (raw_payload_hash GLOB 'sha256:*'),
  provider_observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS aggregated_place_status (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  decision_profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('likely_good', 'check_before_visit', 'likely_crowded', 'insufficient')),
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  current_signals_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(current_signals_json)),
  missing_dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(missing_dimensions_json)),
  conflicting_dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicting_dimensions_json)),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  computed_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at IS NULL OR expires_at > computed_at)
);

CREATE INDEX IF NOT EXISTS idx_live_signals_place_dimension_observed
  ON live_signals(place_id, dimension, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_current
  ON live_signals(place_id, is_publicly_visible, expires_at, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_source_fetched
  ON live_signals(source_id, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signals_idempotency
  ON live_signals(source_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aggregated_status_status
  ON aggregated_place_status(status, computed_at DESC);

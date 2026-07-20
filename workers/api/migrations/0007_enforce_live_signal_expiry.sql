PRAGMA foreign_keys = OFF;

-- Backfill legacy nullable rows from the server-owned dimension TTL. If a
-- dimension has no TTL, the NOT NULL copy below fails closed instead of
-- inventing a current-validity window.
UPDATE live_signals
SET expires_at = (
  SELECT strftime(
    '%Y-%m-%dT%H:%M:%fZ',
    live_signals.observed_at,
    '+' || dimension_settings.default_ttl_seconds || ' seconds'
  )
  FROM dimension_settings
  WHERE dimension_settings.dimension = live_signals.dimension
  ORDER BY dimension_settings.current_eligible DESC, dimension_settings.setting_key
  LIMIT 1
)
WHERE expires_at IS NULL;

DROP TABLE IF EXISTS live_signals_next;

CREATE TABLE live_signals_next (
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
  expires_at TEXT NOT NULL,
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
  CHECK (expires_at > observed_at),
  CHECK (
    (actor_type = 'system' AND actor_id IS NULL) OR
    (actor_type IN ('anonymous', 'member') AND actor_id IS NOT NULL)
  )
);

INSERT INTO live_signals_next (
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
  actor_type,
  actor_id,
  idempotency_key,
  metadata_json,
  created_at
)
SELECT
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
  actor_type,
  actor_id,
  idempotency_key,
  metadata_json,
  created_at
FROM live_signals;

DROP TABLE live_signals;
ALTER TABLE live_signals_next RENAME TO live_signals;

CREATE INDEX IF NOT EXISTS idx_live_signals_place_dimension_observed
  ON live_signals(place_id, dimension, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_current
  ON live_signals(place_id, is_publicly_visible, expires_at, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_source_fetched
  ON live_signals(source_id, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signals_idempotency
  ON live_signals(source_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

PRAGMA foreign_keys = ON;

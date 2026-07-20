PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_ingestion_targets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  adapter_config_json TEXT NOT NULL CHECK (
    json_valid(adapter_config_json)
    AND json_type(adapter_config_json) = 'object'
    AND json_extract(adapter_config_json, '$.serviceKey') IS NULL
    AND json_extract(adapter_config_json, '$.apiKey') IS NULL
    AND json_extract(adapter_config_json, '$.token') IS NULL
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  refresh_interval_seconds INTEGER NOT NULL CHECK (refresh_interval_seconds BETWEEN 300 AND 86400),
  next_run_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_started_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 3 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (lease_token IS NULL AND lease_until IS NULL)
    OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  ),
  UNIQUE (source_id, place_id, adapter_config_json)
);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_due
  ON source_ingestion_targets (enabled, next_run_at, id);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_lease
  ON source_ingestion_targets (lease_until, id);

-- The KMA nowcast is published hourly and becomes queryable after the observation hour.
-- Two hours keeps the latest safely published observation current until the next one is available.
UPDATE data_sources
SET
  default_ttl_seconds = 7200,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_key = 'kma_weather'
  AND default_ttl_seconds = 1800;

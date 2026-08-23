PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_ingestion_targets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL CHECK (length(target_key) BETWEEN 1 AND 100),
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  query_json TEXT NOT NULL CHECK (json_valid(query_json) AND length(query_json) <= 4000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 80),
  lease_token TEXT,
  lease_expires_at TEXT,
  created_by TEXT CHECK (created_by IS NULL OR length(created_by) <= 120),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_id, target_key)
);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_due
  ON source_ingestion_targets(enabled, next_run_at, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_source_place
  ON source_ingestion_targets(source_id, place_id);

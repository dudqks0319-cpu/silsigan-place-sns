CREATE TABLE IF NOT EXISTS photo_upload_claims (
  upload_id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_claims_consumed
  ON photo_upload_claims(consumed_at);

CREATE TABLE IF NOT EXISTS photo_abuse_budget (
  principal_hash TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  bytes_in_period INTEGER NOT NULL DEFAULT 0 CHECK (bytes_in_period >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_hash, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_photo_abuse_budget_updated
  ON photo_abuse_budget(updated_at);

CREATE TABLE IF NOT EXISTS photo_upload_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uploads_enabled INTEGER NOT NULL DEFAULT 1 CHECK (uploads_enabled IN (0, 1)),
  reason TEXT,
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_upload_control (id, uploads_enabled, reason, updated_by, updated_at)
VALUES (1, 1, 'initial-enabled', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

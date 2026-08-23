PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metered_usage_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 3 AND 80),
  actor_fingerprint TEXT NOT NULL CHECK (actor_fingerprint GLOB 'sha256:*'),
  ip_fingerprint TEXT NOT NULL CHECK (ip_fingerprint GLOB 'sha256:*'),
  resource_units INTEGER NOT NULL DEFAULT 1 CHECK (resource_units BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metered_usage_actor
  ON metered_usage_events(scope, actor_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metered_usage_ip
  ON metered_usage_events(scope, ip_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metered_usage_expiry
  ON metered_usage_events(expires_at);

CREATE TABLE IF NOT EXISTS photo_upload_sessions (
  upload_id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/webp')),
  storage_key TEXT NOT NULL UNIQUE,
  staging_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ticketed', 'uploaded')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_expiry
  ON photo_upload_sessions(expires_at, status);

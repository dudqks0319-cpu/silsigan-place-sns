-- Bind anonymous ownership to a server-issued 256-bit proof instead of treating
-- the public anonymous identifier itself as a bearer credential.

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  session_hash TEXT PRIMARY KEY,
  proof_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  rotated_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_status_expiry
  ON anonymous_sessions(status, expires_at);

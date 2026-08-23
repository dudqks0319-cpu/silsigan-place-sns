PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS photo_upload_idempotency_keys (
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  idempotency_key_hash TEXT NOT NULL CHECK (idempotency_key_hash GLOB 'sha256:*'),
  upload_id TEXT NOT NULL UNIQUE REFERENCES photo_upload_sessions(upload_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (anonymous_user_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_idempotency_upload
  ON photo_upload_idempotency_keys(upload_id);

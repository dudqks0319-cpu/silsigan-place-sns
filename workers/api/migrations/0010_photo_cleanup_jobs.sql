CREATE TABLE IF NOT EXISTS photo_cleanup_jobs (
  id TEXT PRIMARY KEY,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_photo_cleanup_jobs_pending
  ON photo_cleanup_jobs(status, next_attempt_at);

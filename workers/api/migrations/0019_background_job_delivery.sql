-- Make the existing publication outbox and R2 cleanup queue operational.
-- Existing in-flight rows are returned to pending because the previous schema
-- had no lease fencing and therefore could not prove ownership after a crash.

CREATE TABLE photo_cleanup_jobs_v2 (
  id TEXT PRIMARY KEY,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  budget_released_at TEXT,
  completed_at TEXT,
  dead_lettered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO photo_cleanup_jobs_v2 (
  id,
  photo_id,
  storage_key,
  byte_size,
  reason,
  status,
  attempts,
  next_attempt_at,
  last_error_code,
  completed_at,
  created_at,
  updated_at
)
SELECT
  job.id,
  job.photo_id,
  job.storage_key,
  COALESCE((SELECT photo.byte_size FROM photos photo WHERE photo.id = job.photo_id), 0),
  job.reason,
  CASE WHEN job.status = 'processing' THEN 'pending' ELSE job.status END,
  job.attempts,
  job.next_attempt_at,
  job.last_error_code,
  job.completed_at,
  job.created_at,
  COALESCE(job.completed_at, job.created_at)
FROM photo_cleanup_jobs job;

DROP TABLE photo_cleanup_jobs;
ALTER TABLE photo_cleanup_jobs_v2 RENAME TO photo_cleanup_jobs;

CREATE INDEX idx_photo_cleanup_jobs_pending
  ON photo_cleanup_jobs(status, next_attempt_at, lease_expires_at, created_at);

UPDATE publication_outbox
SET status = 'pending'
WHERE status = 'processing';

ALTER TABLE publication_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE publication_outbox ADD COLUMN lease_expires_at TEXT;
ALTER TABLE publication_outbox ADD COLUMN last_error_code TEXT;
ALTER TABLE publication_outbox ADD COLUMN dead_lettered_at TEXT;
ALTER TABLE publication_outbox ADD COLUMN updated_at TEXT;

UPDATE publication_outbox
SET updated_at = COALESCE(published_at, created_at)
WHERE updated_at IS NULL;

CREATE INDEX idx_publication_outbox_delivery
  ON publication_outbox(status, available_at, lease_expires_at, created_at);

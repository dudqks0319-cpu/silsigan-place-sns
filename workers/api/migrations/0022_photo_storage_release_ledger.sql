-- Fence every R2 storage-budget release by object key so retries and concurrent
-- deletion requests cannot subtract the same object more than once.

CREATE TABLE IF NOT EXISTS photo_storage_releases (
  storage_key TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  release_token TEXT NOT NULL UNIQUE,
  released_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_storage_releases_released
  ON photo_storage_releases(released_at DESC);

-- Cleanup jobs completed before this ledger already released their budget.
INSERT OR IGNORE INTO photo_storage_releases (storage_key, byte_size, release_token, released_at)
SELECT
  storage_key,
  byte_size,
  'migration-0022-' || id,
  COALESCE(budget_released_at, completed_at, updated_at)
FROM photo_cleanup_jobs
WHERE budget_released_at IS NOT NULL;

-- Fail safe toward over-counting. Objects awaiting cleanup still exist in R2
-- even though their photo rows are already hidden/deleted.
UPDATE photo_storage_budget
SET active_bytes = MAX(
      active_bytes,
      COALESCE((
        SELECT SUM(byte_size)
        FROM photos
        WHERE deleted_at IS NULL AND status <> 'rejected'
      ), 0)
      + COALESCE((
        SELECT SUM(byte_size)
        FROM (
          SELECT storage_key, MAX(byte_size) AS byte_size
          FROM photo_cleanup_jobs
          WHERE budget_released_at IS NULL
            AND status IN ('pending', 'processing', 'failed')
          GROUP BY storage_key
        ) pending_cleanup
      ), 0)
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1;

-- A live operator must compare Cloudflare R2 and D1 before deliberately
-- resuming uploads after this one-time ledger reconciliation.
UPDATE photo_upload_control
SET uploads_enabled = 0,
    reason = 'storage-release-ledger-migration-reconciliation-required',
    updated_by = 'migration:0022',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1;

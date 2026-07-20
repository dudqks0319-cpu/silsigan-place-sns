CREATE TABLE IF NOT EXISTS photo_storage_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_bytes INTEGER NOT NULL DEFAULT 0 CHECK (active_bytes >= 0),
  period_utc TEXT NOT NULL CHECK (period_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  writes_in_period INTEGER NOT NULL DEFAULT 0 CHECK (writes_in_period >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_storage_budget (id, active_bytes, period_utc, writes_in_period, updated_at)
SELECT
  1,
  COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status <> 'rejected' THEN byte_size ELSE 0 END), 0),
  strftime('%Y-%m', 'now'),
  COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END), 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM photos;

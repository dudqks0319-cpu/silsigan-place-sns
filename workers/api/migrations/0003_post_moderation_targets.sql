PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS reports_next (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('place', 'post', 'comment', 'photo')),
  target_id TEXT NOT NULL,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('false_content', 'spam', 'privacy_face', 'privacy_plate', 'sensitive_info', 'other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

INSERT INTO reports_next (
  id,
  target_type,
  target_id,
  anonymous_user_id,
  reason,
  note,
  status,
  created_at,
  resolved_at
)
SELECT
  id,
  target_type,
  target_id,
  anonymous_user_id,
  reason,
  note,
  status,
  created_at,
  resolved_at
FROM reports;

DROP TABLE reports;
ALTER TABLE reports_next RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open_unique_anon_target_reason
  ON reports(anonymous_user_id, target_type, target_id, reason)
  WHERE status = 'open';

PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS field_report_moderation (
  report_id TEXT PRIMARY KEY REFERENCES place_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_subject TEXT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_field_report_moderation_status
  ON field_report_moderation(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_report_moderation_report
  ON field_report_moderation(report_id, status);

INSERT OR IGNORE INTO field_report_moderation (
  report_id,
  status,
  reviewer_subject,
  decision_reason,
  decided_at,
  created_at,
  updated_at
)
SELECT
  place_events.id,
  'pending',
  NULL,
  NULL,
  NULL,
  place_events.created_at,
  place_events.created_at
FROM place_events
WHERE place_events.event_type = 'report'
  AND place_events.source = 'field_report';

UPDATE live_signals
SET is_publicly_visible = 0
WHERE evidence_id IN (
  SELECT id
  FROM place_events
  WHERE event_type = 'report'
    AND source = 'field_report'
);

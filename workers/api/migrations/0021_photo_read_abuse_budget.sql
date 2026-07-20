CREATE TABLE IF NOT EXISTS photo_read_abuse_budget (
  principal_hash TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_hash, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_photo_read_abuse_budget_updated
  ON photo_read_abuse_budget(updated_at);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS field_report_photos (
  report_id TEXT NOT NULL REFERENCES place_events(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (report_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_field_report_photos_photo
  ON field_report_photos(photo_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_field_report_photos_report
  ON field_report_photos(report_id, created_at DESC);

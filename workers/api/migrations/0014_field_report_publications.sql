PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS field_report_publications (
  report_id TEXT PRIMARY KEY REFERENCES place_events(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  client_request_id TEXT,
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 120),
  response_json TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_report_publications_request
  ON field_report_publications(anonymous_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_report_publications_place_created
  ON field_report_publications(place_id, created_at DESC);

CREATE TABLE IF NOT EXISTS field_report_media (
  report_id TEXT NOT NULL REFERENCES field_report_publications(report_id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (report_id, photo_id),
  UNIQUE (photo_id)
);

CREATE TABLE IF NOT EXISTS hashtags (
  name TEXT PRIMARY KEY,
  tag_type TEXT NOT NULL CHECK (tag_type IN ('place', 'status', 'purpose', 'time', 'region')),
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden')),
  post_count INTEGER NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  last_post_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS field_report_hashtags (
  report_id TEXT NOT NULL REFERENCES field_report_publications(report_id) ON DELETE CASCADE,
  hashtag_name TEXT NOT NULL REFERENCES hashtags(name) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (report_id, hashtag_name)
);

CREATE INDEX IF NOT EXISTS idx_field_report_hashtags_name_report
  ON field_report_hashtags(hashtag_name, report_id);

CREATE TABLE IF NOT EXISTS publication_outbox (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'field_report'),
  aggregate_id TEXT NOT NULL REFERENCES field_report_publications(report_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_publication_outbox_status_available
  ON publication_outbox(status, available_at, created_at);

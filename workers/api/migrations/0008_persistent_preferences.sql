CREATE TABLE IF NOT EXISTS saved_places (
  actor_identity_key TEXT NOT NULL,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor_identity_key, place_id)
);

CREATE TABLE IF NOT EXISTS saved_posts (
  actor_identity_key TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor_identity_key, post_id)
);

CREATE TABLE IF NOT EXISTS followed_topics (
  actor_identity_key TEXT NOT NULL,
  topic_name TEXT NOT NULL CHECK (length(topic_name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (actor_identity_key, topic_name)
);

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id TEXT PRIMARY KEY,
  actor_identity_key TEXT NOT NULL,
  push_token_hash TEXT CHECK (push_token_hash IS NULL OR push_token_hash GLOB 'sha256:*'),
  platform TEXT NOT NULL CHECK (platform IN ('webview', 'ios', 'android', 'web')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (actor_identity_key, platform)
);

CREATE INDEX IF NOT EXISTS idx_saved_places_actor ON saved_places(actor_identity_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_posts_actor ON saved_posts(actor_identity_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_followed_topics_actor ON followed_topics(actor_identity_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_subscriptions_actor ON notification_subscriptions(actor_identity_key, updated_at DESC);

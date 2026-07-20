CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (length(event_name) BETWEEN 1 AND 64),
  actor_identity_key TEXT NOT NULL CHECK (actor_identity_key GLOB 'analytics:*'),
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_actor_created
  ON analytics_events(actor_identity_key, created_at DESC);

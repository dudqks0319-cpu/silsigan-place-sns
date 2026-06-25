PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('province', 'city', 'district')),
  parent_region_id TEXT REFERENCES regions(id) ON DELETE SET NULL,
  launch_stage TEXT NOT NULL DEFAULT 'seed' CHECK (launch_stage IN ('seed', 'beta', 'active', 'paused')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (is_sensitive IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN 33 AND 39),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN 124 AND 132),
  coordinate_status TEXT NOT NULL DEFAULT 'verified' CHECK (coordinate_status IN ('verified', 'TODO_COORDINATE_VERIFY', 'rejected')),
  launch_stage TEXT NOT NULL DEFAULT 'seed' CHECK (launch_stage IN ('seed', 'beta', 'active', 'paused')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS anonymous_users (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  trust_score INTEGER NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_events (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('report', 'comment', 'photo', 'like', 'click')),
  source TEXT NOT NULL DEFAULT 'worker_api' CHECK (length(source) BETWEEN 1 AND 80),
  region_code TEXT NOT NULL,
  area_code TEXT NOT NULL,
  category TEXT NOT NULL,
  crowd_level TEXT CHECK (crowd_level IN ('quiet', 'normal', 'busy', 'packed')),
  line_status TEXT CHECK (line_status IN ('none', 'short', 'medium', 'long')),
  parking_status TEXT CHECK (parking_status IN ('available', 'limited', 'full', 'unknown')),
  verified_radius_m INTEGER CHECK (verified_radius_m IN (50, 150, 300)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS place_event_hourly (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  area_code TEXT NOT NULL,
  category TEXT NOT NULL,
  hour_bucket TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  unique_user_count INTEGER NOT NULL DEFAULT 0 CHECK (unique_user_count >= 0),
  UNIQUE (place_id, hour_bucket)
);

CREATE TABLE IF NOT EXISTS place_rankings (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL CHECK (rank > 0),
  window_hours INTEGER NOT NULL DEFAULT 24 CHECK (window_hours IN (1, 6, 24, 168)),
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (region_id, place_id, window_hours)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  hidden_at TEXT,
  hidden_reason TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  creator_name TEXT NOT NULL CHECK (length(creator_name) BETWEEN 1 AND 60),
  creator_badge TEXT NOT NULL CHECK (length(creator_badge) BETWEEN 1 AND 80),
  caption TEXT CHECK (caption IS NULL OR length(caption) <= 120),
  crowd_level TEXT NOT NULL CHECK (crowd_level IN ('quiet', 'normal', 'busy', 'packed')),
  parking_status TEXT NOT NULL CHECK (parking_status IN ('available', 'limited', 'full', 'unknown')),
  line_status TEXT NOT NULL CHECK (line_status IN ('none', 'short', 'medium', 'long')),
  weather_feel TEXT NOT NULL CHECK (weather_feel IN ('good', 'rainy', 'windy', 'hot', 'cold')),
  location_verified INTEGER NOT NULL DEFAULT 0 CHECK (location_verified IN (0, 1)),
  verified_radius_m INTEGER CHECK (verified_radius_m IN (50, 150, 300)),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count BETWEEN 0 AND 4),
  photo_label TEXT NOT NULL CHECK (length(photo_label) BETWEEN 1 AND 80),
  helpful_count INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  hashtag_names TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (question_type IN ('crowd', 'line', 'parking', 'weather', 'photo_request', 'other')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 4 AND 160),
  credit_cost INTEGER NOT NULL CHECK (credit_cost IN (1, 2)),
  answered_report_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'expired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
  report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  r2_key TEXT NOT NULL UNIQUE,
  public_url TEXT,
  signed_url_expires_at TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/webp', 'image/jpeg')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 3145728),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1280),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1280),
  image_hash TEXT CHECK (image_hash IS NULL OR image_hash GLOB 'sha256:*'),
  duplicate_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (duplicate_status IN ('unchecked', 'unique')),
  original_filename_stored INTEGER NOT NULL DEFAULT 0 CHECK (original_filename_stored = 0),
  client_reencoded INTEGER NOT NULL DEFAULT 1 CHECK (client_reencoded = 1),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'rejected')),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  deleted_at TEXT,
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('place', 'comment', 'photo')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (anonymous_user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('place', 'comment', 'photo')),
  target_id TEXT NOT NULL,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('false_content', 'spam', 'privacy_face', 'privacy_plate', 'sensitive_info', 'other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  assigned_to TEXT,
  decision TEXT CHECK (decision IN ('pending', 'accept', 'reject', 'escalate')),
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blocked_users (
  id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 200),
  blocked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (anonymous_user_id)
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  admin_subject TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_places_region ON places(region_id, is_active, coordinate_status);
CREATE INDEX IF NOT EXISTS idx_places_bbox ON places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_place_events_place_created ON place_events(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_event_hourly_place_hour ON place_event_hourly(place_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_region_window ON place_rankings(region_id, window_hours, rank);
CREATE INDEX IF NOT EXISTS idx_comments_place_created ON comments(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_place_created ON posts(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_place_created ON questions(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_anon_created ON questions(anonymous_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_place_created ON photos(place_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_image_hash_active
  ON photos(image_hash)
  WHERE image_hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_open_unique_anon_target_reason
  ON reports(anonymous_user_id, target_type, target_id, reason)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_moderation_reports_decision ON moderation_reports(decision, priority, created_at DESC);

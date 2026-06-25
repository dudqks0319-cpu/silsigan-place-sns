PRAGMA foreign_keys = ON;

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

CREATE INDEX IF NOT EXISTS idx_posts_place_created ON posts(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_place_created ON questions(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_anon_created ON questions(anonymous_user_id, created_at DESC);

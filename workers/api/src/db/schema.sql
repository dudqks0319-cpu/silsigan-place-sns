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

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  session_hash TEXT PRIMARY KEY,
  proof_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  rotated_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_status_expiry
  ON anonymous_sessions(status, expires_at);

CREATE TABLE IF NOT EXISTS anonymous_session_issuance_budget (
  day_utc TEXT PRIMARY KEY,
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  accuracy_bucket TEXT NOT NULL DEFAULT 'unknown' CHECK (accuracy_bucket IN ('high', 'medium', 'low', 'unknown')),
  verification_method TEXT NOT NULL DEFAULT 'none' CHECK (verification_method IN ('none', 'radius', 'polygon')),
  moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden')),
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
  target_type TEXT NOT NULL CHECK (target_type IN ('place', 'post', 'comment', 'photo')),
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

CREATE TABLE IF NOT EXISTS place_addition_request_daily_budget (
  day_utc TEXT PRIMARY KEY CHECK (day_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 1600),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_addition_requests (
  id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL CHECK (length(client_request_id) BETWEEN 8 AND 100),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 240),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'needs_verification'
    CHECK (status IN ('needs_verification', 'ready_for_manual_import', 'duplicate', 'rejected')),
  review_reason TEXT CHECK (review_reason IS NULL OR length(review_reason) BETWEEN 5 AND 300),
  matched_place_id TEXT REFERENCES places(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at TEXT,
  CHECK (
    (status = 'duplicate' AND matched_place_id IS NOT NULL) OR
    (status != 'duplicate' AND matched_place_id IS NULL)
  ),
  UNIQUE (anonymous_user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_place_addition_requests_owner_created
  ON place_addition_requests(anonymous_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_place_addition_requests_queue
  ON place_addition_requests(status, created_at ASC);

CREATE TRIGGER IF NOT EXISTS trg_place_addition_requests_daily_guard
BEFORE INSERT ON place_addition_requests
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM place_addition_requests
    WHERE anonymous_user_id = NEW.anonymous_user_id
      AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')
      AND created_at < strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')
  ) >= 3 THEN RAISE(ABORT, 'PLACE_REQUEST_SESSION_DAILY_LIMIT') END;

  INSERT INTO place_addition_request_daily_budget (day_utc, request_count, updated_at)
  VALUES (strftime('%Y-%m-%d', 'now'), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(day_utc) DO UPDATE SET
    request_count = place_addition_request_daily_budget.request_count + 1,
    updated_at = excluded.updated_at
  WHERE place_addition_request_daily_budget.request_count < 1600;

  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_place_addition_requests_terminal_status
BEFORE UPDATE OF status ON place_addition_requests
WHEN OLD.status IN ('duplicate', 'rejected') AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'PLACE_REQUEST_TERMINAL_STATUS');
END;

CREATE TABLE IF NOT EXISTS api_cost_guard_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'running' CHECK (mode IN ('running', 'degraded', 'stopped')),
  reason TEXT NOT NULL DEFAULT 'initial-enabled' CHECK (length(reason) BETWEEN 1 AND 300),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  automatic_metric TEXT CHECK (
    automatic_metric IS NULL OR automatic_metric IN ('workers_requests', 'd1_rows_read', 'd1_rows_written', 'manual')
  ),
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO api_cost_guard_control
  (id, mode, reason, generation, automatic_metric, updated_by, updated_at)
VALUES
  (1, 'running', 'initial-enabled', 1, NULL, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS api_cost_guard_daily (
  day_utc TEXT PRIMARY KEY CHECK (day_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  admitted_requests INTEGER NOT NULL DEFAULT 0 CHECK (admitted_requests >= 0),
  reserved_workers_requests INTEGER NOT NULL DEFAULT 0 CHECK (reserved_workers_requests >= 0),
  reserved_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (reserved_rows_read >= 0),
  reserved_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (reserved_rows_written >= 0),
  critical_requests INTEGER NOT NULL DEFAULT 0 CHECK (critical_requests >= 0),
  critical_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (critical_rows_read >= 0),
  critical_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (critical_rows_written >= 0),
  high_cost_requests INTEGER NOT NULL DEFAULT 0 CHECK (high_cost_requests >= 0),
  mutation_requests INTEGER NOT NULL DEFAULT 0 CHECK (mutation_requests >= 0),
  observed_workers_requests INTEGER NOT NULL DEFAULT 0 CHECK (observed_workers_requests >= 0),
  observed_rows_read INTEGER NOT NULL DEFAULT 0 CHECK (observed_rows_read >= 0),
  observed_rows_written INTEGER NOT NULL DEFAULT 0 CHECK (observed_rows_written >= 0),
  warned_percent INTEGER NOT NULL DEFAULT 0 CHECK (warned_percent BETWEEN 0 AND 100),
  warned_metric TEXT CHECK (
    warned_metric IS NULL OR warned_metric IN ('workers_requests', 'd1_rows_read', 'd1_rows_written')
  ),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS api_cost_guard_reconciliations (
  id TEXT PRIMARY KEY,
  day_utc TEXT NOT NULL,
  observed_workers_requests INTEGER NOT NULL CHECK (observed_workers_requests >= 0),
  observed_d1_rows_read INTEGER NOT NULL CHECK (observed_d1_rows_read >= 0),
  observed_d1_rows_written INTEGER NOT NULL CHECK (observed_d1_rows_written >= 0),
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cloudflare-dashboard', 'graphql-api')),
  admin_subject TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 5 AND 300),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_api_cost_guard_reconcile_day
  ON api_cost_guard_reconciliations(day_utc, observed_at DESC);

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

CREATE TABLE IF NOT EXISTS publication_outbox (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type = 'field_report'),
  aggregate_id TEXT NOT NULL REFERENCES field_report_publications(report_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  published_at TEXT,
  dead_lettered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_places_region ON places(region_id, is_active, coordinate_status);
CREATE INDEX IF NOT EXISTS idx_places_bbox ON places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_place_events_place_created ON place_events(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_events_field_report_moderation
  ON place_events(event_type, source, moderation_status, created_at DESC);
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_report_publications_request
  ON field_report_publications(anonymous_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_report_publications_place_created
  ON field_report_publications(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_report_hashtags_name_report
  ON field_report_hashtags(hashtag_name, report_id);
CREATE INDEX IF NOT EXISTS idx_publication_outbox_status_available
  ON publication_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_publication_outbox_delivery
  ON publication_outbox(status, available_at, lease_expires_at, created_at);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  auth_subject TEXT UNIQUE,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 60),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'deletion_requested', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS identity_links (
  anonymous_user_id TEXT PRIMARY KEY REFERENCES anonymous_users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official_live',
    'official_periodic',
    'official_static',
    'venue_operator',
    'verified_ugc',
    'ugc',
    'consensus',
    'model_estimate'
  )),
  base_url TEXT,
  documentation_url TEXT,
  terms_url TEXT,
  license_type TEXT,
  attribution_text TEXT,
  commercial_use_status TEXT NOT NULL DEFAULT 'pending' CHECK (commercial_use_status IN (
    'pending',
    'allowed',
    'allowed_with_attribution',
    'agreement_required',
    'prohibited',
    'unknown'
  )),
  modification_allowed INTEGER CHECK (modification_allowed IS NULL OR modification_allowed IN (0, 1)),
  redistribution_allowed INTEGER CHECK (redistribution_allowed IS NULL OR redistribution_allowed IN (0, 1)),
  image_use_allowed INTEGER CHECK (image_use_allowed IS NULL OR image_use_allowed IN (0, 1)),
  video_use_allowed INTEGER CHECK (video_use_allowed IS NULL OR video_use_allowed IN (0, 1)),
  agreement_required INTEGER NOT NULL DEFAULT 0 CHECK (agreement_required IN (0, 1)),
  refresh_interval_seconds INTEGER CHECK (refresh_interval_seconds IS NULL OR refresh_interval_seconds > 0),
  default_ttl_seconds INTEGER CHECK (default_ttl_seconds IS NULL OR default_ttl_seconds > 0),
  request_quota TEXT,
  ip_allowlist_required INTEGER NOT NULL DEFAULT 0 CHECK (ip_allowlist_required IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_regions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_regions_json)),
  last_terms_checked_at TEXT,
  last_health_checked_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'down')),
  owner_contact TEXT,
  internal_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_metadata (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  subcategory TEXT,
  place_kind TEXT NOT NULL DEFAULT 'POINT' CHECK (place_kind IN ('POINT', 'AREA', 'ROUTE', 'FACILITY_GROUP')),
  country_code TEXT NOT NULL DEFAULT 'KR',
  legal_dong_code TEXT,
  road_address TEXT,
  geometry_json TEXT CHECK (geometry_json IS NULL OR json_valid(geometry_json)),
  verification_radius_m INTEGER CHECK (verification_radius_m IS NULL OR verification_radius_m BETWEEN 50 AND 5000),
  base_status TEXT NOT NULL DEFAULT 'active' CHECK (base_status IN ('active', 'paused', 'closed')),
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS place_aliases (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (place_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS place_source_mappings (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  external_place_id TEXT NOT NULL,
  external_name TEXT,
  external_address TEXT,
  external_lat REAL CHECK (external_lat IS NULL OR external_lat BETWEEN -90 AND 90),
  external_lng REAL CHECK (external_lng IS NULL OR external_lng BETWEEN -180 AND 180),
  match_score REAL CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  match_method TEXT NOT NULL CHECK (match_method IN ('provider_id', 'normalized_name', 'address', 'distance', 'phone', 'building', 'manual')),
  manually_verified INTEGER NOT NULL DEFAULT 0 CHECK (manually_verified IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source_id, external_place_id)
);

CREATE TABLE IF NOT EXISTS source_health_logs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  message TEXT CHECK (message IS NULL OR length(message) <= 500),
  response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS api_ingestion_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  region_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'quota_exceeded')),
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  normalized_count INTEGER NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS source_ingestion_targets (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  adapter_config_json TEXT NOT NULL CHECK (
    json_valid(adapter_config_json)
    AND json_type(adapter_config_json) = 'object'
    AND json_extract(adapter_config_json, '$.serviceKey') IS NULL
    AND json_extract(adapter_config_json, '$.apiKey') IS NULL
    AND json_extract(adapter_config_json, '$.token') IS NULL
  ),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  refresh_interval_seconds INTEGER NOT NULL CHECK (refresh_interval_seconds BETWEEN 300 AND 86400),
  next_run_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  last_started_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 3 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (lease_token IS NULL AND lease_until IS NULL)
    OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  ),
  UNIQUE (source_id, place_id, adapter_config_json)
);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_due
  ON source_ingestion_targets (enabled, next_run_at, id);

CREATE INDEX IF NOT EXISTS idx_source_ingestion_targets_lease
  ON source_ingestion_targets (lease_until, id);

CREATE TABLE IF NOT EXISTS dimension_settings (
  setting_key TEXT PRIMARY KEY,
  dimension TEXT CHECK (dimension IS NULL OR dimension IN (
    'weather',
    'local_condition',
    'crowd',
    'queue',
    'parking',
    'road_traffic',
    'entry',
    'business_status',
    'stream'
  )),
  default_ttl_seconds INTEGER NOT NULL CHECK (default_ttl_seconds > 0),
  current_eligible INTEGER NOT NULL DEFAULT 1 CHECK (current_eligible IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'region')),
  scope_key TEXT NOT NULL,
  flag_key TEXT NOT NULL CHECK (flag_key IN (
    'QNA_ENABLED',
    'REWARDS_ENABLED',
    'ADS_ENABLED',
    'LIVE_STREAMS_ENABLED',
    'DEMO_DATA_ENABLED',
    'SEOUL_REALTIME_ENABLED',
    'SOCIAL_FEED_ENABLED'
  )),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scope_type, scope_key, flag_key)
);

CREATE TABLE IF NOT EXISTS decision_profiles (
  id TEXT PRIMARY KEY,
  profile_key TEXT NOT NULL UNIQUE,
  place_kind TEXT NOT NULL,
  minimum_independent_sources INTEGER NOT NULL DEFAULT 2 CHECK (minimum_independent_sources >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS decision_profile_dimensions (
  profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
    'weather',
    'local_condition',
    'crowd',
    'queue',
    'parking',
    'road_traffic',
    'entry',
    'business_status',
    'stream'
  )),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  importance TEXT NOT NULL CHECK (importance IN ('critical', 'important', 'supporting')),
  positive_value_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(positive_value_codes_json)),
  negative_value_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negative_value_codes_json)),
  PRIMARY KEY (profile_id, dimension)
);

CREATE TABLE IF NOT EXISTS place_decision_profiles (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE RESTRICT,
  assigned_by TEXT NOT NULL DEFAULT 'system',
  manually_verified INTEGER NOT NULL DEFAULT 0 CHECK (manually_verified IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_identity_links_profile ON identity_links(profile_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_normalized ON place_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_place_source_mappings_place ON place_source_mappings(place_id, source_id);
CREATE INDEX IF NOT EXISTS idx_source_health_source_checked ON source_health_logs(source_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_source_started ON api_ingestion_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_flags_scope ON feature_flags(flag_key, scope_type, scope_key);

INSERT OR IGNORE INTO dimension_settings (setting_key, dimension, default_ttl_seconds, current_eligible) VALUES
  ('weather', 'weather', 1800, 1),
  ('local_condition', 'local_condition', 3600, 1),
  ('crowd', 'crowd', 1800, 1),
  ('queue', 'queue', 1200, 1),
  ('parking', 'parking', 900, 1),
  ('road_traffic', 'road_traffic', 600, 1),
  ('entry', 'entry', 1800, 1),
  ('business_status', 'business_status', 3600, 1),
  ('stream', 'stream', 300, 1),
  ('photo_current', NULL, 7200, 1),
  ('photo_feed', NULL, 86400, 0),
  ('report_current', NULL, 10800, 0);

INSERT OR IGNORE INTO feature_flags (scope_type, scope_key, flag_key, enabled) VALUES
  ('global', '*', 'QNA_ENABLED', 0),
  ('global', '*', 'REWARDS_ENABLED', 0),
  ('global', '*', 'ADS_ENABLED', 0),
  ('global', '*', 'LIVE_STREAMS_ENABLED', 0),
  ('global', '*', 'DEMO_DATA_ENABLED', 0),
  ('global', '*', 'SEOUL_REALTIME_ENABLED', 0),
  ('global', '*', 'SOCIAL_FEED_ENABLED', 0);

INSERT OR IGNORE INTO data_sources (
  id,
  source_key,
  source_name,
  provider_name,
  source_type,
  documentation_url,
  commercial_use_status,
  agreement_required,
  enabled,
  enabled_regions_json,
  health_status
) VALUES
  ('source-user-report', 'user_report', 'User field report', 'Silsigan', 'ugc', NULL, 'allowed', 0, 1, '["*"]', 'healthy'),
  ('source-kma-weather', 'kma_weather', 'KMA short-term forecast', 'Korea Meteorological Administration', 'official_periodic', 'https://www.data.go.kr/data/15084084/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-tour-api', 'tour_api', 'Korean tourism information', 'Korea Tourism Organization', 'official_static', 'https://www.data.go.kr/data/15101578/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-parking', 'national_parking', 'National parking standard data', 'Public Data Portal', 'official_static', 'https://www.data.go.kr/data/15012896/standard.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-traffic', 'national_traffic', 'National road traffic', 'Ministry of Land Infrastructure and Transport', 'official_live', 'https://www.data.go.kr/data/15040463/openapi.do', 'pending', 0, 0, '[]', 'unknown'),
  ('source-national-cctv', 'national_cctv', 'National CCTV metadata', 'Ministry of Land Infrastructure and Transport', 'official_static', 'https://www.data.go.kr/data/15040466/openapi.do', 'pending', 1, 0, '[]', 'unknown'),
  ('source-seoul-realtime', 'seoul_realtime_city', 'Seoul realtime city data', 'Seoul Metropolitan Government', 'official_live', 'https://data.seoul.go.kr/dataList/OA-21285/A/1/datasetView.do', 'pending', 0, 0, '["seoul"]', 'unknown'),
  ('source-youtube-live', 'youtube_live', 'YouTube live embed status', 'YouTube', 'official_periodic', 'https://developers.google.com/youtube/iframe_api_reference', 'pending', 1, 0, '[]', 'unknown');
UPDATE data_sources
SET
  commercial_use_status = 'allowed_with_attribution',
  attribution_text = '기상청',
  refresh_interval_seconds = 3600,
  default_ttl_seconds = 7200,
  owner_contact = 'data-operations',
  last_terms_checked_at = '2026-07-10T00:00:00.000Z',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_key = 'kma_weather';

UPDATE data_sources
SET
  owner_contact = CASE
    WHEN source_key IN ('national_cctv', 'youtube_live') THEN 'legal-safety'
    ELSE 'data-operations'
  END,
  internal_note = CASE
    WHEN source_key = 'tour_api' THEN 'Static place metadata only. Provider images stay disabled until item-level usage rights are verified.'
    WHEN source_key = 'national_parking' THEN 'Static facility metadata only. Never interpret missing or stale rows as current availability.'
    WHEN source_key = 'national_traffic' THEN 'Adapter-ready only. Keep disabled until commercial use, attribution, credentials, and health checks are approved.'
    WHEN source_key = 'national_cctv' THEN 'Metadata only. Do not store, proxy, restream, or expose provider video URLs.'
    WHEN source_key = 'seoul_realtime_city' THEN 'Region-scoped and feature-flagged off until source rights and health checks are approved.'
    WHEN source_key = 'youtube_live' THEN 'Embedding and live-stream feature remain disabled until channel ownership and platform policy review are complete.'
    ELSE internal_note
  END,
  image_use_allowed = CASE WHEN source_key = 'tour_api' THEN 0 ELSE image_use_allowed END,
  video_use_allowed = CASE WHEN source_key IN ('national_cctv', 'youtube_live') THEN 0 ELSE video_use_allowed END,
  enabled = 0,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_key IN ('tour_api', 'national_parking', 'national_traffic', 'national_cctv', 'seoul_realtime_city', 'youtube_live');

INSERT OR IGNORE INTO decision_profiles (id, profile_key, place_kind) VALUES
  ('profile-restaurant', 'restaurant', 'restaurant'),
  ('profile-beach', 'beach', 'beach'),
  ('profile-park', 'park', 'park'),
  ('profile-festival', 'festival', 'festival'),
  ('profile-ski-resort', 'ski_resort', 'ski_resort');

INSERT OR IGNORE INTO decision_profile_dimensions (
  profile_id,
  dimension,
  required,
  importance,
  positive_value_codes_json,
  negative_value_codes_json
) VALUES
  ('profile-restaurant', 'queue', 1, 'critical', '["none","under_10"]', '["30_to_60","60_plus"]'),
  ('profile-restaurant', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-restaurant', 'parking', 0, 'supporting', '["available"]', '["full","closed"]'),
  ('profile-beach', 'weather', 1, 'critical', '["clear","calm"]', '["storm","closed"]'),
  ('profile-beach', 'local_condition', 0, 'critical', '["safe"]', '["danger","closed"]'),
  ('profile-beach', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-beach', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-beach', 'road_traffic', 0, 'supporting', '["smooth"]', '["blocked"]'),
  ('profile-park', 'weather', 1, 'critical', '["clear","calm"]', '["storm"]'),
  ('profile-park', 'local_condition', 0, 'critical', '["safe"]', '["danger","closed"]'),
  ('profile-park', 'crowd', 0, 'important', '["quiet","normal"]', '["packed"]'),
  ('profile-park', 'parking', 0, 'supporting', '["available"]', '["full","closed"]'),
  ('profile-festival', 'crowd', 1, 'critical', '["quiet","normal"]', '["packed"]'),
  ('profile-festival', 'entry', 1, 'critical', '["open"]', '["restricted","closed"]'),
  ('profile-festival', 'queue', 0, 'important', '["none","under_10"]', '["30_to_60","60_plus"]'),
  ('profile-festival', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-festival', 'road_traffic', 0, 'important', '["smooth"]', '["blocked"]'),
  ('profile-ski-resort', 'weather', 1, 'critical', '["clear","snow_good"]', '["storm","closed"]'),
  ('profile-ski-resort', 'road_traffic', 1, 'critical', '["smooth"]', '["blocked","chains_required"]'),
  ('profile-ski-resort', 'parking', 0, 'important', '["available"]', '["full","closed"]'),
  ('profile-ski-resort', 'business_status', 1, 'important', '["open"]', '["closed"]'),
  ('profile-ski-resort', 'stream', 0, 'supporting', '["healthy"]', '["down"]');
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_signals (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
    'weather',
    'local_condition',
    'crowd',
    'queue',
    'parking',
    'road_traffic',
    'entry',
    'business_status',
    'stream'
  )),
  value_code TEXT NOT NULL CHECK (length(value_code) BETWEEN 1 AND 80),
  value_number REAL,
  value_text TEXT CHECK (value_text IS NULL OR length(value_text) <= 500),
  unit TEXT CHECK (unit IS NULL OR length(unit) <= 30),
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'official_live',
    'official_periodic',
    'official_static',
    'venue_operator',
    'verified_ugc',
    'ugc',
    'consensus',
    'model_estimate'
  )),
  source_name TEXT NOT NULL,
  attribution_text TEXT,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  is_estimated INTEGER NOT NULL DEFAULT 0 CHECK (is_estimated IN (0, 1)),
  is_publicly_visible INTEGER NOT NULL DEFAULT 0 CHECK (is_publicly_visible IN (0, 1)),
  evidence_type TEXT CHECK (evidence_type IS NULL OR evidence_type IN (
    'api',
    'camera_capture',
    'gallery_upload',
    'user_report',
    'operator_input',
    'stream'
  )),
  evidence_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'anonymous', 'member')),
  actor_id TEXT,
  idempotency_key TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at > observed_at),
  CHECK (
    (actor_type = 'system' AND actor_id IS NULL) OR
    (actor_type IN ('anonymous', 'member') AND actor_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS official_observations (
  id TEXT PRIMARY KEY,
  live_signal_id TEXT NOT NULL UNIQUE REFERENCES live_signals(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  external_observation_id TEXT,
  raw_payload_hash TEXT NOT NULL CHECK (raw_payload_hash GLOB 'sha256:*'),
  provider_observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS aggregated_place_status (
  place_id TEXT PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  decision_profile_id TEXT NOT NULL REFERENCES decision_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('likely_good', 'check_before_visit', 'likely_crowded', 'insufficient')),
  confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  current_signals_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(current_signals_json)),
  missing_dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(missing_dimensions_json)),
  conflicting_dimensions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicting_dimensions_json)),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  computed_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at IS NULL OR expires_at > computed_at)
);

CREATE INDEX IF NOT EXISTS idx_live_signals_place_dimension_observed
  ON live_signals(place_id, dimension, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_current
  ON live_signals(place_id, is_publicly_visible, expires_at, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_signals_source_fetched
  ON live_signals(source_id, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_signals_idempotency
  ON live_signals(source_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aggregated_status_status
  ON aggregated_place_status(status, computed_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS photo_moderation_states (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'uploaded',
    'scanning',
    'processing',
    'pending_moderation',
    'approved',
    'rejected',
    'hidden',
    'deleted'
  )),
  automated_checks_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(automated_checks_json)),
  risk_flags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(risk_flags_json)),
  reviewer_subject TEXT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS report_votes (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES place_events(id) ON DELETE CASCADE,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('agree', 'changed')),
  location_verified INTEGER NOT NULL DEFAULT 0 CHECK (location_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (report_id, anonymous_user_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  id TEXT PRIMARY KEY,
  blocker_anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  blocked_anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (blocker_anonymous_user_id != blocked_anonymous_user_id),
  UNIQUE (blocker_anonymous_user_id, blocked_anonymous_user_id)
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  actor_identity_key TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('location_verification', 'camera', 'notifications', 'analytics', 'marketing')),
  policy_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (actor_identity_key, purpose, policy_version)
);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id TEXT PRIMARY KEY,
  actor_identity_key TEXT NOT NULL,
  terms_type TEXT NOT NULL CHECK (terms_type IN ('terms', 'privacy', 'location', 'community')),
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  withdrawn_at TEXT,
  UNIQUE (actor_identity_key, terms_type, version)
);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('anonymous', 'member')),
  anonymous_user_id TEXT REFERENCES anonymous_users(id) ON DELETE SET NULL,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  CHECK (
    (actor_type = 'anonymous' AND anonymous_user_id IS NOT NULL AND profile_id IS NULL) OR
    (actor_type = 'member' AND profile_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS identity_link_events (
  id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL REFERENCES anonymous_users(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('linked', 'relinked')),
  server_subject_hash TEXT NOT NULL CHECK (server_subject_hash GLOB 'sha256:*'),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_moderation_status ON photo_moderation_states(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_votes_report ON report_votes(report_id, vote_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_anonymous_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletion_actor ON account_deletion_requests(actor_type, anonymous_user_id, profile_id, requested_at DESC);

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

CREATE TABLE IF NOT EXISTS photo_cleanup_jobs (
  id TEXT PRIMARY KEY,
  photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  budget_released_at TEXT,
  completed_at TEXT,
  dead_lettered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_photo_cleanup_jobs_pending
  ON photo_cleanup_jobs(status, next_attempt_at, lease_expires_at, created_at);

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

CREATE TABLE IF NOT EXISTS photo_storage_releases (
  storage_key TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  release_token TEXT NOT NULL UNIQUE,
  released_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_storage_releases_released
  ON photo_storage_releases(released_at DESC);

INSERT OR IGNORE INTO photo_storage_releases (storage_key, byte_size, release_token, released_at)
SELECT
  storage_key,
  byte_size,
  'schema-bootstrap-' || id,
  COALESCE(budget_released_at, completed_at, updated_at)
FROM photo_cleanup_jobs
WHERE budget_released_at IS NOT NULL;

UPDATE photo_storage_budget
SET active_bytes = MAX(
      active_bytes,
      COALESCE((
        SELECT SUM(byte_size)
        FROM photos
        WHERE deleted_at IS NULL AND status <> 'rejected'
      ), 0)
      + COALESCE((
        SELECT SUM(byte_size)
        FROM (
          SELECT storage_key, MAX(byte_size) AS byte_size
          FROM photo_cleanup_jobs
          WHERE budget_released_at IS NULL
            AND status IN ('pending', 'processing', 'failed')
          GROUP BY storage_key
        ) pending_cleanup
      ), 0)
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1;

CREATE TABLE IF NOT EXISTS photo_upload_claims (
  upload_id TEXT PRIMARY KEY,
  anonymous_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_claims_consumed
  ON photo_upload_claims(consumed_at);

CREATE TABLE IF NOT EXISTS photo_abuse_budget (
  principal_hash TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  upload_count INTEGER NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  bytes_in_period INTEGER NOT NULL DEFAULT 0 CHECK (bytes_in_period >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_hash, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_photo_abuse_budget_updated
  ON photo_abuse_budget(updated_at);

CREATE TABLE IF NOT EXISTS photo_upload_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uploads_enabled INTEGER NOT NULL DEFAULT 1 CHECK (uploads_enabled IN (0, 1)),
  reason TEXT,
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_upload_control (id, uploads_enabled, reason, updated_by, updated_at)
VALUES (1, 1, 'initial-enabled', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS photo_read_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  period_utc TEXT NOT NULL CHECK (period_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  reads_in_period INTEGER NOT NULL DEFAULT 0 CHECK (reads_in_period >= 0),
  day_utc TEXT NOT NULL CHECK (day_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reads_in_day INTEGER NOT NULL DEFAULT 0 CHECK (reads_in_day >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_read_budget (id, period_utc, reads_in_period, day_utc, reads_in_day, updated_at)
VALUES (1, strftime('%Y-%m', 'now'), 0, strftime('%Y-%m-%d', 'now'), 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS photo_read_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reads_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reads_enabled IN (0, 1)),
  reason TEXT,
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_read_control (id, reads_enabled, reason, updated_by, updated_at)
VALUES (1, 1, 'initial-enabled', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS photo_read_abuse_budget (
  principal_hash TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (principal_hash, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_photo_read_abuse_budget_updated
  ON photo_read_abuse_budget(updated_at);

CREATE TABLE IF NOT EXISTS photo_transform_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  period_utc TEXT NOT NULL CHECK (period_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  transforms_in_period INTEGER NOT NULL DEFAULT 0 CHECK (transforms_in_period >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO photo_transform_budget (id, period_utc, transforms_in_period, updated_at)
SELECT
  1,
  strftime('%Y-%m', 'now'),
  COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END), 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM photos;

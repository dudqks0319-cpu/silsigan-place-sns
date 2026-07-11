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

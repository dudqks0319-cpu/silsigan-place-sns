-- Accept user-suggested places into a review-only queue. This flow never
-- creates or updates rows in places; manual import remains an operator step.
-- 1,600 requests is the fixed 80% stop for the deliberately conservative
-- 2,000/day application ceiling. A request also updates indexes and the
-- budget row, so this leaves substantial account-wide D1 write headroom.

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
  SELECT RAISE(ABORT, 'PLACE_REQUEST_SESSION_DAILY_LIMIT')
  WHERE (
    SELECT COUNT(*)
    FROM place_addition_requests
    WHERE anonymous_user_id = NEW.anonymous_user_id
      AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')
      AND created_at < strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')
  ) >= 3;

  INSERT INTO place_addition_request_daily_budget (day_utc, request_count, updated_at)
  VALUES (strftime('%Y-%m-%d', 'now'), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(day_utc) DO UPDATE SET
    request_count = place_addition_request_daily_budget.request_count + 1,
    updated_at = excluded.updated_at
  WHERE place_addition_request_daily_budget.request_count < 1600;

  SELECT RAISE(ABORT, 'PLACE_REQUEST_DAILY_BUDGET_80_PERCENT_STOP')
  WHERE changes() != 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_place_addition_requests_terminal_status
BEFORE UPDATE OF status ON place_addition_requests
WHEN OLD.status IN ('duplicate', 'rejected') AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'PLACE_REQUEST_TERMINAL_STATUS');
END;

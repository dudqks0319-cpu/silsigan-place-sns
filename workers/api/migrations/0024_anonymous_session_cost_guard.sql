-- Cap anonymous-session issuance with an exact D1-wide daily counter. The
-- Cloudflare Rate Limiting binding remains a first-line per-location control,
-- while this ledger provides the fail-closed global cost boundary.

CREATE TABLE IF NOT EXISTS anonymous_session_issuance_budget (
  day_utc TEXT PRIMARY KEY,
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

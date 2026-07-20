-- Account-wide application guard for Workers requests and D1 row operations.
-- The app stops non-essential work at 70% and reserves the final 10% up to
-- the user's fixed 80% ceiling for privacy deletion and emergency controls.

CREATE TABLE IF NOT EXISTS api_cost_guard_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'running'
    CHECK (mode IN ('running', 'degraded', 'stopped')),
  reason TEXT NOT NULL DEFAULT 'initial-enabled'
    CHECK (length(reason) BETWEEN 1 AND 300),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  automatic_metric TEXT
    CHECK (automatic_metric IS NULL OR automatic_metric IN (
      'workers_requests', 'd1_rows_read', 'd1_rows_written', 'manual'
    )),
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO api_cost_guard_control
  (id, mode, reason, generation, automatic_metric, updated_by, updated_at)
VALUES
  (1, 'running', 'initial-enabled', 1, NULL, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS api_cost_guard_daily (
  day_utc TEXT PRIMARY KEY
    CHECK (day_utc GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
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

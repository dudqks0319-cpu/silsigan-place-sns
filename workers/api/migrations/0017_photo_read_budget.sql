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

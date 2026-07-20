-- Add a coarse, non-identifying location accuracy bucket to field events.
-- The raw browser/native accuracy remains request-scoped and is never copied
-- into D1, responses, logs, or analytics.
ALTER TABLE place_events
  ADD COLUMN accuracy_bucket TEXT NOT NULL DEFAULT 'unknown'
  CHECK (accuracy_bucket IN ('high', 'medium', 'low', 'unknown'));

-- Keep legacy place events visible while putting newly created field reports
-- through an explicit moderation queue before they affect public surfaces.
ALTER TABLE place_events
  ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden'));

CREATE INDEX IF NOT EXISTS idx_place_events_field_report_moderation
  ON place_events(event_type, source, moderation_status, created_at DESC);

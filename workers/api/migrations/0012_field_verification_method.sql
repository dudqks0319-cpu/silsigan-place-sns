-- Preserve how a field report was verified without storing raw coordinates.
-- Existing coarse-radius rows are backfilled as radius; new polygon rows use polygon.
ALTER TABLE place_events
  ADD COLUMN verification_method TEXT NOT NULL DEFAULT 'none'
  CHECK (verification_method IN ('none', 'radius', 'polygon'));

UPDATE place_events
SET verification_method = 'radius'
WHERE verified_radius_m IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_place_events_verification_method
  ON place_events(place_id, verification_method, created_at DESC);

-- Per-partner toggle for cross-year student ID matching.
-- Temporary feature until ID resolution service exists; safe default is off.
ALTER TABLE partner
  ADD COLUMN cross_year_matching_enabled BOOLEAN NOT NULL DEFAULT false;

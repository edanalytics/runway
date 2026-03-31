-- Make ods_id nullable (no-ODS jobs won't have an ODS reference)
ALTER TABLE job ALTER COLUMN ods_id DROP NOT NULL;

-- Snapshot the school year config's send_to_ods at job creation time
ALTER TABLE job ADD COLUMN send_to_ods BOOLEAN NOT NULL DEFAULT true;

-- Invariant: if send_to_ods is true, ods_id must be set
ALTER TABLE job ADD CONSTRAINT job_ods_or_no_send
  CHECK (ods_id IS NOT NULL OR send_to_ods = false);

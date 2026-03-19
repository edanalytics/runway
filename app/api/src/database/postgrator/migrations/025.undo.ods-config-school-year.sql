-- Backfill ods_connection.school_year_id from ods_config for connections created
-- after migration 025 (which stopped writing school_year_id to connections)
UPDATE public.ods_connection conn
SET school_year_id = oc.school_year_id
FROM public.ods_config oc
WHERE conn.ods_config_id = oc.id
  AND conn.school_year_id IS NULL;

ALTER TABLE public.ods_connection ALTER COLUMN school_year_id SET NOT NULL;
DROP INDEX IF EXISTS uq_ods_config_tenant_partner_year_active;
ALTER TABLE public.ods_config DROP COLUMN IF EXISTS school_year_id;

-- Add school_year_id to ods_config (nullable initially for backfill)
ALTER TABLE public.ods_config
  ADD COLUMN school_year_id VARCHAR REFERENCES public.school_year(id) ON DELETE RESTRICT;

-- Backfill from active connection (all configs have an active connection,
-- including retired ones, since retire does not clear active_connection_id)
UPDATE public.ods_config oc
SET school_year_id = conn.school_year_id
FROM public.ods_connection conn
WHERE oc.active_connection_id = conn.id;

-- Now safe to make NOT NULL
ALTER TABLE public.ods_config
  ALTER COLUMN school_year_id SET NOT NULL;

-- Partial unique index: one active (non-retired) ODS per tenant+partner+year
-- NOTE: This will fail if duplicate non-retired configs exist for the same
-- (tenant_code, partner_id, school_year_id). Run the pre-migration check script
-- to identify duplicates before applying this migration.
CREATE UNIQUE INDEX uq_ods_config_tenant_partner_year_active
ON public.ods_config (tenant_code, partner_id, school_year_id)
WHERE retired = false;

-- Stop requiring school_year_id on ods_connection (no longer written on new connections)
ALTER TABLE public.ods_connection ALTER COLUMN school_year_id DROP NOT NULL;

ALTER TABLE public.partner
  DROP COLUMN managed_by,
  DROP COLUMN deleted_on;

ALTER TABLE public.tenant
  DROP COLUMN managed_by,
  DROP COLUMN is_global,
  DROP COLUMN deleted_on;

DROP TYPE sync_manager;

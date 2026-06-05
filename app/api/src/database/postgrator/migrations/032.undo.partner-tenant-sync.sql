-- Revert: remove soft-delete and sync management columns from partner table
ALTER TABLE public.partner
  DROP COLUMN sync_managed,
  DROP COLUMN deleted_on;

-- Revert: remove soft-delete, sync management, and AL sync fields from tenant table
ALTER TABLE public.tenant
  DROP COLUMN sync_managed,
  DROP COLUMN is_global,
  DROP COLUMN children,
  DROP COLUMN deleted_on;

-- Revert: drop metatenants junction table
DROP TABLE public.metatenants;

-- Revert: remove columns from tenant table
ALTER TABLE public.tenant
  DROP COLUMN managed_by,
  DROP COLUMN is_global,
  DROP COLUMN deleted_on;

-- Revert: remove columns from partner table
ALTER TABLE public.partner
  DROP COLUMN managed_by,
  DROP COLUMN deleted_on;

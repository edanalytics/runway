-- Add soft-delete and management columns to partner table
ALTER TABLE public.partner
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN managed_by VARCHAR; -- 'manual' | null (null = managed by sync)

-- Add soft-delete, management, and is_global to tenant table
ALTER TABLE public.tenant
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN managed_by VARCHAR; -- 'manual' | null (null = managed by sync)

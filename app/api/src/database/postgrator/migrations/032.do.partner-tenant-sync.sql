-- Add soft-delete and sync management columns to partner table
ALTER TABLE public.partner
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN sync_managed BOOLEAN NOT NULL DEFAULT false;

-- Add soft-delete, sync management, and AL sync fields to tenant table
ALTER TABLE public.tenant
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN children TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN sync_managed BOOLEAN NOT NULL DEFAULT false;

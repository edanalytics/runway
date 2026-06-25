CREATE TYPE sync_manager AS ENUM ('user_management_sync', 'tx_sync');

-- Add soft-delete and management columns to partner table
ALTER TABLE public.partner
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN managed_by sync_manager;

-- Add soft-delete, management, and is_global to tenant table
ALTER TABLE public.tenant
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

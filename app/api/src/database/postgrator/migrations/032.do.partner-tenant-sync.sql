-- Add soft-delete and management columns to partner table
ALTER TABLE public.partner
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN managed_by VARCHAR; -- 'manual' | null (null = managed by sync)

-- Add soft-delete, management, and is_global to tenant table
ALTER TABLE public.tenant
  ADD COLUMN deleted_on TIMESTAMP,
  ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN managed_by VARCHAR; -- 'manual' | null (null = managed by sync)

-- Create metatenants junction table for parent/child relationships
CREATE TABLE public.metatenants (
  partner_id VARCHAR NOT NULL,
  parent_tenant_code VARCHAR NOT NULL,
  child_tenant_code VARCHAR NOT NULL,

  PRIMARY KEY (partner_id, parent_tenant_code, child_tenant_code),

  CONSTRAINT fk_metatenants_parent FOREIGN KEY (parent_tenant_code, partner_id)
    REFERENCES public.tenant(code, partner_id) ON DELETE CASCADE,
  CONSTRAINT fk_metatenants_child FOREIGN KEY (child_tenant_code, partner_id)
    REFERENCES public.tenant(code, partner_id) ON DELETE CASCADE
);

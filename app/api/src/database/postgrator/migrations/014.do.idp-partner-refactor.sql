----------------------------------
-- This migration lays the groundwork to enable multiple partners to share the same IdP. 
-- The core changes is to update the tenant PK to be tenant_code + partner_id, not tenant_code + idp_id.
-- 
-- NOTE: user will still base scoped based on idp_id since we want user records to be sharable 
-- across partners within the same IdP (e.g. EA staff logging into different partners via UM).
--  
-- The CASCADES in this migration preserve existing behavior. The tenant.partner_id FK will RESTRICT 
-- on delete. Deleting a partner is not something we want to make too easy. However, we cascade deletes 
-- on FKs to tenant as deleting a tenant is a need that is more likely to come up. 
----------------------------------

BEGIN TRANSACTION;

-- 1. Add a partner_id column to tables that have foreign key references to the tenant table
--    These do not need to be FK references to partner since these columns are only needed to 
--    help make the composite FK reference to tenant.
ALTER TABLE job ADD COLUMN partner_id varchar;
ALTER TABLE ods_config ADD COLUMN partner_id varchar;
ALTER TABLE user_tenant ADD COLUMN partner_id varchar;

-- 2. Populate the new partner_id columns with identity_provider.partner_id
UPDATE job SET partner_id = (SELECT partner_id FROM identity_provider WHERE id = job.idp_id);
UPDATE ods_config SET partner_id = (SELECT partner_id FROM identity_provider WHERE id = ods_config.idp_id);
UPDATE user_tenant SET partner_id = (SELECT partner_id FROM identity_provider WHERE id = user_tenant.idp_id);

-- 3. Add a not null constraint to the new partner_id columns
ALTER TABLE job ALTER COLUMN partner_id SET NOT NULL;
ALTER TABLE ods_config ALTER COLUMN partner_id SET NOT NULL;
ALTER TABLE user_tenant ALTER COLUMN partner_id SET NOT NULL;

-- 4. Drop old constraints, FKs first, then PKs
ALTER TABLE job DROP CONSTRAINT job_tenant_code_idp_id_fkey;
ALTER TABLE ods_config DROP CONSTRAINT ods_config_tenant_code_idp_id_fkey;
ALTER TABLE user_tenant DROP CONSTRAINT user_tenant_tenant_code_idp_id_fkey;

ALTER TABLE tenant DROP CONSTRAINT tenant_pkey CASCADE;
ALTER TABLE user_tenant DROP CONSTRAINT user_tenant_pkey CASCADE;

-- 5. Add the new PK and FKs based on tenant_code + partner_id
ALTER TABLE tenant ADD PRIMARY KEY (code, partner_id);
ALTER TABLE user_tenant ADD PRIMARY KEY (user_id, tenant_code, partner_id);

ALTER TABLE job ADD CONSTRAINT job_tenant_code_partner_id_fkey FOREIGN KEY (tenant_code, partner_id) REFERENCES tenant (code, partner_id) ON DELETE CASCADE;
ALTER TABLE ods_config ADD CONSTRAINT ods_config_tenant_code_partner_id_fkey FOREIGN KEY (tenant_code, partner_id) REFERENCES tenant (code, partner_id) ON DELETE CASCADE;
ALTER TABLE user_tenant ADD CONSTRAINT user_tenant_tenant_code_partner_id_fkey FOREIGN KEY (tenant_code, partner_id) REFERENCES tenant (code, partner_id) ON DELETE CASCADE;

-- 6. Remove idp_id column from the tenant table and tables that have FK references to the tenant table
ALTER TABLE tenant DROP COLUMN idp_id;
ALTER TABLE job DROP COLUMN idp_id;
ALTER TABLE ods_config DROP COLUMN idp_id;
ALTER TABLE user_tenant DROP COLUMN idp_id;

COMMIT;
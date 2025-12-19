/*
  This migration flips the relationship between partner and identity_provider. 
  Before: identity_provider pointed to partner, and multiple identity_providers could point to the same partner
  After: partner points to identity_provider, and each partner is now only associated with one identity_provider

  The goal of this change is to allow a single IdP to be used by multiple partners. Currently, there is one active
  identity_provider row (where active means oidc_config_id is not null) per partner, so this change will preserve 
  existing relationships. 
*/

BEGIN;

ALTER TABLE partner ADD COLUMN idp_id varchar REFERENCES identity_provider(id) ON DELETE SET NULL;

/*
  Populate the new column. This assumes that each partner is referenced by only one row in identity_provider
  (where there's a non-null oidc_config_id). That is true of deployed environments currently. Note that there
  are some identity_provider rows in dev that reference the 'ea' partner and have a null oidc_config. These
  are left over from before we had UM to integrate with. Users owned by these identity_providers are essentially
  orphans... and have been ever since we stopped using those IdPs. 
*/
UPDATE partner SET idp_id = (SELECT id FROM identity_provider WHERE partner_id = partner.id AND oidc_config_id IS NOT NULL);

ALTER TABLE identity_provider DROP COLUMN partner_id;

COMMIT;
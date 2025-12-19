/*
  In the previous migration, we updated the PK for bundle_descriptor_mapping to include the edfi_default_descriptor column
  and also update the FK constraint on custom_descriptor_mapping to include the edfi_default_descriptor column. BUT I 
  also needed to update the PK for custom_descriptor_mapping. That's necessary for us to override each default descriptor
  with a separate custom descriptor. 

*/

BEGIN;

ALTER TABLE custom_descriptor_mapping DROP CONSTRAINT custom_descriptor_mapping_pkey;
ALTER TABLE custom_descriptor_mapping ADD CONSTRAINT custom_descriptor_mapping_pkey PRIMARY KEY (partner_id, bundle_key, descriptor_type, left_hand_side_columns, edfi_default_descriptor);

COMMIT;
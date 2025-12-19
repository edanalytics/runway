BEGIN;

/*
  The PK for bundle_descriptor_mapping needs to include edfi_default_descriptor.
*/

-- First, add col to custom_descriptor_mapping, populate it, and then make it not-nullable
ALTER TABLE custom_descriptor_mapping ADD COLUMN edfi_default_descriptor varchar;
UPDATE custom_descriptor_mapping SET edfi_default_descriptor = (
    SELECT edfi_default_descriptor 
    FROM bundle_descriptor_mapping 
    WHERE bundle_descriptor_mapping.bundle_key = custom_descriptor_mapping.bundle_key 
        AND bundle_descriptor_mapping.descriptor_type = custom_descriptor_mapping.descriptor_type 
        AND bundle_descriptor_mapping.left_hand_side_columns = custom_descriptor_mapping.left_hand_side_columns
);
ALTER TABLE custom_descriptor_mapping ALTER COLUMN edfi_default_descriptor SET NOT NULL;

-- Drop FK constraint, then PK
ALTER TABLE custom_descriptor_mapping DROP CONSTRAINT custom_descriptor_mapping_bundle_key_descriptor_type_left__fkey;
ALTER TABLE bundle_descriptor_mapping DROP CONSTRAINT bundle_descriptor_mapping_pkey;

-- Update PK for bundle_descriptor_mapping and new FK constraint on custom_descriptor_mapping (with clearer name than previously)
ALTER TABLE bundle_descriptor_mapping ADD PRIMARY KEY (bundle_key, descriptor_type, left_hand_side_columns, edfi_default_descriptor);
ALTER TABLE custom_descriptor_mapping 
    ADD CONSTRAINT custom_descriptor_mapping_to_bundle_descriptor_mapping_fkey 
        FOREIGN KEY (bundle_key, descriptor_type, left_hand_side_columns, edfi_default_descriptor) 
        REFERENCES bundle_descriptor_mapping (bundle_key, descriptor_type, left_hand_side_columns, edfi_default_descriptor) 
        ON DELETE CASCADE;

COMMIT;
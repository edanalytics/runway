BEGIN;

ALTER TABLE public.partner ADD COLUMN descriptor_namespace varchar;
COMMENT on COLUMN public.partner."descriptor_namespace" IS 'Earthmover accommodates custom descriptors in two ways. One is with custom mappings, specified in the custom_descriptor_mapping table. These allow for granular mappings. The other way is it will use the EdFi default descriptors, but swap out the EdFi namespace for a partner-specific namespace. This columns specifies that partner-specific namespace.';

COMMIT;
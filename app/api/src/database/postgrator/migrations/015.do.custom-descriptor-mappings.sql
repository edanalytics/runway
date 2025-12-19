BEGIN;

-- We thought we'd do descriptor mapping in the beta release but did not.
-- This table is unused and the requrements have changed so we're scrapping it.
DROP TABLE IF EXISTS public.descriptor_mapping;

CREATE TABLE public.bundle_descriptor_mapping (
    bundle_key varchar NOT NULL REFERENCES public.earthmover_bundle (key) ON DELETE CASCADE,
    descriptor_type varchar NOT NULL,
    left_hand_side_columns jsonb NOT NULL,
    edfi_default_descriptor varchar NOT NULL,
    PRIMARY KEY (bundle_key, descriptor_type, left_hand_side_columns),

    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
);

CREATE TRIGGER create_meta BEFORE INSERT ON public.bundle_descriptor_mapping FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.bundle_descriptor_mapping FOR EACH ROW EXECUTE FUNCTION update_meta ();

CREATE TABLE public.custom_descriptor_mapping (
    bundle_key varchar NOT NULL REFERENCES public.earthmover_bundle (key) ON DELETE CASCADE,
    descriptor_type varchar NOT NULL,
    left_hand_side_columns jsonb NOT NULL,

    partner_id varchar NOT NULL REFERENCES public.partner (id) ON DELETE CASCADE,
    custom_descriptor varchar,
    PRIMARY KEY (partner_id, bundle_key, descriptor_type, left_hand_side_columns),
    FOREIGN KEY (bundle_key, descriptor_type, left_hand_side_columns) 
        REFERENCES public.bundle_descriptor_mapping (bundle_key, descriptor_type, left_hand_side_columns) ON DELETE CASCADE,

    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
);

COMMENT on COLUMN public.custom_descriptor_mapping."custom_descriptor" IS 'If null, values that match the left hand side will map to `null` instead of a descriptor. This is useful when downstream systems are able to fill in a value that is more meaningful than whatever is included in the input file. For example, assessment vendors might include a grade level that would map to a "No grade level" descriptor. But if we instead leave the field null, Stadium can fill in the student''s enrolled grade.';

CREATE TRIGGER create_meta BEFORE INSERT ON public.custom_descriptor_mapping FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.custom_descriptor_mapping FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMIT;
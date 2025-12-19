---------------------
-- EARTHMOVER BUNDLE
---------------------
CREATE TABLE
  public.earthmover_bundle (
    key varchar NOT NULL PRIMARY KEY
  ); 

COMMENT ON TABLE public.earthmover_bundle IS 'This table contains keys of the earthmover bundles that Runway is allowed to use and it might someday be extended with Runway-specific bundle settings. The bundle registry, not this table, is the source of truth for bundle data.';

-------------------------------------
-- PARTNER / EARTHMOVER BUNDLE LINK
-------------------------------------
CREATE TABLE
  public.partner_earthmover_bundle (
    partner_id varchar NOT NULL REFERENCES public.partner (id) ON DELETE CASCADE,
    earthmover_bundle_key varchar NOT NULL REFERENCES public.earthmover_bundle (key) ON DELETE CASCADE,
    PRIMARY KEY (partner_id, earthmover_bundle_key)
  );


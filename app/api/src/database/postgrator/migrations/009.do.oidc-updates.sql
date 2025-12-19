ALTER TABLE public.oidc_config ADD COLUMN use_pkce BOOLEAN DEFAULT false;
ALTER TABLE public.oidc_config ADD COLUMN scopes varchar DEFAULT 'openid profile email';

ALTER TABLE public.oidc_config ADD COLUMN require_role BOOLEAN DEFAULT true;
ALTER TABLE public.oidc_config ADD COLUMN roles_claim varchar;
ALTER TABLE public.oidc_config ADD COLUMN required_roles varchar[];

COMMENT ON COLUMN public.oidc_config.require_role IS 'If set to true, users will not be able to log in unless they have one of the roles in required_roles in the claim in roles_claim. If false, no role requirement is enforced. Defaults to true to ensure incomplete setup does not allow unauthorized access.';
COMMENT ON COLUMN public.oidc_config.required_roles IS 'If multiple roles are listed here, users will be allowed to log in if they have any one of the listed roles.';
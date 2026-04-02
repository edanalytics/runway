DROP TRIGGER IF EXISTS idp_config_changed_oidc_config ON public.oidc_config;
DROP TRIGGER IF EXISTS idp_config_changed_identity_provider ON public.identity_provider;
DROP TRIGGER IF EXISTS idp_config_changed_partner ON public.partner;
DROP TRIGGER IF EXISTS idp_config_changed_partner_update ON public.partner;
DROP FUNCTION IF EXISTS notify_idp_config_changed();

CREATE OR REPLACE FUNCTION notify_idp_config_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('idp_config_changed', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER idp_config_changed_oidc_config
  AFTER INSERT OR UPDATE OR DELETE ON public.oidc_config
  FOR EACH STATEMENT EXECUTE FUNCTION notify_idp_config_changed();

CREATE TRIGGER idp_config_changed_identity_provider
  AFTER INSERT OR UPDATE OR DELETE ON public.identity_provider
  FOR EACH STATEMENT EXECUTE FUNCTION notify_idp_config_changed();

CREATE TRIGGER idp_config_changed_partner
  AFTER INSERT OR DELETE ON public.partner
  FOR EACH STATEMENT EXECUTE FUNCTION notify_idp_config_changed();

CREATE TRIGGER idp_config_changed_partner_update
  AFTER UPDATE OF idp_id ON public.partner
  FOR EACH STATEMENT EXECUTE FUNCTION notify_idp_config_changed();

---------------------
-- USER
---------------------
CREATE TABLE
  public.user (
    id serial NOT NULL PRIMARY KEY,
    email varchar NOT NULL,
    given_name varchar NOT NULL,
    family_name varchar NOT NULL,
    idp_id varchar NOT NULL, -- FK added later
    external_user_id varchar NOT NULL,
    created_by_id integer NULL REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer NULL REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL,
    CONSTRAINT unique_external_user_id UNIQUE (external_user_id, idp_id)
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.user FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.user FOR EACH ROW EXECUTE FUNCTION update_meta ();


---------------------
-- PARTNER
---------------------

CREATE TABLE
  public.partner(
    id varchar NOT NULL PRIMARY KEY,
    name varchar NOT NULL,    
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.partner FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.partner FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on COLUMN public.partner."id" IS 'Use a legible ID for the partner, e.g. "TX" or "SC" so that reference in other tables are easy to understand.';

-----------------------
-- OIDC CONFIG
-----------------------

CREATE TABLE
  public.oidc_config (
    id varchar NOT NULL PRIMARY KEY,
    issuer varchar NOT NULL,
    client_id varchar NOT NULL,
    client_secret varchar NOT NULL,
    user_id_claim varchar NOT NULL,
    tenant_code_claim varchar NOT NULL,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.oidc_config FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.oidc_config FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on COLUMN public.oidc_config."issuer" IS 'Should not include `/.well-known/openid-configuration`.';
COMMENT on COLUMN public.oidc_config."user_id_claim" IS 'The claim from the IdP that contains the unique user ID. Ex: "sub" or "preferred_username".';
COMMENT on COLUMN public.oidc_config."tenant_code_claim" IS 'The claim from the IdP that contains the tenant code for the tenant in which the user is authenticating.';

-----------------------
-- IDENTITY PROVIDER
-----------------------

CREATE TABLE
  public.identity_provider (
    id varchar NOT NULL PRIMARY KEY,
    partner_id varchar NOT NULL REFERENCES public.partner (id) ON DELETE RESTRICT,
    fe_home varchar NOT NULL,
    oidc_config_id varchar REFERENCES public.oidc_config (id) ON DELETE SET NULL,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.identity_provider FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.identity_provider FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on TABLE public.identity_provider IS 'Users and tenants are scoped to an IdP. OIDC config is separated out so that references to IdPs remain stable even as the config may change. If changing an OIDC config, you may want a row for a test IdP config while you test. Then, when the OIDC config is good to go, you have the prod IdP row point to the new config.';
COMMENT on COLUMN public.identity_provider."fe_home" IS 'The protocol, hostname, and port of the App FE server. Ex: https://app-fe.education.alaska.gov.';

-------------------
-- TENANT
-------------------

CREATE TABLE
  public.tenant (
    code varchar NOT NULL,
    idp_id varchar NOT NULL REFERENCES public.identity_provider (id) ON DELETE RESTRICT,
    partner_id varchar NOT NULL REFERENCES public.partner (id) ON DELETE RESTRICT,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL,
    PRIMARY KEY (code, idp_id)
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.tenant FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.tenant FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on COLUMN public.tenant."code" IS 'Tenant code might be the only information received from the IdP about the tenant.';

------------------------------
-- USER / TENANT RELATIONSHIP
------------------------------

CREATE TABLE
  public.user_tenant (
    user_id integer NOT NULL REFERENCES public."user" (id) ON DELETE CASCADE,
    tenant_code varchar NOT NULL,
    idp_id varchar NOT NULL,
    PRIMARY KEY (user_id, tenant_code, idp_id),
    FOREIGN KEY (tenant_code, idp_id) REFERENCES public.tenant (code, idp_id) ON DELETE CASCADE
  );


---------------------
-- FORIEGN KEYS
---------------------
ALTER TABLE public."user" ADD FOREIGN KEY (idp_id) REFERENCES public.identity_provider (id) ON DELETE RESTRICT;

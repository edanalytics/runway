------------------
-- SCHOOL YEAR
------------------
CREATE TABLE
  public.school_year(
    id varchar NOT NULL PRIMARY KEY,
    start_year integer NOT NULL,
    end_year integer NOT NULL
  );

------------------
-- ODS CONFIG
------------------

CREATE TABLE
  public.ods_config(
    id serial NOT NULL PRIMARY KEY,
    tenant_code varchar NOT NULL ,
    idp_id varchar NOT NULL,
    active_connection_id integer,
    retired boolean NOT NULL DEFAULT false,
    retired_on timestamp,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL,
    FOREIGN KEY (tenant_code, idp_id) REFERENCES public.tenant (code, idp_id) on DELETE CASCADE
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.ods_config FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.ods_config FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on COLUMN public.ods_config."active_connection_id" IS 'Credentials currently in use for this ODS. Previous credentials can be found in ods_connection table.';

--------------------
-- ODS CREDENTIALS
--------------------
CREATE TYPE ods_auth_response AS ENUM ('success', 'error');
CREATE TABLE
  public.ods_connection(
    id serial NOT NULL PRIMARY KEY,
    ods_config_id integer NOT NULL REFERENCES public.ods_config (id) ON DELETE CASCADE,
    school_year_id varchar NOT NULL REFERENCES public.school_year (id) ON DELETE RESTRICT,
    host varchar NOT NULL,    
    client_id varchar NOT NULL,
    client_secret varchar NOT NULL,
    last_use_result ods_auth_response NOT NULL DEFAULT 'success', 
    last_use_on timestamp,
    retired boolean NOT NULL DEFAULT false,
    retired_on timestamp,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.ods_connection FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.ods_connection FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT on COLUMN public.ods_connection."school_year_id" IS 'The school year of the ODS.';
COMMENT on COLUMN public.ods_connection."last_use_result" IS 'The result of the last authentication attempt using these credentials.';
COMMENT on COLUMN public.ods_connection."last_use_on" IS 'The last time these credentials were used, successfully or unsuccessfully.';
COMMENT on COLUMN public.ods_connection."retired" IS 'If no longer used as the active creds of an ODS. We still keep the record for historical purposes.';

-- DESCRIPTOR MAPPING

CREATE TABLE
  public.descriptor_mapping(
    id serial NOT NULL PRIMARY KEY,
    ods_config_id integer NOT NULL REFERENCES public.ods_config (id) ON DELETE CASCADE,
    edfi_default_descriptor varchar NOT NULL,
    ods_custom_descriptor varchar NOT NULL,
    descriptor_type varchar NOT NULL,

    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
  );

CREATE TRIGGER create_meta BEFORE INSERT ON public.descriptor_mapping FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.descriptor_mapping FOR EACH ROW EXECUTE FUNCTION update_meta ();


-- CONSTRAINTS
ALTER TABLE public.ods_config ADD FOREIGN KEY (active_connection_id) REFERENCES public.ods_connection (id) on DELETE RESTRICT;
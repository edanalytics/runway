CREATE TYPE job_config_status as ENUM('initialized', 'file_upload_complate', 'input_complete', 'submitted');
CREATE TABLE
    public.job (
        id serial NOT NULL PRIMARY KEY,
        name varchar NOT NULL,
        ods_id integer NOT NULL REFERENCES public.ods_config (id) ON DELETE CASCADE,
        school_year_id varchar NOT NULL REFERENCES public.school_year (id) ON DELETE CASCADE,
        template jsonb NOT NULL,
        config_status job_config_status NOT NULL DEFAULT 'initialized',
        tenant_code varchar NOT NULL,
        idp_id varchar NOT NULL,
        input_params jsonb,
        previous_job_id integer,
        created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        created_on timestamp DEFAULT now () NOT NULL,
        modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        modified_on timestamp DEFAULT now () NOT NULL,
        FOREIGN KEY (tenant_code, idp_id) REFERENCES public.tenant (code, idp_id) on DELETE CASCADE

    );

CREATE TRIGGER create_meta BEFORE INSERT ON public.job FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.job FOR EACH ROW EXECUTE FUNCTION update_meta ();

ALTER TABLE public.job ADD FOREIGN KEY (previous_job_id) REFERENCES public.job (id) ON DELETE SET NULL;

COMMENT ON TABLE public.job IS 'A job contains the configuration needed to process an assessment file. Once a run is created for the job, we treat the job as immutable and any configuration changes will result in a new job.';
COMMENT ON COLUMN public.job."template" IS 'This is the Earthmover bundle and any other template info that we use to gather input from the user.';
COMMENT ON COLUMN public.job."input_params" IS 'User-entered configuration for the job, based on the data required by the template.';
COMMENT ON COLUMN public.job."config_status" IS 'Preparing a job to be submitted is a multi-step process. This status indicates where we are in that process. Once submitted, the job is no longer editable.';
COMMENT ON COLUMN public.job."previous_job_id" IS 'It may take multiple jobs to fully process an assessment file. This field links those jobs together.';

CREATE TYPE run_status AS ENUM ('new', 'running', 'success', 'error');
CREATE TABLE
    public.run (
        id serial NOT NULL PRIMARY KEY,
        job_id integer NOT NULL REFERENCES public.job (id) ON DELETE CASCADE,
        status run_status NOT NULL DEFAULT 'new',
        created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        created_on timestamp DEFAULT now () NOT NULL,
        modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        modified_on timestamp DEFAULT now () NOT NULL
    );

CREATE TRIGGER create_meta BEFORE INSERT ON public.run FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.run FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT ON TABLE public.run IS 'A run is an instance of a job being executed. It captures data related to the running of the job: success, logs, etc.';

CREATE TYPE file_status AS ENUM ('url_generated', 'upload_complete', 'upload_error');
CREATE TABLE
    public.job_file (
        job_id integer NOT NULL REFERENCES public.job (id) ON DELETE CASCADE,
        template_key varchar NOT NULL,
        name varchar NOT NULL,
        path varchar NOT NULL,
        type varchar NOT NULL,
        status file_status NOT NULL DEFAULT 'url_generated',
        created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        created_on timestamp DEFAULT now () NOT NULL,
        modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
        modified_on timestamp DEFAULT now () NOT NULL,
        PRIMARY KEY (job_id, template_key)
    );

CREATE TRIGGER create_meta BEFORE INSERT ON public.job_file FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.job_file FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMENT ON COLUMN public.job_file."template_key" IS 'Key used to match up this file with the right entry in the earthmover bundle.';
COMMENT ON COLUMN public.job_file."path" IS 'The path on S3 or wherever else the file is stored. This is distinct from the presigned upload URL.';
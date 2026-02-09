BEGIN;

ALTER TABLE public.job ADD COLUMN api_issuer varchar;
ALTER TABLE public.job ADD COLUMN api_client_id varchar;
ALTER TABLE public.job ADD COLUMN api_client_name varchar;

COMMENT ON COLUMN public.job.api_issuer IS 'The issuer (iss claim) from the API token used to create this job. NULL for jobs created via the UI.';
COMMENT ON COLUMN public.job.api_client_id IS 'The client ID (client_id or azp claim) from the API token used to create this job. NULL for jobs created via the UI.';
COMMENT ON COLUMN public.job.api_client_name IS 'Display name of the API client (client_name claim) that created this job. NULL for jobs created via the UI or if not configured in the IdP.';

COMMIT;

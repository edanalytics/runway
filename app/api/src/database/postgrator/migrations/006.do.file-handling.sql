CREATE TYPE file_storage_protocol AS ENUM ('file', 's3');

ALTER TABLE public.job ADD COLUMN file_protocol file_storage_protocol;
ALTER TABLE public.job ADD COLUMN file_bucket_or_host varchar;
ALTER TABLE public.job ADD COLUMN file_base_path varchar;

COMMENT ON COLUMN public.job.file_base_path IS 'All files related to the job, both input and output, are stored at this path with the protocol specified in file_protocol at/in the host/bucket specified in file_host_or_bucket. Does not include file names, or "input" or "output" subdirectories.';

ALTER TABLE public.job_file RENAME COLUMN name TO name_from_user;
ALTER TABLE public.job_file ADD COLUMN name_internal varchar;

UPDATE public.job_file SET name_internal = template_key || '__' || name_from_user;

ALTER TABLE public.job_file ALTER COLUMN name_internal SET NOT NULL;

COMMENT ON COLUMN public.job_file.name_from_user IS 'The file name as provided by the user. Use this for display and download.';
COMMENT ON COLUMN public.job_file.name_internal IS 'The file name used to save the file to S3. This is what the executor uses.';
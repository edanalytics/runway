-- Add uid column for external API consumers
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.job ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid();

-- Create unique index for lookups
CREATE UNIQUE INDEX job_uid_idx ON public.job (uid);

COMMENT ON COLUMN public.job.uid IS 'Opaque identifier exposed to external API consumers. The integer id remains the primary key for internal use.';

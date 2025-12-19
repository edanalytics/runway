BEGIN;
ALTER TABLE public.job ADD COLUMN is_resolved boolean NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.job."is_resolved" IS 'Indicates whether the job has been marked resolved by a user. This is purely for allowing users to organize their work. The app does/should not depend on this flag to be consistently or meaningfully populated as differentusers will use it differently.';
COMMIT;
ALTER TABLE public.run_error DROP COLUMN IF EXISTS stacktrace ;
ALTER TABLE public.run_error ADD COLUMN payload JSON;
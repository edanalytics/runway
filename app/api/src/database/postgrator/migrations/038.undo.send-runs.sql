DROP TABLE IF EXISTS public.send_run_decision;
ALTER TABLE public.run DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS public.run_kind;

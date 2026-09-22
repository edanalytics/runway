DROP TABLE IF EXISTS public.student_match_suggestion;
DROP TABLE IF EXISTS public.student_match_result;
DROP TABLE IF EXISTS public.student_input_details;

ALTER TABLE public.run DROP CONSTRAINT IF EXISTS run_id_job_unique;

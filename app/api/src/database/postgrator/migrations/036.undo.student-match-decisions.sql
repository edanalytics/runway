DROP TABLE IF EXISTS public.student_match_decision;
DROP TYPE IF EXISTS public.student_match_decision_kind;

ALTER TABLE public.student_match_result
    DROP CONSTRAINT IF EXISTS student_match_result_id_job_correlation_unique;

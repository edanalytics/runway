-- Fails while any decision's basis is a search: 036's check refuses a match
-- without a suggestion, and those decisions can't be kept without their basis.
ALTER TABLE public.student_match_decision
    DROP CONSTRAINT student_match_decision_check,
    ADD CONSTRAINT student_match_decision_check CHECK (CASE kind
        WHEN 'match' THEN result_id IS NOT NULL AND ordinal IS NOT NULL
        ELSE result_id IS NULL AND ordinal IS NULL
    END),
    DROP CONSTRAINT student_match_decision_suggestion_fkey,
    ADD FOREIGN KEY (result_id, ordinal)
        REFERENCES public.student_match_suggestion (result_id, ordinal) ON DELETE NO ACTION,
    DROP COLUMN roster_details,
    DROP COLUMN search_details,
    DROP COLUMN student_unique_id;

ALTER TABLE public.student_match_suggestion
    DROP CONSTRAINT student_match_suggestion_result_ordinal_student_unique;

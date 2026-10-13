-- A match picks either one of a run's suggestions, or a hit from a reviewer's
-- own search. A search is stored only when a match is saved to one of its
-- hits, and then only on that decision: the hit as IDRS returned it, and the
-- details the reviewer searched with, as sent to IDRS.
ALTER TABLE public.student_match_decision
    ADD COLUMN student_unique_id TEXT CHECK (length(student_unique_id) > 0),
    ADD COLUMN score NUMERIC,
    ADD COLUMN roster_details JSONB CHECK (jsonb_typeof(roster_details) = 'object'),
    ADD COLUMN search_details JSONB CHECK (jsonb_typeof(search_details) = 'object'),
    DROP CONSTRAINT student_match_decision_check,
    ADD CONSTRAINT student_match_decision_target_check CHECK (CASE kind
        WHEN 'match' THEN
            (result_id IS NOT NULL AND ordinal IS NOT NULL
                AND student_unique_id IS NULL AND score IS NULL
                AND roster_details IS NULL AND search_details IS NULL)
            OR (result_id IS NULL AND ordinal IS NULL
                AND student_unique_id IS NOT NULL AND score IS NOT NULL
                AND roster_details IS NOT NULL AND search_details IS NOT NULL)
        ELSE result_id IS NULL AND ordinal IS NULL
            AND student_unique_id IS NULL AND score IS NULL
            AND roster_details IS NULL AND search_details IS NULL
    END);

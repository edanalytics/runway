-- Fails while any decision picked a search hit: 036's check refuses a match
-- without a suggestion. Those decisions can't be kept without their hits.
ALTER TABLE public.student_match_decision
    DROP CONSTRAINT IF EXISTS student_match_decision_target_check,
    ADD CONSTRAINT student_match_decision_check CHECK (CASE kind
        WHEN 'match' THEN result_id IS NOT NULL AND ordinal IS NOT NULL
        ELSE result_id IS NULL AND ordinal IS NULL
    END),
    DROP COLUMN IF EXISTS search_details,
    DROP COLUMN IF EXISTS roster_details,
    DROP COLUMN IF EXISTS score,
    DROP COLUMN IF EXISTS student_unique_id;

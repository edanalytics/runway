-- A match's answer is the student unique id it names. Its basis is what the
-- answer rests on: the suggestion it picked, or the reviewer's search, with
-- the details searched with and the student as the reviewer saw them.
ALTER TABLE public.student_match_decision
    ADD COLUMN student_unique_id TEXT CHECK (length(student_unique_id) > 0),
    ADD COLUMN search_details JSONB CHECK (jsonb_typeof(search_details) = 'object'),
    ADD COLUMN roster_details JSONB CHECK (jsonb_typeof(roster_details) = 'object');

-- Matches made before 037 picked a suggestion: copy each one's answer from it.
UPDATE public.student_match_decision d
SET student_unique_id = s.student_unique_id
FROM public.student_match_suggestion s
WHERE s.result_id = d.result_id AND s.ordinal = d.ordinal;

-- Lets a suggestion pick prove that its answer is the suggestion's student.
ALTER TABLE public.student_match_suggestion
    ADD CONSTRAINT student_match_suggestion_result_ordinal_student_unique
        UNIQUE (result_id, ordinal, student_unique_id);

-- Every match has an answer and exactly one basis; exclude and clear have
-- neither. The suggestion key now carries the answer, and replaces 036's.
ALTER TABLE public.student_match_decision
    DROP CONSTRAINT student_match_decision_result_id_ordinal_fkey,
    ADD CONSTRAINT student_match_decision_suggestion_fkey
        FOREIGN KEY (result_id, ordinal, student_unique_id)
        REFERENCES public.student_match_suggestion (result_id, ordinal, student_unique_id)
        ON DELETE NO ACTION,
    DROP CONSTRAINT student_match_decision_check,
    ADD CONSTRAINT student_match_decision_check CHECK (CASE kind
        WHEN 'match' THEN student_unique_id IS NOT NULL AND (
            (result_id IS NOT NULL AND ordinal IS NOT NULL
                AND search_details IS NULL AND roster_details IS NULL)
            OR (result_id IS NULL AND ordinal IS NULL
                AND search_details IS NOT NULL AND roster_details IS NOT NULL))
        ELSE student_unique_id IS NULL AND result_id IS NULL AND ordinal IS NULL
            AND search_details IS NULL AND roster_details IS NULL
    END);

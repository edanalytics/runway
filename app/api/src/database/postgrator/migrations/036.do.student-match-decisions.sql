-- Lets a decision prove that the suggestion it picks comes from a search for
-- the same input group.
ALTER TABLE public.student_match_result
    ADD CONSTRAINT student_match_result_id_job_correlation_unique UNIQUE (id, job_id, correlation_id);

CREATE TYPE public.student_match_decision_kind AS ENUM ('match', 'exclude', 'clear');

-- Every decision a reviewer makes about a student, in order. Rows are never
-- updated, and are deleted only with their job. A student's current decision
-- is their highest seq, and a clear row means they have none.
CREATE TABLE public.student_match_decision (
    job_id INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    -- The decision's position among the student's decisions, from 1 with no
    -- gaps. Also the concurrency token: a write names the seq it saw and
    -- inserts the next, so the primary key refuses a write from a stale view.
    seq INTEGER NOT NULL CHECK (seq >= 1),
    kind public.student_match_decision_kind NOT NULL,
    -- The suggestion a match chose. Null for exclude and clear.
    result_id BIGINT,
    ordinal INTEGER,
    decided_by_id INTEGER REFERENCES public."user" (id) ON DELETE SET NULL,
    decided_on TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, correlation_id, seq),
    FOREIGN KEY (job_id, correlation_id)
        REFERENCES public.student_input_details (job_id, correlation_id) ON DELETE CASCADE,
    -- NO ACTION, not RESTRICT: deleting a job cascades to both sides in one
    -- statement, which NO ACTION allows. Deleting a single run whose
    -- suggestion was ever chosen is refused instead.
    FOREIGN KEY (result_id, job_id, correlation_id)
        REFERENCES public.student_match_result (id, job_id, correlation_id) ON DELETE NO ACTION,
    FOREIGN KEY (result_id, ordinal)
        REFERENCES public.student_match_suggestion (result_id, ordinal) ON DELETE NO ACTION,
    CHECK (CASE kind
        WHEN 'match' THEN result_id IS NOT NULL AND ordinal IS NOT NULL
        ELSE result_id IS NULL AND ordinal IS NULL
    END)
);

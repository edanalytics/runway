-- A submission of current match decisions for delivery. The app never updates
-- rows, and they are deleted only with their job: a retry is a new batch.
CREATE TABLE public.student_match_batch (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES public.job (id) ON DELETE CASCADE,
    -- The send run that delivers the batch. Written with the batch, in the
    -- submit transaction.
    run_id INTEGER,
    -- The failed batch this one retries (PR 5). Null for a first submission.
    retry_of_id INTEGER,
    submitted_by_id INTEGER REFERENCES public."user" (id) ON DELETE SET NULL,
    submitted_on TIMESTAMP NOT NULL DEFAULT now(),
    -- Lets a member, or a retry, prove it belongs to the batch's job.
    UNIQUE (id, job_id),
    -- A batch's run is one of its job's runs. NO ACTION, so deleting the job
    -- cascades to both, but deleting a batch's run alone is refused.
    FOREIGN KEY (run_id, job_id) REFERENCES public.run (id, job_id) ON DELETE NO ACTION,
    FOREIGN KEY (retry_of_id, job_id)
        REFERENCES public.student_match_batch (id, job_id) ON DELETE NO ACTION
);

-- One student in a batch: the decision row it submitted. That row records the
-- answer, its basis and who decided when, and never changes.
CREATE TABLE public.student_match_batch_member (
    batch_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (batch_id, job_id, correlation_id),
    FOREIGN KEY (batch_id, job_id)
        REFERENCES public.student_match_batch (id, job_id) ON DELETE CASCADE,
    -- NO ACTION, as for the decision's own suggestion key: deleting the job
    -- cascades to both sides in one statement.
    FOREIGN KEY (job_id, correlation_id, seq)
        REFERENCES public.student_match_decision (job_id, correlation_id, seq) ON DELETE NO ACTION
);

-- Status asks whether a student's latest decision is in a batch.
CREATE INDEX student_match_batch_member_decision_idx
    ON public.student_match_batch_member (job_id, correlation_id, seq);

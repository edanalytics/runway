-- What a run does. A full run does every step: download, earthmover, IDRS,
-- send what resolved, post results. A send run only delivers given match
-- decisions.
CREATE TYPE public.run_kind AS ENUM ('full', 'send');
-- The default exists only to backfill existing runs as full, and is dropped
-- straight away. NOT NULL with no default makes kind required: every insert
-- must name it, and Prisma's generated create types require it, so a run
-- can't be created without saying what kind it is.
ALTER TABLE public.run ADD COLUMN kind public.run_kind NOT NULL DEFAULT 'full';
ALTER TABLE public.run ALTER COLUMN kind DROP DEFAULT;
-- The decision rows a send run delivers, recorded when it's created and never
-- changed. Every send of a student delivers the same decision row.
CREATE TABLE public.send_run_decision (
    run_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    correlation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (run_id, job_id, correlation_id),
    -- These rows are the only record of what a send run may have delivered,
    -- so they live exactly as long as the job. Deleting the job cascades
    -- here, to the run and to the decision, in one statement. Deleting a send
    -- run or a decision on its own is refused (NO ACTION).
    FOREIGN KEY (job_id) REFERENCES public.job (id) ON DELETE CASCADE,
    FOREIGN KEY (run_id, job_id) REFERENCES public.run (id, job_id) ON DELETE NO ACTION,
    FOREIGN KEY (job_id, correlation_id, seq)
        REFERENCES public.student_match_decision (job_id, correlation_id, seq) ON DELETE NO ACTION
);
-- Submitted status now; PR 5's latest send run per student.
CREATE INDEX send_run_decision_decision_idx
    ON public.send_run_decision (job_id, correlation_id, seq, run_id);

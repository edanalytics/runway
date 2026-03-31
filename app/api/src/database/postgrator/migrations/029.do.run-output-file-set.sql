CREATE TABLE public.run_output_file_set (
    uid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id INTEGER NOT NULL REFERENCES public.run (id) ON DELETE CASCADE,
    files JSONB NOT NULL,
    sent_to_ods BOOLEAN NOT NULL DEFAULT true,
    path TEXT NOT NULL,
    created_on TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(run_id, path)
);

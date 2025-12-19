CREATE TABLE public.run_update (
    run_id integer NOT NULL REFERENCES public.run (id) ON DELETE CASCADE,
    action varchar NOT NULL,
    status varchar NOT NULL,
    received_at timestamp DEFAULT now () NOT NULL,
    PRIMARY KEY (run_id, action, status)
);

-- run errors (stack track)
        -- self.code = code
        -- self.stacktrace = stacktrace
CREATE TABLE public.run_error (
    id serial NOT NULL PRIMARY KEY,
    run_id integer NOT NULL REFERENCES public.run (id) ON DELETE CASCADE,
    code varchar NOT NULL,
    stacktrace text NOT NULL,
    received_at timestamp DEFAULT now () NOT NULL
);

-- run output files
CREATE TABLE public.run_output_file (
    run_id integer NOT NULL REFERENCES public.run (id) ON DELETE CASCADE,
    name varchar NOT NULL,
    path varchar NOT NULL,
    PRIMARY KEY (run_id, name)
);
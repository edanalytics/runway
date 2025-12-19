BEGIN;

CREATE TABLE public.job_note (
    id serial NOT NULL PRIMARY KEY,
    job_id integer NOT NULL REFERENCES public.job (id) ON DELETE CASCADE,
    note_text text NOT NULL,
    created_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    created_on timestamp DEFAULT now () NOT NULL,
    modified_by_id integer REFERENCES public."user" (id) ON DELETE SET NULL,
    modified_on timestamp DEFAULT now () NOT NULL
);

CREATE TRIGGER create_meta BEFORE INSERT ON public.job_note FOR EACH ROW EXECUTE FUNCTION create_meta ();
CREATE TRIGGER update_meta BEFORE UPDATE ON public.job_note FOR EACH ROW EXECUTE FUNCTION update_meta ();

COMMIT;
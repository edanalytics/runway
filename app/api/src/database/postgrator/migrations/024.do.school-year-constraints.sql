BEGIN;

ALTER TABLE public.school_year
  ADD CONSTRAINT sy_end_follows_start CHECK (end_year = start_year + 1),
  ADD CONSTRAINT sy_unique_start_year UNIQUE (start_year),
  ADD CONSTRAINT sy_unique_end_year UNIQUE (end_year);

COMMIT;

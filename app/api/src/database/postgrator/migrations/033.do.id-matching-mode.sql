-- Per-partner selection of how student identities are resolved, plus a
-- per-job snapshot so a run's behavior can't change out from under it when
-- the partner setting is later edited.
--
-- The column defaults exist for migration safety only — existing rows stay
-- id_based without a backfill. JobsService.createJob explicitly copies the
-- partner's current mode onto the job rather than relying on this default.
CREATE TYPE id_matching_mode AS ENUM ('id_based', 'fuzzy', 'id_based_fuzzy_background');

ALTER TABLE public.partner
  ADD COLUMN id_matching_mode id_matching_mode NOT NULL DEFAULT 'id_based';

ALTER TABLE public.job
  ADD COLUMN id_matching_mode id_matching_mode NOT NULL DEFAULT 'id_based';

-- Point the latest run of recent local jobs at the mock executor logs
-- (LOCAL_EXECUTOR_LOGS=mock, see api/src/jobs/job-logs.mock-client.ts).
-- Scenarios follow each run's status. Older jobs are left alone, so they
-- still show the "no executor task" case. Safe to re-run.
-- Run from app/ via: docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < api/mock-executor-logs.sql
-- Undo: UPDATE run SET ecs_task_arn = NULL, task_size = NULL WHERE ecs_task_arn LIKE '%/mock-%';

WITH latest AS (
  SELECT DISTINCT ON (job_id) id, status, created_on
  FROM run
  ORDER BY job_id, created_on DESC
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY status ORDER BY created_on DESC) AS n
  FROM latest
  ORDER BY created_on DESC
  LIMIT 12
),
assigned AS (
  SELECT
    id,
    created_on,
    CASE status
      WHEN 'success' THEN (ARRAY['success', 'long'])[1 + (n - 1) % 2]
      WHEN 'error' THEN (ARRAY['earthmover-error', 'insufficient-matches', 'missing'])[1 + (n - 1) % 3]
      -- A run in progress: start its logs now so they fill in over a few minutes
      ELSE (ARRAY['success', 'empty', 'missing'])[1 + (n - 1) % 3]
    END AS scenario,
    status IN ('new', 'running') AS live
  FROM ranked
)
UPDATE run
SET task_size = 'medium',
    ecs_task_arn = format(
      'arn:aws:ecs:us-east-2:000000000000:task/runway-local/mock-%s-%s',
      a.scenario,
      (extract(epoch FROM CASE WHEN a.live THEN now() ELSE a.created_on END) * 1000)::bigint
    )
FROM assigned a
WHERE run.id = a.id
RETURNING run.job_id, run.id AS run_id, run.status, a.scenario;

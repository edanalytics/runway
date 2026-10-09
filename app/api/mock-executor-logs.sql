-- Point every run of the most recently run local jobs at the mock executor
-- logs (LOCAL_EXECUTOR_LOGS=mock, see api/src/jobs/job-logs.mock-client.ts).
-- Scenarios follow each run's status. Older jobs are left alone, so they
-- still show the "logs aren't available" case. Safe to re-run.
-- Run from app/ via: docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < api/mock-executor-logs.sql
-- Undo: UPDATE run SET ecs_task_arn = NULL, task_size = NULL WHERE ecs_task_arn LIKE '%/mock-%';

WITH recent_jobs AS (
  SELECT job_id
  FROM run
  GROUP BY job_id
  ORDER BY max(created_on) DESC
  LIMIT 12
),
ranked AS (
  SELECT run.id, run.status, run.created_on,
    row_number() OVER (PARTITION BY run.status ORDER BY run.created_on DESC) AS n
  FROM run
  JOIN recent_jobs USING (job_id)
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

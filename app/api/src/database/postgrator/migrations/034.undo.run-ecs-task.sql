ALTER TABLE public.run
  DROP COLUMN ecs_task_arn,
  DROP COLUMN task_size;

DROP TYPE ecs_task_size;

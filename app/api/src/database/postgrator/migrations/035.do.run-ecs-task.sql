ALTER TABLE public.run
  ADD COLUMN ecs_task_arn text,
  ADD COLUMN task_size text;

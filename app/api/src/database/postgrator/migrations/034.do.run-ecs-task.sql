CREATE TYPE ecs_task_size AS ENUM ('small', 'medium', 'large');

ALTER TABLE public.run
  ADD COLUMN ecs_task_arn text,
  ADD COLUMN task_size ecs_task_size;

// Names of the executor's ECS resources, which are defined per size in
// cloudformation/templates/ecs.yml. Keep these in sync with that template.

export const EXECUTOR_TASK_SIZES = ['small', 'medium', 'large'] as const;
export type ExecutorTaskSize = (typeof EXECUTOR_TASK_SIZES)[number];

export const isExecutorTaskSize = (size: string | null): size is ExecutorTaskSize =>
  EXECUTOR_TASK_SIZES.includes(size as ExecutorTaskSize);

const capitalize = (size: ExecutorTaskSize) => size[0].toUpperCase() + size.slice(1);

export const executorContainerName = (envLabel: string, size: ExecutorTaskSize) =>
  `${envLabel}-JobExecutor${capitalize(size)}`;

export const executorLogGroupName = (envLabel: string, size: ExecutorTaskSize) =>
  `/ecs/JobExecutor${capitalize(size)}-${envLabel}`;

// The awslogs driver names each stream {awslogs-stream-prefix}/{container}/{task id}.
export const executorLogStreamName = (
  envLabel: string,
  size: ExecutorTaskSize,
  ecsTaskArn: string
) => {
  const taskId = ecsTaskArn.split('/').pop();
  return `ecs/${executorContainerName(envLabel, size)}/${taskId}`;
};

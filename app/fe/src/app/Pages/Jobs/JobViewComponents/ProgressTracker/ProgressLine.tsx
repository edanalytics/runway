import { Box, Progress } from '@chakra-ui/react';
import { ProgressStepStatus } from './JobProgressTracker';

export const ProgressLine = ({
  prevStepStatus,
  nextStepStatus,
}: {
  prevStepStatus: ProgressStepStatus;
  nextStepStatus: ProgressStepStatus;
}) => {
  if (prevStepStatus === 'done' && nextStepStatus === 'in progress') {
    return (
      <Box flexGrow={1}>
        <Progress colorScheme="progressGreen" bg="transparent" size="xs" isIndeterminate />
      </Box>
    );
  }

  const isDone = nextStepStatus === 'done' || nextStepStatus === 'error';
  return (
    <Box
      borderWidth="0px"
      flexGrow={1}
      height=".25rem"
      borderRadius="4px"
      bg={isDone ? 'green.100' : 'blue.50'}
      opacity={!isDone ? '40%' : undefined}
    ></Box>
  );
};

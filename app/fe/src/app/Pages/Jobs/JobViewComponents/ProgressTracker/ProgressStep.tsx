import { Box, Flex, VStack } from '@chakra-ui/react';
import { ProgressStepStatus } from './JobProgressTracker';
import { IconCheckmark, IconExclamation } from '../../../../../assets/icons';

export const ProgressStep = ({
  title,
  stepNumber,
  status,
}: {
  title: string;
  stepNumber: string;
  status: ProgressStepStatus;
}) => {
  const styleByStatus = {
    'not started': {
      borderColor: undefined,
      textColor: undefined,
      backgroundColor: undefined,
    },
    'in progress': {
      borderColor: 'green.100',
      textColor: 'green.100',
      backgroundColor: undefined,
    },
    done: {
      borderColor: 'green.300',
      textColor: 'blue.700',
      backgroundColor: 'green.300',
    },
    error: {
      borderColor: 'pink.400',
      textColor: undefined,
      backgroundColor: 'pink.400',
    },
  };

  return (
    <VStack
      opacity={status === 'not started' ? '60%' : undefined}
      qa-job-status={status} // used by automated tests, to track when the progress step achieves the given status
    >
      <Flex
        borderWidth="2px"
        borderRadius="40px"
        width="2rem"
        height="2rem"
        marginX="2rem"
        justifyContent="center"
        alignItems="center"
        borderColor={styleByStatus[status].borderColor}
        textColor={styleByStatus[status].textColor}
        backgroundColor={styleByStatus[status].backgroundColor}
      >
        {status === 'not started' || status === 'in progress' ? (
          stepNumber
        ) : status === 'done' ? (
          <IconCheckmark />
        ) : (
          <IconExclamation />
        )}
      </Flex>
      <Box textStyle="h6">{title}</Box>
    </VStack>
  );
};

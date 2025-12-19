import {
  Box,
  Button,
  Center,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  useDisclosure,
} from '@chakra-ui/react';
import { GetJobDto, TJobDisplayStatus } from '@edanalytics/models';
import { IconBox, IconCheckmark, IconClock, IconExclamation } from '../../../../assets/icons';
import { ChevronDownIcon } from '@chakra-ui/icons';
import { useMutation } from '@tanstack/react-query';
import { putJobResolve } from '../../../api/queries/job.queries';

const statusDisplayConfig: Record<
  TJobDisplayStatus,
  {
    label: string;
    textColor: string;
    icon: JSX.Element;
    iconBg: string;
  }
> = {
  new: {
    label: 'queued',
    textColor: 'purple.200',
    icon: <IconBox />,
    iconBg: 'purple.600',
  },
  running: {
    label: 'running',
    textColor: 'blue.50',
    icon: <IconClock />,
    iconBg: 'blue.500',
  },
  success: {
    label: 'complete',
    textColor: 'green.50',
    icon: <IconCheckmark />,
    iconBg: 'green.300',
  },
  error: {
    label: 'error',
    textColor: 'pink.50',
    icon: <IconExclamation />,
    iconBg: 'pink.400',
  },
  'complete with errors': {
    label: 'complete with errors',
    textColor: 'pink.50',
    icon: <IconExclamation />,
    iconBg: 'pink.400',
  },
  resolved: {
    label: 'resolved',
    textColor: 'green.50',
    icon: <IconCheckmark />,
    iconBg: 'green.300',
  },
};

export const statusToLabel = ({ job }: { job: GetJobDto }) => {
  const status = job.status;
  return status ? statusDisplayConfig[status].label : null;
};

const Status = ({
  status,
  allowChange = false,
}: {
  status: TJobDisplayStatus;
  allowChange?: boolean;
}) => {
  const { label, textColor, icon, iconBg } = statusDisplayConfig[status];
  return (
    <HStack textColor={textColor}>
      <Box bg={iconBg} padding="100" borderRadius="22px">
        {icon}
      </Box>
      <Box textStyle="h6">{label}</Box>
      {allowChange && <ChevronDownIcon />}
    </HStack>
  );
};

const ChangeableStatus = ({ job }: { job: GetJobDto }) => {
  const { onOpen, onClose, isOpen } = useDisclosure();
  const putResolve = useMutation(putJobResolve(job));
  if (putResolve.isPending) {
    return (
      <Center minW="14rem" minH="fit-content" padding="300">
        <Spinner size="sm" color="blue.50" speed="0.75s" />
      </Center>
    );
  }

  let status = job.status;
  let alternateStatus = status === 'resolved' ? job.originalStatus : 'resolved';
  if (!status || !alternateStatus) {
    // type narrowing, should never happen if we're in this component
    return null;
  }

  return (
    <Popover
      isOpen={isOpen}
      onClose={onClose}
      onOpen={onOpen}
      returnFocusOnClose={false}
      closeOnEsc={true}
      closeOnBlur={true}
    >
      <PopoverTrigger>
        <Button
          variant="unstyled"
          minW="14rem" // "complete with errors" takes up ~14rem. We start with that width so that if we change to that status, we don't get shifting
        >
          <Status status={status} allowChange={true} />
        </Button>
      </PopoverTrigger>
      <PopoverContent bg="transparent" border="none" w="fit-content" top="-0.5rem">
        <Box layerStyle="contentBox">
          <Button
            minW="14rem"
            padding="300"
            variant="unstyled"
            w="100%"
            h="fit-content"
            aria-label="resolve job"
            isDisabled={putResolve.isPending}
            onClick={() => {
              putResolve.mutate({ isResolved: !job.isResolved });
              onClose();
            }}
          >
            <Status status={alternateStatus} allowChange={false} />
          </Button>
        </Box>
      </PopoverContent>
    </Popover>
  );
};

export const JobStatus = ({
  job,
  allowStatusChange = false,
}: {
  job: GetJobDto;
  allowStatusChange?: boolean;
}) => {
  const status = job.status;
  if (!status) {
    return null;
  }

  if (!allowStatusChange || !job.isStatusChangeable) {
    return <Status status={status} />;
  }

  return <ChangeableStatus job={job} />;
};

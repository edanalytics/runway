import { Box, Button, Spinner, VStack } from '@chakra-ui/react';
import { GetJobDto } from '@edanalytics/models';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getJobLogs } from '../../../api/queries/job.queries';

const LogLines = ({ job }: { job: GetJobDto }) => {
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(getJobLogs(job.id.toString()));

  if (isPending) {
    return <Spinner size="md" color="blue.50" speed="0.75s" />;
  }

  if (error) {
    // The API answers 404 with a message saying why there are no logs (no task recorded, or the stream doesn't exist)
    const { statusCode, message } = error as { statusCode?: number; message?: string };
    return (
      <Box textStyle="body" textColor="pink.100">
        {statusCode === 404 && message ? message : 'error loading logs'}
      </Box>
    );
  }

  const events = data.pages.flatMap((page) => page.events);

  return (
    <VStack width="100%" alignItems="flex-start" gap="300">
      {events.length ? (
        <Box
          as="pre"
          width="100%"
          maxHeight="40rem"
          overflow="auto"
          padding="300"
          bg="gray.50"
          borderRadius="md"
          fontFamily="mono"
          fontSize="sm"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {events.map((event, i) => (
            <Box key={i}>
              {event.timestamp !== null && (
                <Box as="span" opacity="0.6">
                  {new Date(event.timestamp).toLocaleString()}{' '}
                </Box>
              )}
              {event.message}
            </Box>
          ))}
        </Box>
      ) : (
        <Box textStyle="body">no log events</Box>
      )}
      {hasNextPage && (
        <Button
          variant="link"
          textStyle="button"
          textColor="green.100"
          isLoading={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          load more
        </Button>
      )}
    </VStack>
  );
};

export const JobLogs = ({ job }: { job: GetJobDto }) => {
  // Logs come from CloudWatch, so only fetch them when someone asks
  const [isOpen, setIsOpen] = useState(false);

  return (
    <VStack width="100%" alignItems="flex-start" gap="300">
      <Button
        variant="link"
        textStyle="button"
        textColor="green.100"
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? 'hide logs' : 'show logs'}
      </Button>
      {isOpen && <LogLines job={job} />}
    </VStack>
  );
};

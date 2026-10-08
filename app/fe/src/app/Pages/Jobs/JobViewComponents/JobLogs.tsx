import { Box, Button, HStack, Highlight, Spacer, Spinner, Switch, VStack } from '@chakra-ui/react';
import { GetJobDto } from '@edanalytics/models';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getJobLogs } from '../../../api/queries/job.queries';
import { RunwaySearchInput } from '../../../components/RunwaySearchInput';

const switchSx = {
  '.chakra-switch__track': {
    bg: 'blue.800',
    _checked: { bg: 'green.300' },
  },
  '.chakra-switch__thumb': { bg: 'blue.50' },
};

const LogLines = ({ job }: { job: GetJobDto }) => {
  const { data, dataUpdatedAt, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery(getJobLogs(job.id.toString()));
  const [wrapLines, setWrapLines] = useState(true);
  const [newestFirst, setNewestFirst] = useState(false);
  const [search, setSearch] = useState<string | undefined>();

  // Keyed by position in the stream, which stays put when filtering or sorting
  const events = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.events).map((e, key) => ({ ...e, key })),
    [data]
  );
  const query = search?.trim() ?? '';
  const shown = useMemo(() => {
    const term = query.toLowerCase();
    const matching = term ? events.filter((e) => e.message.toLowerCase().includes(term)) : events;
    return newestFirst ? [...matching].reverse() : matching;
  }, [events, query, newestFirst]);

  // A new search or order starts from its first line
  const logBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logBox.current?.scrollTo({ top: 0 });
  }, [query, newestFirst]);

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

  const atEnd = data.pages[data.pages.length - 1].atEnd || !hasNextPage;
  const checkedAt = new Date(dataUpdatedAt).toLocaleTimeString();

  return (
    <VStack width="100%" alignItems="stretch" gap="300">
      {events.length > 0 && (
        <HStack gap="400" flexWrap="wrap">
          <RunwaySearchInput
            flex="1"
            minW="15em"
            placeholder="Search logs"
            value={search}
            onChange={setSearch}
          />
          <Spacer />
          <Switch
            textStyle="body"
            sx={switchSx}
            isChecked={newestFirst}
            onChange={(e) => setNewestFirst(e.target.checked)}
          >
            newest first
          </Switch>
          <Switch
            textStyle="body"
            sx={switchSx}
            isChecked={wrapLines}
            onChange={(e) => setWrapLines(e.target.checked)}
          >
            wrap lines
          </Switch>
        </HStack>
      )}
      <HStack gap="300" textStyle="body">
        <Box opacity="0.6">
          {!events.length
            ? 'no log events'
            : query
            ? `${shown.length.toLocaleString()} of ${events.length.toLocaleString()} lines match`
            : `${events.length.toLocaleString()} lines`}
        </Box>
        <Spacer />
        <Box opacity="0.6">
          {!atEnd
            ? 'more lines not loaded yet'
            : job.isComplete
            ? `end of logs as of ${checkedAt}`
            : `no more lines as of ${checkedAt}: the job is still running`}
        </Box>
        {/* Offered at the end for finished jobs too: background matching keeps logging after the run is done */}
        {hasNextPage && (
          <Button
            variant="link"
            textStyle="button"
            textColor="green.100"
            isLoading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {atEnd ? 'check for new lines' : 'load more'}
          </Button>
        )}
      </HStack>
      {events.length > 0 && (
        <Box
          ref={logBox}
          as="pre"
          maxHeight="40rem"
          overflow="auto"
          padding="300"
          bg="blue.800"
          borderRadius="8px"
          fontFamily="mono"
          fontSize="sm"
          whiteSpace={wrapLines ? 'pre-wrap' : 'pre'}
          wordBreak={wrapLines ? 'break-word' : 'normal'}
        >
          {shown.length
            ? shown.map((event) => (
                <Box key={event.key}>
                  {event.timestamp !== null && (
                    <Box as="span" opacity="0.6">
                      {new Date(event.timestamp).toLocaleString()}{' '}
                    </Box>
                  )}
                  {query ? (
                    <Highlight query={query} styles={{ bg: 'green.100', color: 'green.600' }}>
                      {event.message}
                    </Highlight>
                  ) : (
                    event.message
                  )}
                </Box>
              ))
            : `no lines match "${query}"`}
        </Box>
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

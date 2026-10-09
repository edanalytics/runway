import { Box, Button, HStack, Highlight, Spacer, Spinner, Switch, VStack } from '@chakra-ui/react';
import { GetJobDto, GetRunDto } from '@edanalytics/models';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
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

const linkProps = { variant: 'link', textStyle: 'button', textColor: 'green.100' } as const;

const isRunComplete = (run: GetRunDto) => run.status === 'success' || run.status === 'error';

const LogLines = ({ jobId, run }: { jobId: number; run: GetRunDto }) => {
  const logsQuery = getJobLogs(jobId.toString(), run.id);
  const isComplete = isRunComplete(run);
  const queryClient = useQueryClient();
  const {
    data,
    dataUpdatedAt,
    error,
    isPending,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useInfiniteQuery(logsQuery);
  const [wrapLines, setWrapLines] = useState(true);
  const [newestFirst, setNewestFirst] = useState(false);
  const [search, setSearch] = useState<string | undefined>();

  // Keyed by position in the stream, which stays put when filtering or sorting.
  // Timestamps are formatted once here rather than on every render of every line.
  const events = useMemo(
    () =>
      (data?.pages ?? [])
        .flatMap((page) => page.events)
        .map((e, key) => ({
          key,
          message: e.message,
          time: e.timestamp !== null ? new Date(e.timestamp).toLocaleString() : null,
        })),
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

  const fetchMore = async () => {
    await fetchNextPage();
    // A check that found nothing new adds an empty page, which every later refetch would
    // replay. Drop it: the page before it already ends at the same position.
    queryClient.setQueryData(logsQuery.queryKey, (old) => {
      const pages = old?.pages ?? [];
      const [previous, last] = pages.slice(-2);
      return old && previous?.atEnd && last.events.length === 0
        ? { pages: pages.slice(0, -1), pageParams: old.pageParams.slice(0, -1) }
        : old;
    });
  };

  if (isPending) {
    return <Spinner size="md" color="blue.50" speed="0.75s" />;
  }

  if (!data) {
    // The API answers 404 when the stream doesn't exist: the container hasn't written to it
    // yet, or it never did, or retention has expired it
    const notFound = (error as { statusCode?: number } | null)?.statusCode === 404;
    return (
      <HStack gap="300" textStyle="body">
        {notFound ? (
          <Box opacity="0.6">
            {isComplete
              ? 'no executor logs were found for this run'
              : "no logs yet: the executor hasn't started writing them"}
          </Box>
        ) : (
          <Box textColor="pink.100">error loading logs</Box>
        )}
        {!(notFound && isComplete) && (
          <Button {...linkProps} isLoading={isRefetching} onClick={() => refetch()}>
            {notFound ? 'check again' : 'try again'}
          </Button>
        )}
      </HStack>
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
        {/* A failed load or check keeps the lines already loaded; the link below retries it */}
        {error ? (
          <Box textColor="pink.100">
            {atEnd ? "couldn't check for new lines" : "couldn't load more lines"}
          </Box>
        ) : (
          <Box opacity="0.6">
            {!atEnd
              ? 'more lines not loaded yet'
              : isComplete
              ? `end of logs as of ${checkedAt}`
              : `no more lines as of ${checkedAt}: the run is still running`}
          </Box>
        )}
        {/* Offered at the end for finished jobs too: background matching keeps logging after the run is done */}
        {hasNextPage && (
          <Button {...linkProps} isLoading={isFetchingNextPage} onClick={fetchMore}>
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
          // Plain elements per line: a styled component for each of tens of thousands of lines is slow
          sx={{ '.log-time': { opacity: 0.6 } }}
        >
          {shown.length
            ? shown.map((event) => (
                <div key={event.key}>
                  {event.time !== null && <span className="log-time">{event.time} </span>}
                  {query ? (
                    <Highlight query={query} styles={{ bg: 'green.100', color: 'green.600' }}>
                      {event.message}
                    </Highlight>
                  ) : (
                    event.message
                  )}
                </div>
              ))
            : `no lines match "${query}"`}
        </Box>
      )}
    </VStack>
  );
};

const RunLogs = ({
  jobId,
  run,
  isLatest,
}: {
  jobId: number;
  run: GetRunDto;
  isLatest: boolean;
}) => {
  // Logs come from CloudWatch, so only fetch them when someone asks
  const [isOpen, setIsOpen] = useState(false);

  return (
    <VStack width="100%" alignItems="stretch" gap="300">
      <HStack gap="300" textStyle="body">
        <Box textStyle="bodyBold">run started {run.createdOn.toLocaleString()}</Box>
        {isLatest && <Box opacity="0.6">latest run</Box>}
        {/* The run records its ECS task once the task launches. Runs without one predate that,
            ran locally, or failed to launch; a starting run gets one shortly, and the job
            refetches as it moves through its stages. */}
        {run.hasEcsTask ? (
          <Button {...linkProps} onClick={() => setIsOpen((open) => !open)}>
            {isOpen ? 'hide logs' : 'show logs'}
          </Button>
        ) : (
          <Box opacity="0.6">
            {isRunComplete(run)
              ? "logs aren't available for this run"
              : 'no logs yet: the run is starting'}
          </Box>
        )}
      </HStack>
      {isOpen && <LogLines jobId={jobId} run={run} />}
    </VStack>
  );
};

export const JobLogs = ({ job }: { job: GetJobDto }) => {
  const runs = [...(job.runs ?? [])].sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());

  if (!runs.length) {
    return (
      <Box textStyle="body" opacity="0.6">
        logs aren't available: this job hasn't run
      </Box>
    );
  }

  return (
    <VStack width="100%" alignItems="stretch" gap="400">
      {runs.map((run, i) => (
        <RunLogs key={run.id} jobId={job.id} run={run} isLatest={i === 0 && runs.length > 1} />
      ))}
    </VStack>
  );
};

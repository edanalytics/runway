import {
  Box,
  Collapse,
  HStack,
  Spinner,
  StackDivider,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  VStack,
} from '@chakra-ui/react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
  getJobErrors,
  getJobStatusUpdates,
  jobQueries,
  useInvalidateJobQueries,
} from '../../api/queries/job.queries';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { schoolYearQueries } from '../../api';
import { JobStatus } from './SharedJobComponents/JobStatus';
import { useEffect, useState } from 'react';
import { GetRunUpdateDto } from '@edanalytics/models';
import { JobProgressTracker } from './JobViewComponents/ProgressTracker/JobProgressTracker';
import { JobViewSection } from './JobViewComponents/JobViewSection';
import { JobError } from './JobViewComponents/JobErrors/JobErrors';
import { GoBackLink } from '../../components/links';
import { ResourceSummary } from './JobViewComponents/ResourceSummary';
import { UnmatchedStudents } from './JobViewComponents/UnmatchedStudents';
import { JobConfiguration } from './JobViewComponents/JobConfiguration';
import { JobOutputFiles } from './JobViewComponents/JobOutputFiles';
import { JobNotes } from './JobNotes/JobNotes';
import { useMe } from '../../api/queries/me.queries';
import { hasMatchReview, ReviewSessionProvider } from './MatchReview/reviewSession';
import { MatchReview } from './MatchReview/MatchReview';
import { ReviewNotice } from './MatchReview/ReviewNotice';

// Chakra's default selected tab uses blue.600, which this theme makes a
// background color.
const selectedTab = { color: 'blue.50', borderColor: 'blue.50' };

type JobStages = 'not started' | 'in progress' | 'done' | 'error';
const getStageFromUpdates = (updates: GetRunUpdateDto[] | undefined): JobStages => {
  if (!updates || !updates.length) {
    return 'not started';
  }

  if (updates.some((update) => update.action === 'done')) {
    return 'done';
  }

  if (updates.some((update) => update.status === 'failure')) {
    return 'error';
  }

  return 'in progress';
};

export const JobViewPage = () => {
  const { assessmentId } = useParams({ from: '/assessments/$assessmentId' });
  const { data: job } = useSuspenseQuery(jobQueries.getOne({ id: assessmentId }));
  const { data: errors } = useQuery(getJobErrors(assessmentId));
  const { data: me } = useMe();
  const canViewOutputFiles = me?.privileges?.has('job.output-files.read') ?? false;
  const canViewCrossTenantJobs = me?.privileges?.has('job.metatenant.read') ?? false;
  const invalidateJobQueries = useInvalidateJobQueries(assessmentId);

  const showsMatchReview = hasMatchReview(job);
  // The open tab is in the URL, so a link can open the review. A job without
  // match review has no such tab, so it falls back to the Overview.
  const { tab } = useSearch({ from: '/assessments/$assessmentId/' });
  const tabIndex = showsMatchReview && tab === 'students' ? 1 : 0;
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });

  /**
   * The job progress through a series of stages. We determine which stage
   * the job is in based on the status updates we've received. We poll for status
   * updates until the job is in a terminal state (status updates action === 'done').
   * When we progress from one stage to the next, we invalidate queries so that we
   * get the latest job status, errors, files, etc.
   *
   * - not started: no status updates
   * - in progress: at least one status update with status 'begin'
   * - errored but not complete: at least one status update with status 'failure'
   * - done: at least one status update with action 'done'
   *
   * Note that the 'done' status update comes when the executor is fully done sending
   * errors, uploading files, etc. It may come a few seconds after we receive a failure
   * status on a given processing step.
   */
  const [currentStage, setCurrentStage] = useState<JobStages | undefined>();
  const { data: statusUpdates, isLoading: statusLoading } = useQuery({
    ...getJobStatusUpdates(assessmentId),
    refetchInterval: currentStage && currentStage !== 'done' ? 3000 : undefined,
  });
  const newStage = !statusLoading ? getStageFromUpdates(statusUpdates) : undefined;
  useEffect(() => {
    if (currentStage !== newStage) {
      invalidateJobQueries();
      setCurrentStage(newStage);
    }
  }, [currentStage, newStage, invalidateJobQueries]);

  const { data: schoolYears } = useQuery(schoolYearQueries.getAll({}));
  const schoolYear = schoolYears?.find((year) => year.id === job.schoolYearId);

  // The job's own sections; with match review, the first of its tabs.
  const overview = (
    <VStack
      width="100%"
      alignItems="flex-start"
      layerStyle="contentBox"
      padding="400"
      gap="400"
      divider={<StackDivider borderColor="blue.50-40" />}
    >
      <JobViewSection title="Progress">
        {currentStage === 'not started' ? (
          <HStack gap="300">
            <Spinner size="md" color="blue.50" speed="0.75s" />
            <Box textStyle="body">queued for processing...</Box>
          </HStack>
        ) : (
          <Box as={Collapse} animateOpacity in width="100%" marginBottom="400">
            <JobProgressTracker
              statusUpdates={statusUpdates}
              sendToOds={job.sendToOds}
              idMatchingMode={job.idMatchingMode}
            />
          </Box>
        )}
        {errors?.map(({ error }) => (
          // In theory, a job could have multiple errors, but in practice, any
          // error flagged by the executor is fatal and so there will be only one.
          <JobError key={error.id} err={error} />
        ))}
        {!!job.hasIdBasedUnmatchedStudents && <UnmatchedStudents job={job} />}
        {showsMatchReview && <ReviewNotice />}
      </JobViewSection>
      {!!job.resourceSummaries && (
        <JobViewSection title="Summary">
          <ResourceSummary job={job} />
        </JobViewSection>
      )}
      <JobViewSection title="Configuration">
        <JobConfiguration job={job} />
      </JobViewSection>
      {canViewOutputFiles && (
        <JobViewSection title="Output Files">
          <JobOutputFiles job={job} />
        </JobViewSection>
      )}
    </VStack>
  );

  return (
    <VStack
      height="100%"
      width="100%"
      maxWidth="65rem"
      alignItems="flex-start"
      paddingBottom="800"
      gap="500"
    >
      <Box>
        <GoBackLink to="/assessments" />
        <Box textStyle="h5">{schoolYear?.displayName} school year</Box>

        <HStack gap="400" alignItems="center">
          <Box textStyle="h1" as="h1">
            {job.name}
          </Box>
          {currentStage === 'error' && !job.isComplete ? (
            <Spinner size="sm" color="blue.50" speed="0.75s" />
          ) : job.isStatusChangeable ? (
            <Box
              // Centers the status button, which makes toggling the resolved/not resolved states feel less jarring.
              // It should apply to both the status that is currently selected and the popover button
              sx={{
                '&  button > div': {
                  justifyContent: 'center',
                },
                '& > button': {
                  padding: '300',
                  minH: 'fit-content',
                },
                '& button:hover': {
                  boxShadow: '0px 0px 4px 1px var(--chakra-colors-blue-50-40)',
                },
              }}
              layerStyle="contentBox"
            >
              <JobStatus job={job} allowStatusChange={true} />
            </Box>
          ) : (
            <JobStatus job={job} allowStatusChange={false} />
          )}
        </HStack>
        <Box textStyle="h6">
          {job.displayStartedOn ? `started ${job.displayStartedOn}` : 'not started'}
        </Box>
        {canViewCrossTenantJobs && (
          <Box textStyle="h6" marginTop="100">
            {job.tenantCode}
          </Box>
        )}
      </Box>
      {/* One element either way, so a note being typed survives the page
          gaining match review as results arrive. With it, the notes sit
          above the tabs, so they're in view whichever tab is open, and close
          under the job's summary rather than a full gap below it. Without,
          the wrapper takes no box of its own, and the notes lay out as they
          always have. */}
      <Box
        {...(showsMatchReview ? { width: '100%', marginTop: '-2rem' } : { display: 'contents' })}
      >
        <JobNotes job={job} />
      </Box>
      {showsMatchReview ? (
        // Keyed by job, so nothing from one job's review outlives it.
        <ReviewSessionProvider key={job.id} job={job}>
          <Tabs
            isLazy
            lazyBehavior="keepMounted"
            width="100%"
            index={tabIndex}
            onChange={(index) =>
              navigate({ search: index === 1 ? { tab: 'students' } : {}, resetScroll: false })
            }
          >
            <TabList borderColor="blue.50-40">
              <Tab _selected={selectedTab}>Overview</Tab>
              <Tab _selected={selectedTab}>Unmatched Students</Tab>
            </TabList>
            <TabPanels>
              <TabPanel paddingX="0" paddingY="400">
                {overview}
              </TabPanel>
              <TabPanel paddingX="0" paddingY="400">
                <MatchReview />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </ReviewSessionProvider>
      ) : (
        overview
      )}
    </VStack>
  );
};

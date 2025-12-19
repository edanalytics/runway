import { Box, Collapse, HStack, Spinner, StackDivider, VStack } from '@chakra-ui/react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
  getJobErrors,
  getJobStatusUpdates,
  jobQueries,
  useInvalidateJobQueries,
} from '../../api/queries/job.queries';
import { useParams } from '@tanstack/react-router';
import { useSchoolYears } from '../../helpers/useSchoolYears';
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
import { JobNotes } from './JobNotes/JobNotes';

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
  const invalidateJobQueries = useInvalidateJobQueries(assessmentId);

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

  const { yearForId } = useSchoolYears();
  const schoolYear = yearForId(job.schoolYearId);

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
      </Box>
      <JobNotes job={job} />
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
              <JobProgressTracker statusUpdates={statusUpdates} />
            </Box>
          )}
          {errors?.map(({ error }) => (
            // In theory, a job could have multiple errors, but in practice, any
            // error flagged by the executor is fatal and so there will be only one.
            <JobError key={error.id} err={error} />
          ))}
          {!!job.unmatchedStudentsFile && <UnmatchedStudents job={job} />}
        </JobViewSection>
        {!!job.resourceSummaries && (
          <JobViewSection title="Summary">
            <ResourceSummary job={job} />
          </JobViewSection>
        )}
        <JobViewSection title="Configuration">
          <JobConfiguration job={job} />
        </JobViewSection>
      </VStack>
    </VStack>
  );
};

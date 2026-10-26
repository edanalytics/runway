import { Box, HStack, Progress, Spinner, VStack } from '@chakra-ui/react';
import { getResourceSummaries, GetSendRunDto } from '@edanalytics/models';
import { useState } from 'react';
import { ContactSupport } from '../../../components/SupportButton';
import { reportedSummaries } from '../JobViewComponents/ResourceSummary';
import { QuietButton, studentName } from './components';
import { useReviewSession } from './reviewSession';
import {
  outcomeLabel,
  SendRunOutcome,
  sendRunOutcome,
  submissionNumber,
  submissionReference,
} from './sendRun';

/** Every submission, newest first. */
export const SubmissionList = () => {
  const { sendRuns } = useReviewSession();
  return (
    <VStack alignItems="stretch" gap="100">
      {sendRuns.map((sendRun) => (
        <SubmissionSummary key={sendRun.id} sendRun={sendRun} />
      ))}
    </VStack>
  );
};

/**
 * One line per submission; expands to its counts and students. One that had
 * trouble starts open, so its way to support is in view.
 */
const SubmissionSummary = ({ sendRun }: { sendRun: GetSendRunDto }) => {
  const { job, sendRuns } = useReviewSession();
  const outcome = sendRunOutcome(sendRun, job.template.reportResources);
  const troubled = outcome === 'complete with errors' || outcome === 'failed';
  const [open, setOpen] = useState(troubled);
  const number = submissionNumber(sendRuns, sendRun);
  return (
    <VStack alignItems="stretch" gap="100">
      <HStack
        as="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        gap="300"
        paddingX="200"
        paddingY="100"
        borderRadius="4px"
        _hover={{ bg: 'blue.600' }}
        fontSize="0.9rem"
        textAlign="left"
      >
        <Box width="1rem" opacity="0.8">
          {open ? '▾' : '▸'}
        </Box>
        <SubmissionIcon outcome={outcome} />
        <Box fontWeight="600">Submission {number}</Box>
        <Box opacity="0.85">
          {sendRun.studentCount} {sendRun.studentCount === 1 ? 'student' : 'students'} · submitted{' '}
          {sendRun.createdOn.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
          {sendRun.createdBy && ` by ${sendRun.createdBy.displayName}`}
        </Box>
        <Box flex="1" />
        <Box color={troubled ? 'pink.100' : undefined}>{outcomeLabel[outcome]}</Box>
      </HStack>
      {open && <SubmissionCard sendRun={sendRun} number={number} outcome={outcome} />}
    </VStack>
  );
};

/** Complete, complete with errors, failed, or still running, at a glance. */
const SubmissionIcon = ({ outcome }: { outcome: SendRunOutcome }) => {
  if (outcome === 'queued' || outcome === 'running') {
    return <Spinner size="xs" color="blue.50" aria-label={outcomeLabel[outcome]} />;
  }
  const icon = {
    complete: { glyph: '✓', color: 'green.100' },
    'complete with errors': { glyph: '⚠', color: 'pink.100' },
    failed: { glyph: '✕', color: 'pink.100' },
  }[outcome];
  return (
    <Box
      as="span"
      role="img"
      aria-label={outcomeLabel[outcome]}
      title={outcomeLabel[outcome]}
      color={icon.color}
      fontWeight="700"
      width="1rem"
      textAlign="center"
    >
      {icon.glyph}
    </Box>
  );
};

/**
 * A troubled submission's next step: support, who can trace its records
 * from the run's logs. The matches stand either way.
 */
const SubmissionSupport = ({
  sendRun,
  number,
  outcome,
}: {
  sendRun: GetSendRunDto;
  number: number;
  outcome: 'complete with errors' | 'failed';
}) => {
  const { job } = useReviewSession();
  const reference = submissionReference(job.id, number, sendRun);
  return (
    <HStack
      marginTop="200"
      gap="300"
      padding="300"
      borderRadius="6px"
      borderWidth="1px"
      borderColor="pink.100"
      fontSize="0.9rem"
      justifyContent="space-between"
      flexWrap="wrap"
    >
      <Box flex="1" minWidth="16rem">
        {outcome === 'failed'
          ? "The run failed. Its matches still stand. Support can find out why from the run's logs."
          : "The run can't say which students the failed records belong to. The matches still stand; support can trace the failures from the run's logs."}
      </Box>
      <ContactSupport
        message={`${reference} ${outcome === 'failed' ? 'failed' : 'completed with errors'}`}
      />
    </HStack>
  );
};

const SubmissionCard = ({
  sendRun,
  number,
  outcome,
}: {
  sendRun: GetSendRunDto;
  number: number;
  outcome: SendRunOutcome;
}) => {
  const { job, students, overLimit, decisions } = useReviewSession();
  const [open, setOpen] = useState(false);
  // The students this run decides the status of. Any it delivered that have
  // been sent again since belong to the later submission.
  const members = students.filter((student) => student.sendRunId === sendRun.id);
  const sentAgain = sendRun.studentCount - members.length;
  const resources =
    sendRun.summary && (outcome === 'complete' || outcome === 'complete with errors')
      ? reportedSummaries(getResourceSummaries(sendRun.summary), job.template.reportResources)
      : [];
  return (
    <Box width="100%" padding="300" borderRadius="6px" bg="blue.600">
      {(outcome === 'queued' || outcome === 'running') && (
        <Progress
          marginTop="200"
          size="xs"
          colorScheme="progressGreen"
          isIndeterminate
          borderRadius="999px"
        />
      )}
      {resources.length > 0 && (
        <VStack alignItems="flex-start" gap="100" marginTop="200" fontSize="0.9rem">
          {resources.map(([resource, counts]) => (
            <Box key={resource}>
              {resource}: {counts.success} succeeded
              {counts.failed > 0 && (
                <Box as="span" color="pink.100">
                  , {counts.failed} failed
                </Box>
              )}
            </Box>
          ))}
        </VStack>
      )}
      {(outcome === 'complete with errors' || outcome === 'failed') && (
        <SubmissionSupport sendRun={sendRun} number={number} outcome={outcome} />
      )}
      {/* Past the review limit there's no list of students to show. */}
      {!overLimit && (
        <>
          <QuietButton marginTop="100" paddingX="0" onClick={() => setOpen(!open)}>
            {open ? 'Hide students' : 'Show students'}
          </QuietButton>
          {open && (
            <VStack alignItems="flex-start" gap="100" marginTop="100">
              {members.map((student) => {
                const decision = decisions.get(student.correlationId);
                return (
                  <HStack
                    key={student.correlationId}
                    gap="200"
                    alignItems="baseline"
                    flexWrap="wrap"
                  >
                    <Box minWidth="10rem">{studentName(student.inputDetails)}</Box>
                    {decision?.kind === 'match' && (
                      <Box opacity="0.8">→ {decision.candidate.studentUniqueId}</Box>
                    )}
                  </HStack>
                );
              })}
              {sentAgain > 0 && (
                <Box fontSize="0.85rem" opacity="0.8">
                  {sentAgain} since sent again
                </Box>
              )}
            </VStack>
          )}
        </>
      )}
    </Box>
  );
};

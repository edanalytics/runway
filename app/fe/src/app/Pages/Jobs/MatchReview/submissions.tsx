import { Box, HStack, Progress, Spinner, useToast, VStack } from '@chakra-ui/react';
import { ConfirmAction } from '@edanalytics/common-ui';
import { getResourceSummaries, GetSendRunDto } from '@edanalytics/models';
import { useEffect, useId, useState } from 'react';
import { IconExclamation } from '../../../../assets/icons';
import { ContactSupport } from '../../../components/SupportButton';
import { reportedSummaries } from '../JobViewComponents/ResourceSummary';
import { dateTime, QuietButton, studentName } from './components';
import { useReviewSession } from './reviewSession';
import {
  needsAttention,
  outcomeLabel,
  SendRunOutcome,
  sendRunOutcome,
  submissionNumber,
  submissionReference,
  studentsToResend,
} from './sendRun';
import { submitFailureText } from './submitResult';

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
 * One line per submission; expands to its counts and students. One that
 * needs the reviewer opens, whether on load or as it happens, so its way to
 * support is in view.
 */
const SubmissionSummary = ({ sendRun }: { sendRun: GetSendRunDto }) => {
  const { job, sendRuns, students, overLimit } = useReviewSession();
  const outcome = sendRunOutcome(sendRun, job.template.reportResources);
  const troubled = outcome === 'complete with errors' || outcome === 'failed';
  const attention = needsAttention(
    outcome,
    overLimit ? null : studentsToResend(students, sendRun.id).length
  );
  const [open, setOpen] = useState(attention);
  useEffect(() => {
    if (attention) setOpen(true);
  }, [attention]);
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
          {dateTime(sendRun.createdOn)}
          {sendRun.createdBy && ` by ${sendRun.createdBy.displayName}`}
        </Box>
        <Box flex="1" />
        <Box color={troubled ? 'pink.50' : undefined}>{outcomeLabel[outcome]}</Box>
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
 * from the run's logs. The matches stand either way. A failed one can also
 * be sent again, though without a fix that usually fails the same way, so
 * support comes first.
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
  const { job, students, overLimit, resend, submitBlocked } = useReviewSession();
  const toast = useToast();
  const leftToResend = studentsToResend(students, sendRun.id).length;
  const reference = submissionReference(job.id, number, sendRun);
  // There's no submit modal here, so a failure is a toast. After a refusal,
  // the refreshed list no longer has the refused students as this run's,
  // so Send again sends the rest.
  const [sending, setSending] = useState(false);
  const sendAgain = async () => {
    setSending(true);
    const result = await resend(sendRun.id);
    setSending(false);
    if (result.ok) return;
    const { title, detail, caughtUp } = submitFailureText(result, 'sent again');
    const sendsTheRest =
      result.kind === 'refused' && result.refusal.action !== 'try later' && result.refreshed;
    toast({
      status: 'error',
      title,
      description: `${detail} ${caughtUp}${sendsTheRest ? ' Send again now sends the rest.' : ''}`,
      isClosable: true,
    });
  };
  return (
    <HStack marginTop="200" gap="300" fontSize="0.9rem" flexWrap="wrap">
      <HStack gap="300" alignItems="flex-start" flex="1" minWidth="16rem">
        <Box bg="pink.400" padding="100" borderRadius="21px" flexShrink={0} aria-hidden="true">
          <IconExclamation height={24} width={24} />
        </Box>
        <VStack alignItems="stretch" gap="100" flex="1" minWidth="0">
          <Box as="h3" textStyle="bodyBold">
            {outcome === 'failed' ? 'Students could not be sent' : 'Some records could not be sent'}
          </Box>
          <Box opacity="0.85">
            Your match decisions have been preserved.{' '}
            {outcome === 'failed'
              ? 'Please contact support.'
              : 'Please contact support for help identifying the affected students.'}
          </Box>
        </VStack>
      </HStack>
      <HStack
        gap="300"
        flexWrap="wrap"
        flexShrink={0}
        marginLeft="auto"
        justifyContent="flex-end"
        maxWidth="100%"
      >
        <ContactSupport
          message={`${reference} ${outcome === 'failed' ? 'failed' : 'completed with errors'}`}
        />
        {outcome === 'failed' &&
          // Past the review limit the page has no students to send again.
          (overLimit ? (
            <Box fontSize="0.8rem" opacity="0.8">
              Too many students to send again from here. Support can help.
            </Box>
          ) : !leftToResend ? (
            <Box fontSize="0.8rem" opacity="0.8">
              All {sendRun.studentCount} sent again
            </Box>
          ) : (
            <ConfirmAction
              isDisabled={!!submitBlocked || sending}
              headerText={`Send submission ${number}'s students again?`}
              bodyText="Sending again will usually fail unless the cause has been fixed. Please contact support first."
              yesButtonText="Send again"
              noButtonText="Cancel"
              action={sendAgain}
            >
              {(confirmProps) => (
                <>
                  <QuietButton isDisabled={!!submitBlocked} isLoading={sending} {...confirmProps}>
                    Send again
                  </QuietButton>
                  {submitBlocked && (
                    <Box fontSize="0.8rem" opacity="0.8">
                      {submitBlocked}
                    </Box>
                  )}
                </>
              )}
            </ConfirmAction>
          ))}
      </HStack>
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
  const { job, students, overLimit } = useReviewSession();
  const [open, setOpen] = useState(false);
  const studentsId = useId();
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
                <Box as="span" color="pink.50">
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
        <Box
          marginLeft={
            outcome === 'failed' || outcome === 'complete with errors'
              ? 'calc(24px + 2 * var(--chakra-space-100) + var(--chakra-space-300))'
              : undefined
          }
        >
          <QuietButton
            marginTop="100"
            paddingX="0"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={studentsId}
            leftIcon={
              <Box as="span" aria-hidden="true">
                {open ? '▾' : '▸'}
              </Box>
            }
          >
            {open ? 'Hide' : 'Show'} {outcome === 'failed' ? 'unsent students' : 'students'}
          </QuietButton>
          {open && (
            <VStack id={studentsId} alignItems="flex-start" gap="100" marginTop="100">
              {members.map(({ correlationId, inputDetails, decision }) => (
                <HStack key={correlationId} gap="200" alignItems="baseline" flexWrap="wrap">
                  <Box minWidth="10rem">{studentName(inputDetails)}</Box>
                  {decision?.kind === 'match' && (
                    <Box opacity="0.8">→ {decision.studentUniqueId}</Box>
                  )}
                </HStack>
              ))}
              {sentAgain > 0 && (
                <Box fontSize="0.85rem" opacity="0.8">
                  {sentAgain} since sent again
                </Box>
              )}
            </VStack>
          )}
        </Box>
      )}
    </Box>
  );
};

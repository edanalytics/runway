import { Box, HStack, Progress, Spinner, VStack } from '@chakra-ui/react';
import { useState } from 'react';
import { QuietButton, SecondaryButton, studentName, time, CopyButton } from './components';
import { Batch, isFinished, loadedOf, totalOf, useReviewSession } from './reviewSession';

/** Every batch, newest first, with a support path when one had trouble. */
export const BatchList = () => {
  const { batches } = useReviewSession();
  return (
    <VStack alignItems="stretch" gap="100">
      {[...batches].reverse().map((batch) => (
        <BatchSummary key={batch.id} batch={batch} number={batches.indexOf(batch) + 1} />
      ))}
      {batches.some((b) => b.status === 'complete with errors' || b.status === 'failed') && (
        <SupportPath batches={batches} />
      )}
    </VStack>
  );
};

/** One line per batch; expands to its counts and students. */
const BatchSummary = ({ batch, number }: { batch: Batch; number: number }) => {
  const [open, setOpen] = useState(false);
  const troubled = batch.status === 'complete with errors' || batch.status === 'failed';
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
        <BatchIcon status={batch.status} />
        <Box fontWeight="600">Batch {number}</Box>
        <Box opacity="0.85">
          {batch.items.length} {batch.items.length === 1 ? 'student' : 'students'} · submitted{' '}
          {time(batch.submittedAt)}
        </Box>
        <Box flex="1" />
        <Box color={troubled ? 'pink.100' : undefined}>
          {isFinished(batch) ? batchStatusLabel[batch.status] : 'Running'}
        </Box>
      </HStack>
      {open && <BatchCard batch={batch} />}
    </VStack>
  );
};

/** Complete, complete with errors, failed, or still running, at a glance. */
const BatchIcon = ({ status }: { status: Batch['status'] }) => {
  if (status === 'queued' || status === 'processing') {
    return <Spinner size="xs" color="blue.50" aria-label="Running" />;
  }
  const icon = {
    complete: { glyph: '✓', color: 'green.100', label: 'Complete' },
    'complete with errors': { glyph: '⚠', color: 'pink.100', label: 'Complete with errors' },
    failed: { glyph: '✕', color: 'pink.100', label: 'Run failed' },
  }[status];
  return (
    <Box
      as="span"
      role="img"
      aria-label={icon.label}
      title={icon.label}
      color={icon.color}
      fontWeight="700"
      width="1rem"
      textAlign="center"
    >
      {icon.glyph}
    </Box>
  );
};

const batchStatusLabel: Record<Batch['status'], string> = {
  queued: 'Queued',
  processing: 'Running',
  complete: 'Complete',
  'complete with errors': 'Complete with errors',
  failed: 'Run failed',
};

/** Errors come with a next step: a reference for support, and logs for those who can see them. */
const SupportPath = ({ batches }: { batches: Batch[] }) => {
  const { job } = useReviewSession();
  const troubled = batches
    .map((b, i) => ({ batch: b, number: i + 1 }))
    .filter(({ batch }) => batch.status === 'complete with errors' || batch.status === 'failed');
  const reference = `Job ${job.id} · batch ${troubled.map((t) => t.number).join(', ')}`;
  return (
    <VStack
      alignItems="flex-start"
      gap="100"
      padding="300"
      borderRadius="6px"
      borderWidth="1px"
      borderColor="pink.100"
      fontSize="0.9rem"
    >
      <Box fontWeight="600">
        {troubled.length} {troubled.length === 1 ? 'batch' : 'batches'} reported problems
      </Box>
      <Box>
        The matches still stand; retrying or changing a match won't fix a delivery error. Support
        can trace failed records from each run's troubleshooting logs.
      </Box>
      <HStack gap="200" flexWrap="wrap">
        <Box>Contact support with {reference}</Box>
        <CopyButton value={reference} label="Copy reference" />
        <QuietButton size="xs" isDisabled title="Support users only; not in the prototype">
          Open run logs (support)
        </QuietButton>
      </HStack>
    </VStack>
  );
};

export const BatchCard = ({ batch }: { batch: Batch }) => {
  const { students, retry } = useReviewSession();
  const [open, setOpen] = useState(false);
  const nameOf = (correlationId: string) => {
    const student = students.find((student) => student.correlationId === correlationId);
    return student ? studentName(student.inputDetails) : correlationId;
  };
  const counts = totalOf(batch.summary);
  const isDone = batch.status === 'complete' || batch.status === 'complete with errors';
  return (
    <Box width="100%" padding="300" borderRadius="6px" bg="blue.600">
      {batch.status === 'failed' && (
        <HStack marginTop="200" gap="300" fontSize="0.9rem" flexWrap="wrap">
          <Box>The run failed before reporting a summary, so nothing was attempted.</Box>
          <SecondaryButton onClick={() => retry(batch.id)}>Retry this batch</SecondaryButton>
        </HStack>
      )}
      {!isFinished(batch) && (
        <Progress
          marginTop="200"
          size="xs"
          colorScheme="progressGreen"
          isIndeterminate
          borderRadius="999px"
        />
      )}
      {isDone && (
        <VStack alignItems="flex-start" gap="100" marginTop="200" fontSize="0.9rem">
          <Box>
            {counts.processed} assessment {counts.processed === 1 ? 'record' : 'records'} processed:{' '}
            {loadedOf(counts)} loaded
            {counts.skipped > 0 && `, ${counts.skipped} skipped`}
            {counts.failed > 0 && (
              <Box as="span" color="pink.100">
                , {counts.failed} failed
              </Box>
            )}
            .
          </Box>
          {counts.failed > 0 && (
            <Box opacity="0.85">
              The run can't say which students the failed records belong to. The matches still
              stand; support can trace the failures from the run's troubleshooting logs.
            </Box>
          )}
        </VStack>
      )}
      <QuietButton marginTop="100" paddingX="0" onClick={() => setOpen(!open)}>
        {open ? 'Hide students' : 'Show students'}
      </QuietButton>
      {open && (
        <VStack alignItems="flex-start" gap="100" marginTop="100">
          {batch.items.map((item) => (
            <HStack key={item.correlationId} gap="200" alignItems="baseline" flexWrap="wrap">
              <Box minWidth="10rem">{nameOf(item.correlationId)}</Box>
              <Box opacity="0.8">→ {item.decision.candidate.studentUniqueId}</Box>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
};

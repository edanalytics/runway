import { Box, HStack, Progress, VStack } from '@chakra-ui/react';
import { CheckIcon } from '@chakra-ui/icons';
import { outstandingStudents } from '@edanalytics/models';
import { countOf, statusLabel, useReviewSession } from './reviewSession';
import { sections } from './queue';

/** Student status counts, with optional decision progress for the review workspace. */
export const ReviewStatusSummary = ({
  showDecisionProgress = true,
}: {
  showDecisionProgress?: boolean;
}) => {
  const { counts } = useReviewSession();
  // A count per status, in the list's order.
  const tiles = sections.map(({ status }) => ({
    label: statusLabel[status],
    value: countOf(counts, status),
  }));

  return (
    <VStack alignItems="stretch" gap="200" width="100%">
      <HStack gap="500" flexWrap="wrap">
        {tiles.map((tile) => (
          <VStack key={tile.label} alignItems="flex-start" gap="0">
            <Box fontSize="1.3rem" fontWeight="600" lineHeight="1.2">
              {tile.value}
            </Box>
            <Box fontSize="0.8rem" opacity="0.8">
              {tile.label}
            </Box>
          </VStack>
        ))}
      </HStack>
      {showDecisionProgress && <ReviewProgress />}
    </VStack>
  );
};

/**
 * Review is done when every student is excluded or has been reprocessed
 * with their match: nothing left to review, submit, run or retry. Done can
 * include delivery errors, as a job can complete with errors today.
 */
const useReviewDone = () => {
  const { counts } = useReviewSession();
  return counts.total > 0 && !outstandingStudents(counts);
};

const ReviewComplete = () => (
  <HStack gap="100" role="status" whiteSpace="nowrap">
    <CheckIcon color="green.100" boxSize="0.8rem" />
    <Box>Review complete</Box>
  </HStack>
);

/**
 * Progress toward review done: students decided, whether or not submitted.
 * A run-failed student is decided: what's left is sending them again.
 */
const ReviewProgress = () => {
  const { counts } = useReviewSession();
  const done = useReviewDone();
  const decided = counts.total - counts.toReview;
  return (
    <HStack gap="300" fontSize="0.8rem">
      <Progress
        flex="1"
        value={counts.total ? (decided / counts.total) * 100 : 0}
        size="xs"
        borderRadius="999px"
        bg="blue.600"
        sx={{ '& > div': { bg: 'green.100' } }}
        aria-label="Students decided"
      />
      {done ? (
        <ReviewComplete />
      ) : (
        <Box opacity="0.8" whiteSpace="nowrap">
          {decided} of {counts.total} decided
        </Box>
      )}
    </HStack>
  );
};

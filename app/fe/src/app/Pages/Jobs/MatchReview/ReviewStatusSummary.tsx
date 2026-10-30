import { Box, HStack, Progress, VStack } from '@chakra-ui/react';
import { CheckIcon } from '@chakra-ui/icons';
import { useReviewSession } from './reviewSession';

/** Work to review, matches to submit, and students whose processing is finished. */
export const ReviewStatusSummary = () => {
  const { counts } = useReviewSession();
  const processed = counts.reprocessed + counts.excluded;
  const done = counts.total > 0 && processed === counts.total;
  const tiles = [
    { label: 'Needs review', value: counts.toReview },
    { label: 'Ready to submit', value: counts.ready },
    ...(counts.runFailed > 0 ? [{ label: 'Send failed', value: counts.runFailed }] : []),
    { label: 'Sent', value: counts.reprocessed },
    { label: 'Excluded', value: counts.excluded },
  ];

  return (
    <VStack alignItems="stretch" gap="300" width="100%">
      <HStack gap="500" flexWrap="wrap">
        {tiles.map((tile) => (
          <VStack
            key={tile.label}
            alignItems="flex-start"
            gap="0"
            position="relative"
            _before={
              tile.label === 'Send failed' || tile.label === 'Sent'
                ? {
                    content: '""',
                    position: 'absolute',
                    left: '-1.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    height: '100%',
                    borderLeft: '1px solid',
                    borderColor: 'blue.50-40',
                    display: { base: 'none', md: 'block' },
                  }
                : undefined
            }
          >
            <Box fontSize="1.3rem" fontWeight="600" lineHeight="1.2">
              {tile.value}
            </Box>
            <Box fontSize="0.8rem" opacity="0.8">
              {tile.label}
            </Box>
          </VStack>
        ))}
      </HStack>
      <HStack gap="300" fontSize="0.8rem">
        <Progress
          flex="1"
          value={counts.total ? (processed / counts.total) * 100 : 0}
          size="xs"
          borderRadius="999px"
          bg="blue.600"
          sx={{ '& > div': { bg: 'green.100' } }}
          aria-label="Students done"
          aria-valuetext={`${processed} of ${counts.total} done`}
        />
        {done ? (
          <HStack gap="100" role="status" whiteSpace="nowrap">
            <CheckIcon color="green.100" boxSize="0.8rem" />
            <Box>{counts.total === 1 ? '1 student done' : `All ${counts.total} students done`}</Box>
          </HStack>
        ) : (
          <Box opacity="0.8" whiteSpace="nowrap">
            {processed} of {counts.total} done
          </Box>
        )}
      </HStack>
    </VStack>
  );
};

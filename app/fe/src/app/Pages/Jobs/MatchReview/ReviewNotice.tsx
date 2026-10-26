import { Box, HStack, VStack } from '@chakra-ui/react';
import { useNavigate } from '@tanstack/react-router';
import { PrimaryButton, TooManyNote, USUAL_MAXIMUM } from './components';
import { useReviewSession } from './reviewSession';
import { ReviewStatusSummary } from './ReviewStatusSummary';

/** A preview of the Unmatched Students tab, including previously reviewed students. */
export const ReviewNotice = () => {
  const { counts } = useReviewSession();
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });
  const onView = () => navigate({ search: { tab: 'students' }, resetScroll: false });

  return (
    <VStack
      alignItems="stretch"
      gap="300"
      padding="300"
      borderRadius="8px"
      bg="blue.600"
      width="100%"
    >
      <HStack justifyContent="space-between" gap="300" flexWrap="wrap">
        <Box as="h3" textStyle="bodyLargeBold">
          Unmatched students{' '}
          <Box as="span" fontSize="0.85rem" fontWeight="normal" opacity="0.85">
            · {counts.total} total
          </Box>
        </Box>
        <PrimaryButton onClick={onView}>View unmatched students</PrimaryButton>
      </HStack>
      <ReviewStatusSummary progressTrackColor="blue.700" />
      {counts.total > USUAL_MAXIMUM && <TooManyNote count={counts.total} />}
    </VStack>
  );
};

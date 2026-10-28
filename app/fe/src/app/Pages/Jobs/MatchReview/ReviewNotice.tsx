import { Box, HStack } from '@chakra-ui/react';
import { useNavigate } from '@tanstack/react-router';
import { IconExclamation } from '../../../../assets/icons';
import { PrimaryButton, QuietButton, USUAL_MAXIMUM } from './components';
import { useReviewSession } from './reviewSession';

/** Introduce unmatched-student review and point to the next action. */
export const ReviewNotice = () => {
  const { counts } = useReviewSession();
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });
  const onView = () => navigate({ search: { tab: 'students' }, resetScroll: false });
  const { toReview, ready, runFailed, reprocessing } = counts;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (!toReview && !ready && !runFailed) {
    return (
      <HStack gap="200" fontSize="0.9rem" flexWrap="wrap">
        <Box opacity="0.85">
          {reprocessing
            ? `Unmatched students: ${plural(
                reprocessing,
                'student is',
                'students are'
              )} being reprocessed.`
            : 'Unmatched students: every student has been reviewed and either submitted or excluded.'}
        </Box>
        <QuietButton size="xs" onClick={onView}>
          View
        </QuietButton>
      </HStack>
    );
  }

  return (
    <Box padding="300" borderRadius="8px" backgroundColor="blue.600" width="100%">
      <HStack gap="200" marginBottom="200">
        <Box bg="pink.400" padding="200" borderRadius="21px">
          <IconExclamation />
        </Box>
        <Box textStyle="bodyLargeBold">
          {toReview
            ? `${plural(toReview, 'student', 'students')} couldn't be matched automatically`
            : ready
            ? `${plural(ready, 'saved match hasn’t', 'saved matches haven’t')} been submitted`
            : `Reprocessing failed for ${plural(runFailed, 'student', 'students')}`}
        </Box>
      </HStack>
      <Box textStyle="body" marginBottom="300">
        {toReview
          ? "Their assessments weren't loaded because no roster student was a close enough match. Review each one to choose from the suggested students, search the roster, or exclude the record, then submit your matches for reprocessing."
          : ready
          ? 'Submit them for reprocessing so these students’ assessments can load.'
          : 'Your match decisions have been preserved. Please contact support from the Unmatched Students tab.'}
        {toReview > 0 &&
          ready > 0 &&
          ` ${plural(ready, 'match is', 'matches are')} saved and waiting to be submitted.`}
      </Box>
      {counts.total > USUAL_MAXIMUM && (
        <Box textStyle="body" marginBottom="300" color="purple.200">
          That's more than a file usually has, which often points to a problem with the file itself
          (such as the wrong ID column or school year). Fixing and uploading it again may be
          quicker.
        </Box>
      )}
      <PrimaryButton onClick={onView}>
        {toReview
          ? 'Review unmatched students'
          : ready
          ? 'Review and submit'
          : 'View unmatched students'}
      </PrimaryButton>
    </Box>
  );
};

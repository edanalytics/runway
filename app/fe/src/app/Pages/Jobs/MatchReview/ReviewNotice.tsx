import { CheckIcon } from '@chakra-ui/icons';
import { Box, HStack } from '@chakra-ui/react';
import { useNavigate } from '@tanstack/react-router';
import { IconExclamation } from '../../../../assets/icons';
import { PrimaryButton, USUAL_MAXIMUM } from './components';
import { useReviewSession } from './reviewSession';

/** Introduce unmatched-student review and point to the next action. */
export const ReviewNotice = () => {
  const { counts } = useReviewSession();
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });
  const onView = () => navigate({ search: { tab: 'students' }, resetScroll: false });
  const { total, toReview, ready, runFailed, reprocessed, excluded } = counts;
  const processed = reprocessed + excluded;
  const allDone = total > 0 && processed === total;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const progress = [
    ready > 0 && `${ready} ready to submit`,
    processed > 0 && `${processed} processed`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box padding="300" borderRadius="8px" backgroundColor="blue.600" width="100%">
      <HStack gap="200" marginBottom="200">
        <Box
          bg={allDone ? 'green.100' : 'pink.400'}
          color={allDone ? 'green.600' : undefined}
          padding="200"
          borderRadius="21px"
          flexShrink={0}
        >
          {allDone ? <CheckIcon display="block" /> : <IconExclamation />}
        </Box>
        <Box textStyle="bodyLargeBold">
          {plural(total, 'student', 'students')} couldn't be matched automatically
        </Box>
      </HStack>
      <Box textStyle="body" marginBottom="300">
        {allDone
          ? 'All done! Every student has been reprocessed or excluded. No further action is needed.'
          : "Their assessments weren't loaded because no roster student was a close enough match. Review each one to choose from the suggested students, search the roster, or exclude the record, then submit your matches for reprocessing."}
      </Box>
      {progress && (
        <Box textStyle="body" fontWeight="600" marginBottom="300">
          {progress}
        </Box>
      )}
      {runFailed > 0 && (
        <Box marginBottom="300" textStyle="body" role="status">
          <Box fontWeight="600">
            Reprocessing failed for {plural(runFailed, 'student', 'students')}
          </Box>
          <Box opacity="0.85">
            Your match decisions have been preserved. Please contact support from the Unmatched
            Students tab.
          </Box>
        </Box>
      )}
      {!allDone && total > USUAL_MAXIMUM && (
        <Box textStyle="body" marginBottom="300" color="purple.200">
          That's more than a file usually has, which often points to a problem with the file itself
          (such as the wrong ID column or school year). Fixing and uploading it again may be
          quicker.
        </Box>
      )}
      <PrimaryButton onClick={onView}>
        {toReview
          ? processed || ready || runFailed
            ? 'Continue review'
            : 'Review unmatched students'
          : ready
          ? 'Review and submit'
          : 'View unmatched students'}
      </PrimaryButton>
    </Box>
  );
};

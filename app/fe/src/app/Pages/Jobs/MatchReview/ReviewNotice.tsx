import { Box, HStack } from '@chakra-ui/react';
import { IconExclamation } from '../../../../assets/icons';
import { PrimaryButton, QuietButton } from './components';
import { StudentStatus, useReviewSession } from './reviewSession';
import { USUAL_MAXIMUM } from './WorkspaceReview';

/*
 * PROTOTYPE. The job page's pointer to unmatched-student review, driven by
 * the stored match results (via the review session) rather than the older
 * unmatched-IDs summary on the run. Styled like that older notice.
 */

export const ReviewNotice = ({ onReview }: { onReview: () => void }) => {
  const { groups, isLoading, statusOf } = useReviewSession();
  if (isLoading || !groups.length) return null;

  const count = (...statuses: StudentStatus[]) =>
    groups.filter((g) => statuses.includes(statusOf(g.correlationId))).length;
  const toReview = count('to-review', 'run-failed');
  const ready = count('ready');
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (!toReview && !ready) {
    return (
      <HStack gap="200" fontSize="0.9rem">
        <Box opacity="0.85">
          Unmatched students: every student has been reviewed and either submitted or excluded.
        </Box>
        <QuietButton size="xs" onClick={onReview}>
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
            : `${plural(ready, 'saved match hasn’t', 'saved matches haven’t')} been submitted`}
        </Box>
      </HStack>
      <Box textStyle="body" marginBottom="300">
        {toReview
          ? "Their assessments weren't loaded because no roster student was a close enough match. Review each one to choose from the suggested students, search the roster, or exclude the record, then submit your matches for reprocessing."
          : 'Submit them for reprocessing so these students’ assessments can load.'}
        {toReview > 0 &&
          ready > 0 &&
          ` ${plural(ready, 'match is', 'matches are')} saved and waiting to be submitted.`}
      </Box>
      {groups.length > USUAL_MAXIMUM && (
        <Box textStyle="body" marginBottom="300" color="purple.200">
          That's more than a file usually has, which often points to a problem with the file itself
          (such as the wrong ID column or school year). Fixing and uploading it again may be
          quicker.
        </Box>
      )}
      <PrimaryButton onClick={onReview}>
        {toReview ? 'Review unmatched students' : 'Review and submit'}
      </PrimaryButton>
    </Box>
  );
};

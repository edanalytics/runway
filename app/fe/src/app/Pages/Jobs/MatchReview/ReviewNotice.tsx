import { Box, HStack } from '@chakra-ui/react';
import { outstandingStudents } from '@edanalytics/models';
import { useNavigate } from '@tanstack/react-router';
import { IconExclamation } from '../../../../assets/icons';
import { PrimaryButton, QuietButton, TooManyNote, USUAL_MAXIMUM } from './components';
import { useReviewSession } from './reviewSession';

/*
 * The job page's pointer to unmatched-student review, driven by
 * the stored match results (via the review session) rather than the older
 * unmatched-IDs summary on the run. Styled like that older notice.
 */

export const ReviewNotice = () => {
  const { counts } = useReviewSession();
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });
  const onReview = () => navigate({ search: { tab: 'students' }, resetScroll: false });

  const { toReview, ready, reprocessing, runFailed } = counts;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  // Nothing left for the reviewer to do: the students are done, or their
  // submissions are still running.
  if (outstandingStudents(counts) === reprocessing) {
    return (
      <HStack gap="200" fontSize="0.9rem">
        <Box opacity="0.85">
          {reprocessing
            ? `Unmatched students: ${plural(
                reprocessing,
                'student is',
                'students are'
              )} reprocessing with their matches.`
            : 'Unmatched students: every student has been reviewed and either submitted or excluded.'}
        </Box>
        <QuietButton size="xs" onClick={onReview}>
          View
        </QuietButton>
      </HStack>
    );
  }

  // The reviewer's next step leads; anything else outstanding follows it.
  const lead = toReview ? 'to-review' : ready ? 'ready' : 'run-failed';
  const others = [
    lead !== 'ready' && ready > 0 && `${plural(ready, 'match is', 'matches are')} ready to submit.`,
    reprocessing > 0 && `${plural(reprocessing, 'student is', 'students are')} reprocessing.`,
    lead !== 'run-failed' &&
      runFailed > 0 &&
      `${plural(runFailed, 'student is', 'students are')} in a submission that failed.`,
  ].filter(Boolean);

  return (
    <Box padding="300" borderRadius="8px" backgroundColor="blue.600" width="100%">
      <HStack gap="200" marginBottom="200">
        <Box bg="pink.400" padding="200" borderRadius="21px">
          <IconExclamation />
        </Box>
        <Box textStyle="bodyLargeBold">
          {lead === 'to-review'
            ? `${plural(toReview, 'student', 'students')} couldn't be matched automatically`
            : lead === 'ready'
            ? `${plural(ready, 'saved match hasn’t', 'saved matches haven’t')} been submitted`
            : `A submission failed for ${plural(runFailed, 'student', 'students')}`}
        </Box>
      </HStack>
      <Box textStyle="body" marginBottom="300">
        {lead === 'to-review'
          ? "Their assessments weren't loaded because no roster student was a close enough match. Review each one to choose from the suggested students, search the roster, or exclude the record, then submit your matches for reprocessing."
          : lead === 'ready'
          ? 'Submit them for reprocessing so these students’ assessments can load.'
          : 'Their matches are saved, but the run that sends them failed. The Unmatched Students tab shows what to do next.'}
        {others.map((sentence) => ` ${sentence}`)}
      </Box>
      {counts.total > USUAL_MAXIMUM && (
        <Box marginBottom="300">
          <TooManyNote count={counts.total} />
        </Box>
      )}
      <PrimaryButton onClick={onReview}>
        {lead === 'to-review'
          ? 'Review unmatched students'
          : lead === 'ready'
          ? 'Review and submit'
          : 'View unmatched students'}
      </PrimaryButton>
    </Box>
  );
};

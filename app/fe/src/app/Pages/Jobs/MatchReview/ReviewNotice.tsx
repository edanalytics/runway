import { CheckIcon } from '@chakra-ui/icons';
import { Box, HStack, Icon } from '@chakra-ui/react';
import { useNavigate } from '@tanstack/react-router';
import { TbUserSearch } from 'react-icons/tb';
import { IconExclamation } from '../../../../assets/icons';
import { ContactSupport } from '../../../components/SupportButton';
import { PrimaryButton, SecondaryButton, USUAL_MAXIMUM } from './components';
import { useReviewSession } from './reviewSession';

/** Introduce unmatched-student review and point to the next action. */
export const ReviewNotice = () => {
  const { job, counts } = useReviewSession();
  const navigate = useNavigate({ from: '/assessments/$assessmentId/' });
  const onView = () => navigate({ search: { tab: 'students' }, resetScroll: false });
  const { total, toReview, ready, runFailed, reprocessing, reprocessed, excluded } = counts;
  const processed = reprocessed + excluded;
  const allDone = total > 0 && processed === total;
  const started = toReview < total;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const progress = [
    ready > 0 && `${ready} ready to submit`,
    processed > 0 && `${processed} processed`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box padding="300" borderRadius="8px" backgroundColor="blue.600" width="100%">
      <HStack justifyContent="space-between" gap="300" flexWrap="wrap" marginBottom="200">
        <HStack gap="200">
          <Box
            bg={allDone ? 'green.100' : 'pink.400'}
            color={allDone ? 'green.600' : 'pink.50'}
            padding="200"
            borderRadius="21px"
            flexShrink={0}
          >
            {allDone ? (
              <CheckIcon display="block" />
            ) : (
              <Icon as={TbUserSearch} boxSize="1.25rem" display="block" aria-hidden="true" />
            )}
          </Box>
          <Box textStyle="bodyLargeBold">
            {allDone
              ? `${total === 1 ? '' : 'All '}${plural(total, 'student', 'students')} processed`
              : plural(total, 'unmatched student', 'unmatched students')}
          </Box>
        </HStack>
        {!allDone && progress && (
          <Box textStyle="body" fontWeight="600">
            {progress}
          </Box>
        )}
      </HStack>
      {runFailed === 0 && (
        <Box textStyle="body" marginBottom="300">
          {allDone
            ? 'Every student has been matched and processed, or excluded.'
            : started
            ? toReview > 0
              ? 'Review the remaining students, then submit your matches.'
              : ready > 0
              ? 'Submit your matches to send their assessments.'
              : reprocessing > 0
              ? 'Your matches have been submitted.'
              : 'Your students have been reviewed.'
            : "Their assessments haven't been sent because Runway couldn't automatically match these students to your roster. Review them to find matches and send their assessments."}
        </Box>
      )}
      {reprocessing > 0 && (
        <Box textStyle="body" opacity="0.85" marginBottom="300" role="status">
          Sending assessments…
        </Box>
      )}
      {runFailed > 0 && (
        <Box marginBottom="300" textStyle="body" role="status">
          <HStack gap="200" alignItems="flex-start">
            <Box bg="pink.400" padding="100" borderRadius="999px" flexShrink={0} aria-hidden="true">
              <IconExclamation />
            </Box>
            <Box fontWeight="600">
              There was a problem sending assessments for {plural(runFailed, 'student', 'students')}
              .
            </Box>
          </HStack>
          <Box opacity="0.85">
            You can continue reviewing students and saving matches. Please contact support to
            resolve the sending issue before submitting more matches.
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
      {runFailed > 0 ? (
        <HStack gap="300" flexWrap="wrap">
          <ContactSupport message={`Job ${job.id}: problem sending assessments`} />
          <SecondaryButton onClick={onView}>View unmatched students</SecondaryButton>
        </HStack>
      ) : (
        <PrimaryButton onClick={onView}>
          {allDone ? 'View students' : started ? 'Continue review' : 'Review unmatched students'}
        </PrimaryButton>
      )}
    </Box>
  );
};

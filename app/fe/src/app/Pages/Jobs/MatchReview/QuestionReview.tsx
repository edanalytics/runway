import { Box, HStack, Progress, Spinner, VStack } from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { useState } from 'react';
import { compare } from './compare';
import {
  BatchActivity,
  ComparisonTable,
  DesignIntro,
  Evidence,
  FileLine,
  PrimaryButton,
  QuietButton,
  SearchPanel,
  SecondaryButton,
  studentName,
} from './components';
import { Candidate, suggestedCandidates, useReviewSession } from './reviewSession';

/*
 * PROTOTYPE, design 3: Yes / no. One question at a time: "Is this the same
 * student?" The bet: comparing one pair is easier and less error-prone than
 * choosing among several, so never show more than one roster student at once.
 * Suggestions come strongest first; a "no" moves to the next, and running out
 * of suggestions turns the question into "can you find them?"
 */

export const QuestionReview = () => {
  const { groups, isLoading, isError, statusOf } = useReviewSession();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [reviewingSummary, setReviewingSummary] = useState(false);

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const open = groups.filter((g) => ['to-review', 'failed'].includes(statusOf(g.correlationId)));
  // Returned failures first, then easiest first, so momentum builds; skipped last.
  const queue = [...open].sort(
    (a, b) =>
      Number(skipped.includes(a.correlationId)) - Number(skipped.includes(b.correlationId)) ||
      Number(statusOf(b.correlationId) === 'failed') -
        Number(statusOf(a.correlationId) === 'failed') ||
      ease(b) - ease(a)
  );
  const current = reviewingSummary ? undefined : queue[0];
  const answered = groups.length - open.length;

  return (
    <VStack alignItems="flex-start" width="100%" gap="400">
      <DesignIntro
        title="Yes / no: one question at a time"
        bet="Comparing one pair is easier than choosing among several, so you only ever see one roster student at a time, strongest first. Say no and the next suggestion comes up; when suggestions run out, the question becomes whether you can find them."
      />
      <VStack alignItems="stretch" width="100%" gap="100">
        <HStack justifyContent="space-between" fontSize="0.9rem">
          <Box>
            {answered} of {groups.length} answered
          </Box>
          {current && (
            <QuietButton onClick={() => setReviewingSummary(true)}>
              Review answers and submit
            </QuietButton>
          )}
        </HStack>
        <Progress
          value={(answered / groups.length) * 100}
          size="sm"
          borderRadius="4px"
          bg="blue.600"
          sx={{ '& > div': { bg: 'green.100' } }}
        />
      </VStack>
      <Box width="100%" maxWidth="52rem" alignSelf="center">
        {current ? (
          <Question
            key={current.correlationId}
            group={current}
            onSkip={() =>
              setSkipped((list) => [
                ...list.filter((id) => id !== current.correlationId),
                current.correlationId,
              ])
            }
            isLastOpen={queue.length === 1}
          />
        ) : (
          <Summary
            stillOpen={open.length}
            onBack={open.length ? () => setReviewingSummary(false) : undefined}
          />
        )}
      </Box>
    </VStack>
  );
};

/** How obvious a student is: a strong top suggestion first, no suggestions last. */
const ease = (group: GetStudentInputDetailsDto) => {
  const [top] = suggestedCandidates(group);
  if (!top) return 0;
  const strength = compare(group.inputDetails, top.rosterDetails).strength;
  return { strong: 3, possible: 2, weak: 1 }[strength];
};

const Question = ({
  group,
  onSkip,
  isLastOpen,
}: {
  group: GetStudentInputDetailsDto;
  onSkip: () => void;
  isLastOpen: boolean;
}) => {
  const { decide, statusOf, lastSubmission } = useReviewSession();
  const candidates = suggestedCandidates(group);
  const failed = lastSubmission(group.correlationId);
  // Skip the suggestion that already failed to load, if it was one.
  const [index, setIndex] = useState(() =>
    statusOf(group.correlationId) === 'failed' &&
    failed?.decision.kind === 'match' &&
    candidates[0]?.studentUniqueId === failed.decision.candidate.studentUniqueId
      ? 1
      : 0
  );
  const candidate: Candidate | undefined = candidates[index];

  return (
    <VStack alignItems="stretch" gap="400" layerStyle="contentBox" padding="500">
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          From your file
        </Box>
        <Box textStyle="h3">{studentName(group.inputDetails)}</Box>
        <FileLine details={group.inputDetails} />
      </VStack>

      {statusOf(group.correlationId) === 'failed' && (
        <Box padding="300" borderRadius="6px" borderWidth="1px" borderColor="pink.100">
          Your last answer didn't load: {failed?.reason}
        </Box>
      )}

      {candidate ? (
        <VStack alignItems="stretch" gap="300">
          <HStack justifyContent="space-between" alignItems="baseline">
            <Box textStyle="h4">Is this the same student?</Box>
            <Box fontSize="0.85rem" opacity="0.7">
              Suggestion {index + 1} of {candidates.length}
            </Box>
          </HStack>
          <Evidence comparison={compare(group.inputDetails, candidate.rosterDetails)} />
          <ComparisonTable
            comparison={compare(group.inputDetails, candidate.rosterDetails)}
            rosterHeading={`Roster: ${candidate.studentUniqueId}`}
          />
          <HStack gap="300" paddingTop="200">
            <PrimaryButton
              size="md"
              minWidth="10rem"
              onClick={() => decide(group.correlationId, { kind: 'match', candidate })}
            >
              Yes, same student
            </PrimaryButton>
            <SecondaryButton size="md" minWidth="10rem" onClick={() => setIndex(index + 1)}>
              No
              {index + 1 < candidates.length ? ', show the next' : ''}
            </SecondaryButton>
            <Box flex="1" />
            {!isLastOpen && <QuietButton onClick={onSkip}>Not sure, come back later</QuietButton>}
          </HStack>
        </VStack>
      ) : (
        <VStack alignItems="stretch" gap="300">
          <Box textStyle="h4">
            {candidates.length
              ? 'None of the suggestions. Can you find them?'
              : 'IDRS suggested no one. Can you find them?'}
          </Box>
          <Box fontSize="0.9rem" opacity="0.85">
            Correct the details, or enter their student unique ID if you know it. If they aren't in
            the roster, their record can't be loaded.
          </Box>
          <SearchPanel
            group={group}
            onPick={(found) => decide(group.correlationId, { kind: 'match', candidate: found })}
            heading="Search the roster"
          />
          <HStack gap="300">
            <SecondaryButton
              size="md"
              onClick={() => decide(group.correlationId, { kind: 'not-in-roster' })}
            >
              They're not in the roster
            </SecondaryButton>
            {candidates.length > 0 && (
              <QuietButton onClick={() => setIndex(0)}>Start the suggestions over</QuietButton>
            )}
            <Box flex="1" />
            {!isLastOpen && <QuietButton onClick={onSkip}>Not sure, come back later</QuietButton>}
          </HStack>
        </VStack>
      )}
    </VStack>
  );
};

/** Every answer not yet submitted, to check over and send as one batch. */
const Summary = ({ stillOpen, onBack }: { stillOpen: number; onBack?: () => void }) => {
  const { groups, statusOf, decisions, undo, submit, batches } = useReviewSession();
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');

  return (
    <VStack alignItems="stretch" gap="400">
      <VStack alignItems="stretch" gap="300" layerStyle="contentBox" padding="500">
        <Box textStyle="h4">
          {ready.length
            ? `Check your ${ready.length} ${ready.length === 1 ? 'answer' : 'answers'}`
            : stillOpen
            ? 'Nothing answered yet'
            : batches.length
            ? 'All answered and submitted'
            : 'Nothing to review'}
        </Box>
        {ready.map((group) => {
          const decision = decisions.get(group.correlationId);
          return (
            <HStack
              key={group.correlationId}
              gap="300"
              paddingY="200"
              borderBottomWidth="1px"
              borderColor="blue.50-40"
            >
              <Box width="14rem" fontWeight="600">
                {studentName(group.inputDetails)}
              </Box>
              <Box flex="1">
                {decision?.kind === 'match'
                  ? `Same student as ${decision.candidate.studentUniqueId}${
                      decision.candidate.source === 'search' ? ' (you found them)' : ''
                    }`
                  : 'Not in the roster: leave out'}
              </Box>
              <QuietButton onClick={() => undo(group.correlationId)}>Ask me again</QuietButton>
            </HStack>
          );
        })}
        <HStack gap="300" paddingTop="200">
          {ready.length > 0 && (
            <PrimaryButton size="md" onClick={() => submit(ready.map((g) => g.correlationId))}>
              Submit {ready.length} for reprocessing
            </PrimaryButton>
          )}
          {onBack && (
            <SecondaryButton size="md" onClick={onBack}>
              Keep answering ({stillOpen} left)
            </SecondaryButton>
          )}
        </HStack>
      </VStack>
      <VStack alignItems="flex-start" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet." />
      </VStack>
    </VStack>
  );
};

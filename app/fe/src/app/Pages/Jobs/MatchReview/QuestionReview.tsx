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
  OthersMatchesNote,
  PrimaryButton,
  PrototypeControls,
  QuietButton,
  ReviewProgress,
  SearchPanel,
  SecondaryButton,
  studentName,
} from './components';
import { Candidate, suggestedCandidates, useReviewSession } from './reviewSession';

/*
 * PROTOTYPE, design 3: Yes / no. One question at a time: "Is this the same
 * student?" The bet: comparing one pair is easier and less error-prone than
 * choosing among several, so never show more than one roster student at once.
 * Suggestions come highest IDRS score first; a "no" moves to the next, and running out
 * of suggestions turns the question into "can you find them?"
 */

export const QuestionReview = () => {
  const { groups, isLoading, isError, statusOf } = useReviewSession();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [reviewingSummary, setReviewingSummary] = useState(false);

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const open = groups.filter((g) => statusOf(g.correlationId) === 'to-review');
  // Highest IDRS score first, so momentum builds; skipped last.
  const queue = [...open].sort(
    (a, b) =>
      Number(skipped.includes(a.correlationId)) - Number(skipped.includes(b.correlationId)) ||
      ease(b) - ease(a)
  );
  const current = reviewingSummary ? undefined : queue[0];
  const answered = groups.length - open.length;

  return (
    <VStack alignItems="flex-start" width="100%" gap="400">
      <DesignIntro
        title="Yes / no: one question at a time"
        bet="One question at a time, with only one roster student on screen: is this the same student? Suggestions come highest match score first; no brings up the next, and when they run out the question becomes whether you can find them. It ends on a summary of your answers to check before submitting."
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

/** Highest IDRS score first, no suggestions last. */
const ease = (group: GetStudentInputDetailsDto) => suggestedCandidates(group)[0]?.score ?? 0;

const Question = ({
  group,
  onSkip,
  isLastOpen,
}: {
  group: GetStudentInputDetailsDto;
  onSkip: () => void;
  isLastOpen: boolean;
}) => {
  const { decide } = useReviewSession();
  const candidates = suggestedCandidates(group);
  const [index, setIndex] = useState(0);
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

      {candidate ? (
        <VStack alignItems="stretch" gap="300">
          <HStack justifyContent="space-between" alignItems="baseline">
            <Box textStyle="h4">Is this the same student?</Box>
            <Box fontSize="0.85rem" opacity="0.7">
              Suggestion {index + 1} of {candidates.length}
            </Box>
          </HStack>
          <Evidence
            comparison={compare(group.inputDetails, candidate.rosterDetails)}
            score={candidate.score}
          />
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
            Correct the details, and add any IDs you have for them. If they aren't in the roster,
            their record can't be loaded.
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
              Exclude: not in the roster
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
  const excluded = groups.filter((g) => statusOf(g.correlationId) === 'excluded');

  return (
    <VStack alignItems="stretch" gap="400">
      <VStack alignItems="stretch" gap="300" layerStyle="contentBox" padding="500">
        <Box textStyle="h4">
          {ready.length
            ? `Check your ${ready.length} ${
                ready.length === 1 ? 'match' : 'matches'
              } before submitting`
            : stillOpen
            ? 'Nothing answered yet'
            : batches.length
            ? 'All answered and submitted'
            : 'Nothing to review'}
        </Box>
        {[...ready, ...excluded].map((group) => {
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
                  : 'Excluded: not in the roster'}
              </Box>
              <QuietButton onClick={() => undo(group.correlationId)}>Ask me again</QuietButton>
            </HStack>
          );
        })}
        {excluded.length > 0 && (
          <Box fontSize="0.85rem" opacity="0.8">
            Exclusions take effect right away; only matches are submitted.
          </Box>
        )}
        <OthersMatchesNote ready={ready} />
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
      <ReviewProgress />
      <VStack alignItems="flex-start" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet." />
      </VStack>
      <PrototypeControls />
    </VStack>
  );
};

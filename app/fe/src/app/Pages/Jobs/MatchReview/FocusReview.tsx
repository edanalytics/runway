import { Box, HStack, Spinner, VStack } from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
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
import { Candidate, StudentStatus, suggestedCandidates, useReviewSession } from './reviewSession';

/*
 * PROTOTYPE, design 1: Focus. One student at a time, one flow whether IDRS
 * suggested nobody, one student or several. The bet: every decision deserves
 * full attention, so make the comparison effortless and moving on fast.
 */

const sections: { status: StudentStatus; title: string }[] = [
  { status: 'failed', title: 'Needs another look' },
  { status: 'to-review', title: 'To review' },
  { status: 'ready', title: 'Ready to submit' },
  { status: 'reprocessing', title: 'Reprocessing' },
  { status: 'loaded', title: 'Loaded' },
  { status: 'left-out', title: 'Left out' },
];

const statusGlyph: Record<StudentStatus, string> = {
  failed: '!',
  'to-review': '○',
  ready: '●',
  reprocessing: '…',
  loaded: '✓',
  'left-out': '⊘',
};

export const FocusReview = () => {
  const session = useReviewSession();
  const { groups, isLoading, isError, statusOf, decisions, submit } = session;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const needsDecision = (id: string) => ['to-review', 'failed'].includes(statusOf(id));
  const ordered = useMemo(
    () =>
      sections.flatMap(({ status }) =>
        groups.filter((group) => statusOf(group.correlationId) === status)
      ),
    [groups, statusOf]
  );
  const ready = groups.filter((group) => statusOf(group.correlationId) === 'ready');

  useEffect(() => {
    if (!selectedId && groups.length) {
      setSelectedId(
        (groups.find((group) => needsDecision(group.correlationId)) ?? groups[0]).correlationId
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedId]);

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected = groups.find((group) => group.correlationId === selectedId) ?? groups[0];
  const move = (step: number) => {
    const index = ordered.findIndex((group) => group.correlationId === selected.correlationId);
    const next = ordered[(index + step + ordered.length) % ordered.length];
    setSelectedId(next.correlationId);
  };
  const advance = () => {
    const next = groups.find(
      (group) =>
        group.correlationId !== selected.correlationId && needsDecision(group.correlationId)
    );
    if (next) setSelectedId(next.correlationId);
  };
  const decided = groups.filter((group) => statusOf(group.correlationId) !== 'to-review').length;

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input')) return;
    if (event.key === 'j' || event.key === 'ArrowDown') move(1);
    if (event.key === 'k' || event.key === 'ArrowUp') move(-1);
  };

  return (
    // Keyboard shortcuts listen here, so hidden tabs don't react.
    <VStack
      alignItems="flex-start"
      width="100%"
      gap="400"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      outline="none"
    >
      <DesignIntro
        title="Focus: one student at a time"
        bet="Every decision deserves full attention. The comparison does the lining-up, the panel adapts to how many suggestions there are, and deciding moves you to the next student. Keyboard: j/k to move, 1–9 to pick, n for not in roster, u to undo."
      />
      <HStack alignItems="flex-start" width="100%" gap="400">
        <VStack
          width="17rem"
          flexShrink={0}
          alignItems="stretch"
          layerStyle="contentBox"
          padding="300"
          gap="300"
        >
          <Box fontSize="0.9rem">
            {decided} of {groups.length} decided
          </Box>
          {sections.map(({ status, title }) => {
            const members = groups.filter((group) => statusOf(group.correlationId) === status);
            if (!members.length) return null;
            return (
              <VStack key={status} alignItems="stretch" gap="100">
                <Box fontSize="0.8rem" fontWeight="600" opacity="0.8">
                  {title} ({members.length})
                </Box>
                {members.map((group) => {
                  const isSelected = group.correlationId === selected.correlationId;
                  const decision = decisions.get(group.correlationId);
                  return (
                    <HStack
                      as="button"
                      key={group.correlationId}
                      onClick={() => setSelectedId(group.correlationId)}
                      gap="200"
                      paddingX="200"
                      paddingY="100"
                      borderRadius="4px"
                      bg={isSelected ? 'blue.500' : undefined}
                      _hover={{ bg: isSelected ? 'blue.500' : 'blue.600' }}
                      textAlign="left"
                    >
                      <Box
                        width="1rem"
                        color={
                          status === 'failed'
                            ? 'pink.100'
                            : status === 'loaded'
                            ? 'green.100'
                            : undefined
                        }
                      >
                        {statusGlyph[status]}
                      </Box>
                      <Box flex="1">{studentName(group.inputDetails)}</Box>
                      {status === 'ready' && decision && (
                        <Box fontSize="0.75rem" opacity="0.8">
                          {decision.kind === 'match' ? decision.candidate.studentUniqueId : 'none'}
                        </Box>
                      )}
                    </HStack>
                  );
                })}
              </VStack>
            );
          })}
          <Box borderTopWidth="1px" borderColor="blue.50-40" paddingTop="300">
            {!confirming ? (
              <PrimaryButton
                width="100%"
                isDisabled={!ready.length}
                onClick={() => setConfirming(true)}
              >
                Submit {ready.length || ''} for reprocessing
              </PrimaryButton>
            ) : (
              <SubmitConfirmation
                ready={ready}
                onCancel={() => setConfirming(false)}
                onSubmit={() => {
                  submit(ready.map((group) => group.correlationId));
                  setConfirming(false);
                }}
              />
            )}
          </Box>
        </VStack>
        <Box flex="1" minWidth="0" layerStyle="contentBox" padding="400">
          <FocusPanel key={selected.correlationId} group={selected} onDecided={advance} />
        </Box>
      </HStack>
      <VStack alignItems="flex-start" width="100%" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet. Submitted decisions run as a batch, and batches can run side by side." />
      </VStack>
    </VStack>
  );
};

const SubmitConfirmation = ({
  ready,
  onCancel,
  onSubmit,
}: {
  ready: GetStudentInputDetailsDto[];
  onCancel: () => void;
  onSubmit: () => void;
}) => {
  const { decisions } = useReviewSession();
  const matches = ready.filter(
    (group) => decisions.get(group.correlationId)?.kind === 'match'
  ).length;
  const leftOut = ready.length - matches;
  return (
    <VStack alignItems="stretch" gap="200">
      <Box fontSize="0.9rem">
        {matches} {matches === 1 ? 'student' : 'students'} will be loaded with the match you chose.
        {leftOut > 0 && ` ${leftOut} marked not in roster will be left out.`}
      </Box>
      <PrimaryButton onClick={onSubmit}>Submit batch</PrimaryButton>
      <QuietButton onClick={onCancel}>Cancel</QuietButton>
    </VStack>
  );
};

/** The decision for one student, adapting to what IDRS found. */
const FocusPanel = ({
  group,
  onDecided,
}: {
  group: GetStudentInputDetailsDto;
  onDecided: () => void;
}) => {
  const { statusOf, decisions, decide, undo, lastSubmission } = useReviewSession();
  const status = statusOf(group.correlationId);
  const decision = decisions.get(group.correlationId);
  const candidates = suggestedCandidates(group);
  const [changing, setChanging] = useState(false);
  // With one suggestion, "No" opens the alternatives; with several, "None of these" does.
  const [rejectedSuggestions, setRejectedSuggestions] = useState(false);

  const choose = (candidate: Candidate) => {
    decide(group.correlationId, { kind: 'match', candidate });
    setChanging(false);
    onDecided();
  };
  const notInRoster = () => {
    decide(group.correlationId, { kind: 'not-in-roster' });
    setChanging(false);
    onDecided();
  };
  const canDecide = status === 'to-review' || status === 'failed' || changing;

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input') || !canDecide) {
      if (event.key === 'u' && decision && status === 'ready') undo(group.correlationId);
      return;
    }
    const pick = Number(event.key);
    if (pick >= 1 && pick <= candidates.length) choose(candidates[pick - 1]);
    if (event.key === 'n') notInRoster();
    if (event.key === 'y' && candidates.length === 1) choose(candidates[0]);
  };

  const failure = status === 'failed' ? lastSubmission(group.correlationId)?.reason : undefined;

  return (
    <VStack alignItems="flex-start" gap="400" width="100%" onKeyDown={onKeyDown}>
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          From your file
        </Box>
        <Box textStyle="h4">{studentName(group.inputDetails)}</Box>
        <FileLine details={group.inputDetails} />
      </VStack>

      {failure && (
        <Box padding="300" borderRadius="6px" borderWidth="1px" borderColor="pink.100" width="100%">
          The last submission didn't load: {failure} Choose again below.
        </Box>
      )}

      {status === 'reprocessing' && <Box>Submitted — reprocessing now. See the batch below.</Box>}
      {status === 'loaded' && decision?.kind === 'match' && (
        <Box color="green.100">Loaded as {decision.candidate.studentUniqueId}.</Box>
      )}

      {(status === 'ready' || status === 'left-out') && !changing && decision && (
        <VStack alignItems="flex-start" gap="200">
          <Box>
            {decision.kind === 'match'
              ? `You matched this student to ${decision.candidate.studentUniqueId}.`
              : 'You marked this student as not in the roster. Their record will be left out.'}
          </Box>
          <HStack gap="200">
            <SecondaryButton onClick={() => setChanging(true)}>Change</SecondaryButton>
            {status === 'ready' && (
              <QuietButton onClick={() => undo(group.correlationId)}>Undo (u)</QuietButton>
            )}
          </HStack>
        </VStack>
      )}

      {canDecide && (
        <VStack alignItems="flex-start" gap="400" width="100%">
          {candidates.length === 1 && !rejectedSuggestions && (
            <VStack alignItems="flex-start" gap="300" width="100%">
              <Box textStyle="h5">Is this the same student?</Box>
              <CandidateCard candidate={candidates[0]} group={group} />
              <HStack gap="200">
                <PrimaryButton onClick={() => choose(candidates[0])}>
                  Yes, same student (y)
                </PrimaryButton>
                <SecondaryButton onClick={() => setRejectedSuggestions(true)}>No</SecondaryButton>
              </HStack>
            </VStack>
          )}

          {candidates.length > 1 && !rejectedSuggestions && (
            <VStack alignItems="flex-start" gap="300" width="100%">
              <Box textStyle="h5">
                IDRS found {candidates.length} possible students. Pick the one who matches.
              </Box>
              {candidates.map((candidate, index) => (
                <CandidateCard
                  key={candidate.studentUniqueId}
                  candidate={candidate}
                  group={group}
                  action={
                    <PrimaryButton onClick={() => choose(candidate)}>
                      Match ({index + 1})
                    </PrimaryButton>
                  }
                />
              ))}
              <SecondaryButton onClick={() => setRejectedSuggestions(true)}>
                None of these
              </SecondaryButton>
            </VStack>
          )}

          {(candidates.length === 0 || rejectedSuggestions) && (
            <VStack alignItems="flex-start" gap="300" width="100%">
              <Box textStyle="h5">
                {candidates.length === 0
                  ? 'IDRS found no one who matches.'
                  : 'Not one of the suggestions. Search, or mark as not in the roster.'}
              </Box>
              <SearchPanel group={group} onPick={choose} heading="Search with corrected details" />
              <HStack gap="300" alignItems="center">
                <SecondaryButton onClick={notInRoster}>Not in roster (n)</SecondaryButton>
                <Box fontSize="0.85rem" opacity="0.8">
                  Their record can't be loaded and will be left out.
                </Box>
              </HStack>
              {rejectedSuggestions && (
                <QuietButton onClick={() => setRejectedSuggestions(false)}>
                  Back to the suggestions
                </QuietButton>
              )}
            </VStack>
          )}
        </VStack>
      )}
    </VStack>
  );
};

const CandidateCard = ({
  candidate,
  group,
  action,
}: {
  candidate: Candidate;
  group: GetStudentInputDetailsDto;
  action?: React.ReactNode;
}) => {
  const comparison = compare(group.inputDetails, candidate.rosterDetails);
  return (
    <Box width="100%" padding="300" borderRadius="6px" bg="blue.600">
      <HStack justifyContent="space-between" alignItems="flex-start" gap="300">
        <VStack alignItems="flex-start" gap="200" flex="1" minWidth="0">
          <Evidence comparison={comparison} />
          <ComparisonTable comparison={comparison} rosterHeading={candidate.studentUniqueId} />
          {candidate.score !== null && (
            <Box fontSize="0.75rem" opacity="0.6">
              IDRS score {candidate.score}
            </Box>
          )}
        </VStack>
        {action}
      </HStack>
    </Box>
  );
};

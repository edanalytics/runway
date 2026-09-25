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
  NoSuggestionFits,
  QuietButton,
  ReviewProgress,
  SecondaryButton,
  studentName,
} from './components';
import {
  Candidate,
  Decision,
  StudentStatus,
  suggestedCandidates,
  useReviewSession,
} from './reviewSession';

/*
 * PROTOTYPE, design 1: Focus. One student at a time, one flow whether IDRS
 * suggested nobody, one student or several. The bet: every decision deserves
 * full attention, so make the comparison effortless and moving on fast.
 */

const sections: { status: StudentStatus; title: string }[] = [
  { status: 'to-review', title: 'To review' },
  { status: 'run-failed', title: 'Run failed' },
  { status: 'ready', title: 'Ready to submit' },
  { status: 'reprocessing', title: 'Reprocessing' },
  { status: 'reprocessed', title: 'Reprocessed' },
  { status: 'excluded', title: 'Excluded: not in roster' },
];

const statusGlyph: Record<StudentStatus, string> = {
  'to-review': '○',
  'run-failed': '!',
  ready: '●',
  reprocessing: '…',
  reprocessed: '✓',
  excluded: '⊘',
};

/** The decision just made, announced as the panel moves on. */
type Transition = {
  correlationId: string;
  name: string;
  outcome: string;
  previous: Decision | undefined;
  /** Who the panel moved on to, if anyone was left to review. */
  nextName: string | null;
};

export const FocusReview = () => {
  const session = useReviewSession();
  const { groups, isLoading, isError, statusOf, decisions, decide, undo, submit } = session;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [transition, setTransition] = useState<Transition | null>(null);

  const needsDecision = (id: string) => statusOf(id) === 'to-review';
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
  const select = (id: string) => {
    setSelectedId(id);
    setTransition(null);
  };
  const move = (step: number) => {
    const index = ordered.findIndex((group) => group.correlationId === selected.correlationId);
    select(ordered[(index + step + ordered.length) % ordered.length].correlationId);
  };
  const toReview = groups.filter((group) => needsDecision(group.correlationId));

  // Deciding moves on to the next student still to review, and says so.
  const onDecided = (outcome: string, previous: Decision | undefined) => {
    const next = toReview.find((group) => group.correlationId !== selected.correlationId);
    setTransition({
      correlationId: selected.correlationId,
      name: studentName(selected.inputDetails),
      outcome,
      previous,
      nextName: next ? studentName(next.inputDetails) : null,
    });
    if (next) setSelectedId(next.correlationId);
  };
  const undoTransition = (t: Transition) => {
    if (t.previous) decide(t.correlationId, t.previous);
    else undo(t.correlationId);
    select(t.correlationId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input')) return;
    if (event.key === 'j' || event.key === 'ArrowDown') move(1);
    if (event.key === 'k' || event.key === 'ArrowUp') move(-1);
  };

  const position = toReview.findIndex((g) => g.correlationId === selected.correlationId);

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
        bet="Every decision deserves full attention. One flow whatever the number of suggestions: use one, or say none fit and then search or exclude. Deciding moves you to the next student, and says so. Keyboard: j/k to move, u to undo."
      />
      <ReviewProgress />
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
            {groups.length - toReview.length} of {groups.length} decided
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
                      onClick={() => select(group.correlationId)}
                      gap="200"
                      paddingX="200"
                      paddingY="100"
                      borderRadius="4px"
                      bg={isSelected ? 'blue.500' : undefined}
                      _hover={{ bg: isSelected ? 'blue.500' : 'blue.600' }}
                      textAlign="left"
                    >
                      <Box width="1rem" color={status === 'reprocessed' ? 'green.100' : undefined}>
                        {statusGlyph[status]}
                      </Box>
                      <Box flex="1">{studentName(group.inputDetails)}</Box>
                      {status === 'ready' && decision?.kind === 'match' && (
                        <Box fontSize="0.75rem" opacity="0.8">
                          {decision.candidate.studentUniqueId}
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
        <VStack flex="1" minWidth="0" alignItems="stretch" gap="300">
          {transition && (
            <TransitionBanner
              transition={transition}
              onUndo={() => undoTransition(transition)}
              onBack={() => select(transition.correlationId)}
              onDismiss={() => setTransition(null)}
            />
          )}
          <Box layerStyle="contentBox" padding="400">
            <FocusPanel
              key={selected.correlationId}
              group={selected}
              place={
                position >= 0
                  ? `To review · ${position + 1} of ${toReview.length}`
                  : statusTitle(statusOf(selected.correlationId))
              }
              isNext={!!transition?.nextName}
              onDecided={onDecided}
            />
          </Box>
        </VStack>
      </HStack>
      <VStack alignItems="flex-start" width="100%" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet. Submitted decisions run as a batch, and batches can run side by side." />
      </VStack>
    </VStack>
  );
};

const statusTitle = (status: StudentStatus) =>
  sections.find((section) => section.status === status)?.title ?? '';

/**
 * Names what just happened and who's showing now, so moving on is never a
 * surprise, with a way straight back.
 */
const TransitionBanner = ({
  transition,
  onUndo,
  onBack,
  onDismiss,
}: {
  transition: Transition;
  onUndo: () => void;
  onBack: () => void;
  onDismiss: () => void;
}) => (
  <HStack
    role="status"
    padding="200"
    paddingLeft="300"
    borderRadius="6px"
    bg="blue.600"
    borderLeftWidth="3px"
    borderColor="green.100"
    justifyContent="space-between"
    gap="300"
    flexWrap="wrap"
  >
    <Box fontSize="0.9rem">
      <Box as="span" fontWeight="600">
        {transition.name}
      </Box>
      : {transition.outcome}.{' '}
      {transition.nextName
        ? `Now showing the next student to review, ${transition.nextName}.`
        : 'That was the last student to review; submit your matches when ready.'}
    </Box>
    <HStack gap="100">
      <QuietButton onClick={onUndo}>Undo</QuietButton>
      {transition.nextName && <QuietButton onClick={onBack}>Back to {transition.name}</QuietButton>}
      <QuietButton onClick={onDismiss} aria-label="Dismiss">
        ✕
      </QuietButton>
    </HStack>
  </HStack>
);

const SubmitConfirmation = ({
  ready,
  onCancel,
  onSubmit,
}: {
  ready: GetStudentInputDetailsDto[];
  onCancel: () => void;
  onSubmit: () => void;
}) => {
  return (
    <VStack alignItems="stretch" gap="200">
      <Box fontSize="0.9rem">
        {ready.length} {ready.length === 1 ? 'student' : 'students'} will be reprocessed with the
        match you chose. The run will report how many assessments loaded, but not whose.
      </Box>
      <PrimaryButton onClick={onSubmit}>Submit batch</PrimaryButton>
      <QuietButton onClick={onCancel}>Cancel</QuietButton>
    </VStack>
  );
};

/** The decision for one student: the same flow whatever the number of suggestions. */
const FocusPanel = ({
  group,
  place,
  isNext,
  onDecided,
}: {
  group: GetStudentInputDetailsDto;
  /** Where this student sits, e.g. "To review · 2 of 5". */
  place: string;
  /** Whether the panel just moved on to this student. */
  isNext: boolean;
  onDecided: (outcome: string, previous: Decision | undefined) => void;
}) => {
  const { statusOf, decisions, decide, undo } = useReviewSession();
  const status = statusOf(group.correlationId);
  const decision = decisions.get(group.correlationId);
  const candidates = suggestedCandidates(group);
  const [changing, setChanging] = useState(false);
  // Saying none fit stays on this student and opens the other options.
  const [noneFit, setNoneFit] = useState(false);

  const choose = (candidate: Candidate) => {
    const previous = decision;
    decide(group.correlationId, { kind: 'match', candidate });
    setChanging(false);
    onDecided(`matched to ${candidate.studentUniqueId}`, previous);
  };
  const exclude = () => {
    const previous = decision;
    decide(group.correlationId, { kind: 'not-in-roster' });
    setChanging(false);
    onDecided('excluded from this job', previous);
  };
  const canDecide = status === 'to-review' || changing;

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input')) return;
    if (event.key === 'u' && !canDecide && (status === 'ready' || status === 'excluded')) {
      undo(group.correlationId);
    }
  };

  return (
    <VStack alignItems="stretch" gap="400" width="100%" onKeyDown={onKeyDown}>
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          {isNext ? 'Next student · ' : ''}
          {place}
        </Box>
        <Box textStyle="h4">{studentName(group.inputDetails)}</Box>
        <FileLine details={group.inputDetails} withName={false} />
      </VStack>

      {status === 'reprocessing' && <Box>Submitted — reprocessing now. See the batch below.</Box>}
      {(status === 'ready' || status === 'excluded' || status === 'reprocessed') &&
        !changing &&
        decision && (
          <VStack alignItems="flex-start" gap="200">
            <Box>
              {decision.kind === 'match'
                ? status === 'reprocessed'
                  ? `Reprocessed with ${decision.candidate.studentUniqueId}. See the batch below for how its assessments loaded.`
                  : `You matched this student to ${decision.candidate.studentUniqueId}.`
                : "Excluded from this job. Their assessments won't be loaded."}
            </Box>
            <HStack gap="200">
              <SecondaryButton onClick={() => setChanging(true)}>Change</SecondaryButton>
              {(status === 'ready' || status === 'excluded') && (
                <QuietButton onClick={() => undo(group.correlationId)}>Undo (u)</QuietButton>
              )}
            </HStack>
          </VStack>
        )}

      {canDecide && candidates.length > 0 && !noneFit && (
        <VStack alignItems="stretch" gap="300">
          {/* The count matters when a suggestion is past the fold. */}
          <Box fontSize="0.85rem" opacity="0.8">
            {candidates.length} {candidates.length === 1 ? 'suggestion' : 'suggestions'}
          </Box>
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.studentUniqueId}
              candidate={candidate}
              group={group}
              action={
                <PrimaryButton onClick={() => choose(candidate)}>Use suggestion</PrimaryButton>
              }
            />
          ))}
          <HStack gap="300">
            <SecondaryButton onClick={() => setNoneFit(true)}>
              {candidates.length === 1 ? 'Not this student' : 'None of these'}
            </SecondaryButton>
            <Box fontSize="0.8rem" opacity="0.7">
              Then search the roster, or exclude the record.
            </Box>
          </HStack>
        </VStack>
      )}

      {canDecide && (candidates.length === 0 || noneFit) && (
        <NoSuggestionFits
          group={group}
          suggestionCount={candidates.length}
          onBack={noneFit ? () => setNoneFit(false) : undefined}
          onUse={choose}
          onExclude={exclude}
        />
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
          <Evidence comparison={comparison} score={candidate.score} />
          <ComparisonTable comparison={comparison} rosterHeading={candidate.studentUniqueId} />
        </VStack>
        {action}
      </HStack>
    </Box>
  );
};

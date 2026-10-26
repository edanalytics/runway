import { Box, HStack, Spinner, VStack } from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { KeyboardEvent, useState } from 'react';
import { CheckIcon } from '@chakra-ui/icons';
import { PrimaryButton, QuietButton, TooManyNote, USUAL_MAXIMUM } from './components';
import { statusLabel, useReviewSession } from './reviewSession';
import { Queue, useQueue } from './queue';
import { LastAction, LastActionBar, StudentPane } from './studentPane';
import { SubmissionList } from './submissions';
import { SubmitReview } from './submit';
import { ReviewStatusSummary } from './ReviewStatusSummary';

/*
 * The match review: one persistent queue and one focused student pane.
 * Suggestion count is a filter, not a workflow. Two destinations: save a
 * match, or exclude the record from this job (mostly for junk data);
 * rejecting the suggestions is neither. Submitting is a deliberate
 * checkpoint, and each submission's outcome stays with the submission.
 */

/**
 * The Unmatched Students tab: the summary on top counts the students and
 * shows submissions, and the list beside the student pane holds the students
 * and the submit button.
 */
export const MatchReview = () => {
  const { students, counts, overLimit, isLoading, isError, submitBlocked } = useReviewSession();
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // Set once the reviewer picks a student, so the prompt to submit gives way
  // to the student they asked for. Cleared when they save a decision.
  const [lookingBack, setLookingBack] = useState(false);
  // Show the introduction before starting and when Previous returns to it.
  const [showIntro, setShowIntro] = useState(true);
  const setSelectedId = (id: string | null) => {
    setShowIntro(false);
    setLookingBack(true);
    setSelectedIdState(id);
  };
  const [reviewing, setReviewing] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const list = useQueue(students);
  const { queue } = list;

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  // Past the review limit the API sends only the counts: that many students to
  // match means something is wrong with the file, not a queue to work through.
  if (overLimit) {
    return (
      <VStack alignItems="stretch" width="100%" gap="400">
        <ReviewSummary />
        <Box textStyle="body" layerStyle="contentBox" padding="400">
          {counts.total.toLocaleString()} students couldn't be matched, which is too many to review
          here. That usually means something is off with the file, such as the wrong ID column. Fix
          the file and upload it again.
        </Box>
      </VStack>
    );
  }
  if (!students.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected =
    students.find((student) => student.correlationId === selectedId) ?? queue[0] ?? students[0];
  const ready = students.filter((student) => student.status === 'ready');
  const toReview = students.filter((student) => student.status === 'to-review');
  // Completed reviews skip the intro on load, but Previous can still reopen it.
  const atStart = showIntro && (toReview.length > 0 || selectedId !== null);
  // Every student has a decision, but saved matches haven't been submitted.
  const awaitingSubmit = ready.length > 0 && !toReview.length;
  // Then the pane says so rather than showing a student, until one is picked.
  const atSubmitPrompt = awaitingSubmit && !lookingBack;
  // The student the list marks as open; none when the pane isn't showing one.
  const shownId = atStart || atSubmitPrompt ? null : selected.correlationId;
  const submitPrompt = (
    <SubmitPrompt
      readyCount={ready.length}
      excludedCount={students.filter((student) => student.status === 'excluded').length}
    />
  );

  const advance = (from: string) => {
    const index = queue.findIndex((student) => student.correlationId === from);
    const after = [...queue.slice(index + 1), ...queue.slice(0, Math.max(index, 0))];
    const next = after.find((student) => student.status === 'to-review');
    if (next) setSelectedId(next.correlationId);
  };
  const move = (step: number) => {
    if (!queue.length) return;
    const index = queue.findIndex((student) => student.correlationId === selected.correlationId);
    if (step < 0 && index === 0) {
      setShowIntro(true);
      return;
    }
    setSelectedId(queue[(index + step + queue.length) % queue.length].correlationId);
  };
  const position = queue.findIndex((student) => student.correlationId === selected.correlationId);

  // The review pane: one student at a time, or the start screen or the
  // prompt to submit in its place.
  const pane = (
    <Box
      flex="1"
      minWidth="0"
      layerStyle="contentBox"
      padding="400"
      tabIndex={-1}
      outline="none"
      onKeyDown={(event: KeyboardEvent) => {
        if (atStart || atSubmitPrompt) return;
        if ((event.target as HTMLElement).closest('input, textarea')) return;
        if (event.key === 'j') move(1);
        if (event.key === 'k') move(-1);
      }}
    >
      {atStart ? (
        <StartScreen
          toReview={toReview.length}
          total={students.length}
          first={queue.find((student) => student.status === 'to-review') ?? toReview[0] ?? selected}
          onStart={(id) => setSelectedId(id)}
        />
      ) : (
        <>
          {!atSubmitPrompt && (
            <HStack
              justifyContent="space-between"
              marginBottom="300"
              fontSize="0.85rem"
              gap="200"
              flexWrap="wrap"
            >
              <Box opacity="0.8">
                {position >= 0 ? `${position + 1} of ${queue.length}` : 'Not in the current list'}
              </Box>
              <HStack gap="100">
                <QuietButton size="xs" isDisabled={!queue.length} onClick={() => move(-1)}>
                  ‹ Previous
                </QuietButton>
                <QuietButton size="xs" isDisabled={queue.length < 2} onClick={() => move(1)}>
                  Next ›
                </QuietButton>
              </HStack>
            </HStack>
          )}
          {lastAction && (
            <LastActionBar action={lastAction} onDismiss={() => setLastAction(null)} />
          )}
          {atSubmitPrompt ? (
            submitPrompt
          ) : (
            <StudentPane
              key={selected.correlationId}
              student={selected}
              onSaved={(action) => {
                // Undo goes back to the student it undoes, even past the
                // prompt to submit.
                const id = selected.correlationId;
                setLastAction({
                  ...action,
                  undo: () => {
                    setSelectedId(id);
                    return action.undo();
                  },
                });
                if (action.advance) advance(selected.correlationId);
                // A decision brings back the prompt to submit, if it was the last one.
                setLookingBack(false);
              }}
            />
          )}
        </>
      )}
    </Box>
  );

  return (
    <VStack alignItems="stretch" width="100%" gap="400">
      {/* The list holds the students and the one submit button; the summary
          only counts them, and shows submissions. */}
      <ReviewSummary />

      <HStack alignItems="flex-start" gap="400" width="100%">
        <Queue
          list={list}
          total={students.length}
          ready={ready}
          shownId={shownId}
          submitBlocked={submitBlocked}
          onSelect={setSelectedId}
          onReview={() => setReviewing(true)}
        />
        {pane}
      </HStack>

      <SubmitReview
        isOpen={reviewing}
        ready={ready}
        onClose={() => setReviewing(false)}
        onView={(id) => {
          setReviewing(false);
          setSelectedId(id);
        }}
      />
    </VStack>
  );
};

/**
 * Shown before reviewing and when Previous returns from the first student.
 */
const StartScreen = ({
  toReview,
  total,
  first,
  onStart,
}: {
  toReview: number;
  total: number;
  first: GetStudentInputDetailsDto;
  onStart: (id: string) => void;
}) => (
  <VStack alignItems="flex-start" gap="300" paddingY="500" paddingX="300" maxWidth="36rem">
    <Box textStyle="h3">
      {toReview === 0
        ? 'Review student matches'
        : toReview === total
        ? `${total} ${total === 1 ? 'student needs' : 'students need'} a match`
        : `${toReview} of ${total} students still need a match`}
    </Box>
    <Box opacity="0.9">
      These records couldn't be matched to a student in your roster automatically. For each one,
      compare the file's details with the suggested students and use the right one, search the
      roster, or exclude the record. Nothing loads until you submit your matches.
    </Box>
    <PrimaryButton onClick={() => onStart(first.correlationId)}>Start reviewing</PrimaryButton>
    <Box fontSize="0.85rem" opacity="0.75">
      This opens the first student under {statusLabel[first.status]}. You can also pick any student
      there.
    </Box>
  </VStack>
);

/**
 * Shown in place of a student once every student has a decision but saved
 * matches are waiting. It points at the page's one submit button rather
 * than adding another.
 */
const SubmitPrompt = ({
  readyCount,
  excludedCount,
}: {
  readyCount: number;
  excludedCount: number;
}) => (
  <HStack alignItems="flex-start" gap="300" paddingY="400" role="status">
    <CheckIcon color="green.100" boxSize="1.1rem" marginTop="0.3rem" />
    <VStack alignItems="flex-start" gap="100">
      <Box textStyle="h4">Every student has a decision</Box>
      <Box>
        {readyCount} {readyCount === 1 ? 'match is' : 'matches are'} ready to submit
        {excludedCount > 0 &&
          `, and ${excludedCount} ${excludedCount === 1 ? 'record is' : 'records are'} excluded`}
        . Check them and submit from {statusLabel.ready}, in the list.
      </Box>
      <Box fontSize="0.85rem" opacity="0.75">
        To look at a student again, pick them from the list.
      </Box>
    </VStack>
  </HStack>
);

/** Progress that says what's left to do, with identity and processing kept apart. */
const ReviewSummary = () => {
  const { counts, overLimit, sendRuns } = useReviewSession();
  // Past the review limit, the page says so in place of the list.
  const tooMany = !overLimit && counts.total > USUAL_MAXIMUM;

  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      {tooMany && <TooManyNote count={counts.total} />}
      <ReviewStatusSummary />
      {sendRuns.length > 0 && (
        <Box paddingTop="200" borderTopWidth="1px" borderColor="blue.50-40">
          <SubmissionList />
        </Box>
      )}
    </VStack>
  );
};

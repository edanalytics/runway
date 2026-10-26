import {
  Box,
  Button,
  HStack,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItemOption,
  MenuList,
  MenuOptionGroup,
  Progress,
  Spinner,
  VStack,
} from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { KeyboardEvent, useState } from 'react';
import { CheckIcon } from '@chakra-ui/icons';
import { PrimaryButton, QuietButton, suggestionsOf } from './components';
import { countOf, statusLabel, useReviewSession } from './reviewSession';
import {
  Sort,
  sorts,
  sortBy,
  QueueRow,
  searchText,
  countFilters,
  SortKey,
  scrollEdges,
  sectionIndex,
  sections,
  CountFilter,
} from './queue';
import { LastAction, LastActionBar, Workspace } from './studentPane';
import { SubmissionList } from './submissions';
import { SubmitReview } from './submit';

/*
 * The match review: one persistent queue and one focused workspace.
 * Suggestion count is a filter, not a workflow. Two destinations: save a
 * match, or exclude the record from this job (mostly for junk data);
 * rejecting the suggestions is neither. Submitting is a deliberate
 * checkpoint, and each submission's outcome stays with the submission.
 */

// The workspace ---------------------------------------------------------------

/**
 * The list beside the workspace, grouped by status: the side list holds the
 * students and the submit button, and the top counts them and shows submissions.
 */
export const WorkspaceReview = () => {
  const { students, counts, overLimit, isLoading, isError, statusOf, decisions, submitBlocked } =
    useReviewSession();
  // null means that filter is off.
  const [countFilter, setCountFilter] = useState<CountFilter | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  // Set once the reviewer picks a student, so the prompt to submit gives way
  // to the student they asked for. Cleared when they save a decision.
  const [lookingBack, setLookingBack] = useState(false);
  // No student is shown until the reviewer starts, from the start screen or
  // by picking one.
  const [started, setStarted] = useState(false);
  const setSelectedId = (id: string | null) => {
    setStarted(true);
    setLookingBack(true);
    setSelectedIdState(id);
  };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'name', descending: false });
  const [reviewing, setReviewing] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [openFinished, setOpenFinished] = useState<Set<string>>(() => new Set());
  const toggleFinished = (title: string) =>
    setOpenFinished((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });

  const countTest = countFilters.find((f) => f.key === countFilter)?.test ?? (() => true);
  const terms = query.trim().toLowerCase();
  const queue = students
    .filter(
      (student) =>
        countTest(suggestionsOf(student).length) && (!terms || searchText(student).includes(terms))
    )
    .sort(sortBy(sort))
    // The list reads section by section, so previous and next do too.
    .sort(
      (a, b) => sectionIndex(statusOf(a.correlationId)) - sectionIndex(statusOf(b.correlationId))
    );
  const filtered = countFilter !== null || !!terms;
  const clearFilters = () => {
    setCountFilter(null);
    setQuery('');
  };

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  // Past the review limit the API sends only the counts: that many students to
  // match means something is wrong with the file, not a queue to work through.
  if (overLimit) {
    return (
      <VStack alignItems="stretch" width="100%" gap="400">
        <Overview />
        <Box textStyle="body" layerStyle="contentBox" padding="400">
          {counts.total.toLocaleString()} students couldn't be matched, which is too many to review
          here. That usually means something is off with the file, such as the wrong ID column.
          Check the file and reprocess it.
        </Box>
      </VStack>
    );
  }
  if (!students.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected =
    students.find((student) => student.correlationId === selectedId) ?? queue[0] ?? students[0];
  const ready = students.filter((student) => statusOf(student.correlationId) === 'ready');
  const toReview = students.filter((student) => statusOf(student.correlationId) === 'to-review');
  const atStart = !started && toReview.length > 0;
  // Every student has a decision, but saved matches haven't been submitted.
  const awaitingSubmit = ready.length > 0 && !toReview.length;
  // Then the pane says so rather than showing a student, until one is picked.
  const atSubmitPrompt = awaitingSubmit && !lookingBack;
  // The student the list marks as open; none when the pane isn't showing one.
  const shownId = atStart || atSubmitPrompt ? null : selected.correlationId;
  const submitPrompt = (
    <SubmitPrompt
      readyCount={ready.length}
      excludedCount={
        students.filter((student) => statusOf(student.correlationId) === 'excluded').length
      }
    />
  );

  const advance = (from: string) => {
    const index = queue.findIndex((student) => student.correlationId === from);
    const after = [...queue.slice(index + 1), ...queue.slice(0, Math.max(index, 0))];
    const next = after.find((student) => statusOf(student.correlationId) === 'to-review');
    if (next) setSelectedId(next.correlationId);
  };
  const move = (step: number) => {
    if (!queue.length) return;
    const index = queue.findIndex((student) => student.correlationId === selected.correlationId);
    setSelectedId(queue[(index + step + queue.length) % queue.length].correlationId);
  };
  const position = queue.findIndex((student) => student.correlationId === selected.correlationId);

  const searchBox = (
    <Input
      id="workspace-queue-search"
      size="sm"
      placeholder="Search"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      aria-label="Search the list"
    />
  );
  // The side list's sort and filters, folded into one menu. The button counts
  // what's changed from the default, so a narrowed list is never a mystery.
  const changedOptions = [countFilter !== null, sort.key !== 'name'].filter(Boolean).length;
  const optionStyle = { bg: 'blue.700', _hover: { bg: 'blue.600' }, _focus: { bg: 'blue.600' } };
  const listOptions = (
    <Menu closeOnSelect={false} placement="bottom-end">
      <MenuButton
        as={Button}
        size="sm"
        variant="outline"
        flexShrink={0}
        fontWeight="400"
        color="blue.50"
        borderColor={changedOptions ? 'blue.50' : 'blue.50-40'}
        bg={changedOptions ? 'blue.600' : undefined}
        _hover={{ bg: 'blue.600' }}
        _active={{ bg: 'blue.600' }}
      >
        Sort & filter{changedOptions ? ` · ${changedOptions}` : ''}
      </MenuButton>
      <MenuList
        bg="blue.700"
        borderColor="blue.50-40"
        color="blue.50"
        fontSize="0.85rem"
        zIndex={2}
      >
        <MenuOptionGroup
          title="Sort"
          type="radio"
          value={sort.key}
          onChange={(key) =>
            setSort({
              key: key as SortKey,
              descending: sorts.find((s) => s.key === key)?.descending ?? false,
            })
          }
        >
          {sorts.map((s) => (
            <MenuItemOption key={s.key} value={s.key} {...optionStyle}>
              {s.label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
        <MenuDivider borderColor="blue.50-40" />
        <MenuOptionGroup
          title="Suggestions"
          type="radio"
          value={countFilter ?? 'any'}
          onChange={(key) => setCountFilter(key === 'any' ? null : (key as CountFilter))}
        >
          <MenuItemOption value="any" {...optionStyle}>
            Any number
          </MenuItemOption>
          {countFilters.map(({ key, label }) => (
            <MenuItemOption key={key} value={key} {...optionStyle}>
              {label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
      </MenuList>
    </Menu>
  );
  const countLine = (
    <HStack fontSize="0.8rem" gap="200" minHeight="1.5rem">
      <Box opacity="0.8" whiteSpace="nowrap">
        {queue.length} of {students.length} students
      </Box>
      {filtered && (
        <QuietButton size="xs" onClick={clearFilters}>
          Clear filters
        </QuietButton>
      )}
    </HStack>
  );
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
        if ((event.target as HTMLElement).closest('input, textarea')) return;
        if (event.key === 'j') move(1);
        if (event.key === 'k') move(-1);
      }}
    >
      {atStart ? (
        <StartScreen
          toReview={toReview.length}
          total={students.length}
          first={
            queue.find((student) => statusOf(student.correlationId) === 'to-review') ?? toReview[0]
          }
          onStart={(id) => setSelectedId(id)}
        />
      ) : (
        <>
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
              <QuietButton size="xs" isDisabled={queue.length < 2} onClick={() => move(-1)}>
                ‹ Previous
              </QuietButton>
              <QuietButton size="xs" isDisabled={queue.length < 2} onClick={() => move(1)}>
                Next ›
              </QuietButton>
            </HStack>
          </HStack>
          {lastAction && (
            <LastActionBar action={lastAction} onDismiss={() => setLastAction(null)} />
          )}
          {atSubmitPrompt ? (
            submitPrompt
          ) : (
            <Workspace
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
      <Overview />

      <HStack alignItems="flex-start" gap="400" width="100%">
        <VStack
          width="20rem"
          flexShrink={0}
          alignItems="stretch"
          layerStyle="contentBox"
          padding="300"
          gap="300"
          position="sticky"
          top="0"
          maxHeight="100vh"
        >
          {/* One row of controls, so the list's groups lead. The count
                line shows only while something is filtered out. */}
          <HStack gap="200">
            <Box flex="1" minWidth="0">
              {searchBox}
            </Box>
            {listOptions}
          </HStack>
          {filtered && countLine}
          <VStack
            alignItems="stretch"
            gap="0"
            flex="1"
            minHeight="0"
            overflowY="auto"
            marginX="-200"
          >
            {queue.length === 0 && (
              <Box padding="200" opacity="0.8" fontSize="0.9rem">
                Nothing matches.{' '}
                <QuietButton size="xs" onClick={clearFilters}>
                  Clear filters
                </QuietButton>
              </Box>
            )}
            {sections.map(({ status, finished }) => {
              const title = statusLabel[status];
              const members = queue.filter((student) => statusOf(student.correlationId) === status);
              // A folded group opens while its student is the one shown,
              // e.g. after stepping to it with previous and next.
              const holdsSelected = members.some((student) => student.correlationId === shownId);
              const isOpen = !finished || openFinished.has(title) || holdsSelected;
              // Saved matches and the button that submits them sit
              // together, in one place, even when empty.
              const isReadyBox = status === 'ready';
              if (!members.length && !isReadyBox) return null;
              const list = (
                <VStack
                  key={title}
                  alignItems="stretch"
                  gap="0"
                  marginBottom={isReadyBox ? '0' : '200'}
                >
                  {!finished && (
                    <Box
                      fontSize="0.8rem"
                      fontWeight="600"
                      opacity="0.8"
                      paddingX="200"
                      paddingY="100"
                    >
                      {title} ({members.length})
                    </Box>
                  )}
                  {finished && (
                    <HStack
                      as="button"
                      onClick={holdsSelected ? undefined : () => toggleFinished(title)}
                      aria-expanded={isOpen}
                      gap="100"
                      fontSize="0.8rem"
                      fontWeight="600"
                      opacity="0.8"
                      paddingX="200"
                      paddingY="100"
                      textAlign="left"
                      _hover={{ opacity: 1 }}
                    >
                      <Box width="0.8rem">{isOpen ? '▾' : '▸'}</Box>
                      <Box>
                        {title} ({members.length})
                      </Box>
                    </HStack>
                  )}
                  {isOpen && (
                    // A long group scrolls within its own height (about
                    // ten students), so the groups below stay in view.
                    <VStack
                      alignItems="stretch"
                      gap="0"
                      maxHeight="32rem"
                      overflowY="auto"
                      {...(members.length > 10 ? scrollEdges : {})}
                    >
                      {members.map((student) => (
                        <QueueRow
                          key={student.correlationId}
                          student={student}
                          decision={decisions.get(student.correlationId)}
                          status={statusOf(student.correlationId)}
                          isSelected={student.correlationId === shownId}
                          onSelect={() => setSelectedId(student.correlationId)}
                        />
                      ))}
                    </VStack>
                  )}
                </VStack>
              );
              if (!isReadyBox) return list;
              return (
                <VStack
                  key={title}
                  alignItems="stretch"
                  gap="200"
                  padding="200"
                  marginX="100"
                  marginBottom="200"
                  borderRadius="6px"
                  borderWidth="1px"
                  borderColor="blue.50-40"
                >
                  {list}
                  {!members.length && (
                    <Box fontSize="0.8rem" opacity="0.7" paddingX="200">
                      Students you match land here until you submit them.
                    </Box>
                  )}
                  <PrimaryButton
                    width="100%"
                    isDisabled={!ready.length || !!submitBlocked}
                    onClick={() => setReviewing(true)}
                  >
                    Review and submit {ready.length || ''}{' '}
                    {ready.length === 1 ? 'match' : 'matches'}
                  </PrimaryButton>
                  {submitBlocked && (
                    <Box fontSize="0.8rem" opacity="0.8" paddingX="200">
                      {submitBlocked}
                    </Box>
                  )}
                </VStack>
              );
            })}
          </VStack>
        </VStack>
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
 * Review is done when every student is excluded or has been reprocessed
 * with their match: nothing left to review, submit, run or retry. Done can
 * include delivery errors, as a job can complete with errors today.
 */
const useReviewDone = () => {
  const { counts } = useReviewSession();
  return counts.total > 0 && counts.reprocessed + counts.excluded === counts.total;
};

const ReviewComplete = () => (
  <HStack gap="100" role="status" whiteSpace="nowrap">
    <CheckIcon color="green.100" boxSize="0.8rem" />
    <Box>Review complete</Box>
  </HStack>
);

/**
 * Progress toward review done: students decided, whether or not submitted.
 * A run-failed student is decided: what's left is sending them again.
 */
const ReviewProgress = () => {
  const { counts } = useReviewSession();
  const done = useReviewDone();
  const decided = counts.total - counts.toReview;
  return (
    <HStack gap="300" fontSize="0.8rem">
      <Progress
        flex="1"
        value={counts.total ? (decided / counts.total) * 100 : 0}
        size="xs"
        borderRadius="999px"
        bg="blue.600"
        sx={{ '& > div': { bg: 'green.100' } }}
        aria-label="Students decided"
      />
      {done ? (
        <ReviewComplete />
      ) : (
        <Box opacity="0.8" whiteSpace="nowrap">
          {decided} of {counts.total} decided
        </Box>
      )}
    </HStack>
  );
};

/**
 * Shown in place of a student when the page opens
 * with students to review, so the first thing it says is where to begin.
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
      {toReview === total
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
      This opens the first student under {statusLabel['to-review']}. You can also pick any student
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
const Overview = () => {
  const { counts, overLimit, sendRuns } = useReviewSession();
  // Past the review limit, the page says so in place of the list.
  const tooMany = !overLimit && counts.total > USUAL_MAXIMUM;
  // A count per status, in the list's order.
  const tiles = sections.map(({ status }) => ({
    label: statusLabel[status],
    value: countOf(counts, status),
  }));

  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      {tooMany && <TooManyNote count={counts.total} />}
      <HStack gap="500" flexWrap="wrap">
        {tiles.map((tile) => (
          <VStack key={tile.label} alignItems="flex-start" gap="0">
            <Box fontSize="1.3rem" fontWeight="600" lineHeight="1.2">
              {tile.value}
            </Box>
            <Box fontSize="0.8rem" opacity="0.8">
              {tile.label}
            </Box>
          </VStack>
        ))}
      </HStack>
      <ReviewProgress />
      {sendRuns.length > 0 && (
        <Box paddingTop="200" borderTopWidth="1px" borderColor="blue.50-40">
          <SubmissionList />
        </Box>
      )}
    </VStack>
  );
};

/**
 * A file usually has no more than 15-20 students to match. Many more points
 * at a problem with the file itself, better fixed there than one by one.
 */
export const USUAL_MAXIMUM = 20;

const TooManyNote = ({ count }: { count: number }) => (
  <Box
    padding="300"
    borderRadius="6px"
    borderWidth="1px"
    borderColor="purple.200"
    fontSize="0.9rem"
    role="note"
  >
    <Box fontWeight="600">{count} students couldn't be matched, more than a file usually has</Box>
    <Box opacity="0.9">
      That often means a problem with the file itself, such as the wrong ID column or school year.
      It may be quicker to fix and upload the file again than to review each student.
    </Box>
  </Box>
);

import {
  Box,
  Button,
  Checkbox,
  HStack,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItemOption,
  MenuList,
  MenuOptionGroup,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  SimpleGrid,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import {
  GetStudentInputDetailsDto,
  JsonValue,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '@chakra-ui/icons';
import { Agreement, compare } from './compare';
import {
  AgreementMark,
  BatchCard,
  PrimaryButton,
  NoSuggestionFits,
  SearchField,
  QuietButton,
  SecondaryButton,
  studentName,
} from './components';
import { termsFrom, SearchTerms } from './search';
import {
  Batch,
  Candidate,
  Decision,
  isFinished,
  StudentStatus,
  useReviewSession,
} from './reviewSession';

/*
 * The match review: one persistent queue and one focused workspace.
 * Suggestion count is a filter, not a workflow. Two destinations: save a
 * match, or exclude the record from this job (mostly for junk data);
 * rejecting the suggestions is neither. Submitting is a deliberate
 * checkpoint, and batch outcomes stay with the batch.
 */

// Queue ----------------------------------------------------------------------

type CountFilter = 'none' | 'one' | 'several';

const countFilters: { key: CountFilter; label: string; test: (n: number) => boolean }[] = [
  { key: 'none', label: 'No suggestions', test: (n) => n === 0 },
  { key: 'one', label: 'One', test: (n) => n === 1 },
  { key: 'several', label: 'Several', test: (n) => n > 1 },
];

type SortKey = 'file' | 'name' | 'birth' | 'score';
type Sort = { key: SortKey; descending: boolean };

/** Each sort's natural first direction: best scores first. */
const sorts: { key: SortKey; label: string; descending: boolean }[] = [
  { key: 'file', label: 'File order', descending: false },
  { key: 'name', label: 'Last name', descending: false },
  { key: 'birth', label: 'Date of birth', descending: false },
  { key: 'score', label: 'Top match score', descending: true },
];

const lastNameOf = (group: GetStudentInputDetailsDto) =>
  `${valueText(group.inputDetails.last_name) ?? ''} ${
    valueText(group.inputDetails.first_name) ?? ''
  }`.toLowerCase();

const topScore = (group: GetStudentInputDetailsDto) =>
  Math.max(-1, ...suggestionsOf(group).map((c) => c.score ?? -1));

/** The list's groups, in the order work moves through them. */
const sections: { title: string; statuses: StudentStatus[]; finished?: boolean }[] = [
  { title: 'To review', statuses: ['to-review'] },
  { title: 'Run failed', statuses: ['run-failed'] },
  { title: 'Ready to submit', statuses: ['ready'] },
  { title: 'Reprocessing', statuses: ['reprocessing'] },
  // Finished work starts collapsed, out of the way of what's left to do.
  { title: 'Reprocessed', statuses: ['reprocessed'], finished: true },
  { title: 'Excluded', statuses: ['excluded'], finished: true },
];

/**
 * For a group that scrolls: a faint, flat glow (blue.50) inside each edge
 * with more beyond it, and a rule beneath, so the group ends visibly before
 * the next one starts.
 * The covers scroll with the content and hide each glow at its end.
 */
const scrollEdges = {
  borderBottomWidth: '1px',
  borderColor: 'blue.50-40',
  background: `
    linear-gradient(var(--chakra-colors-blue-700) 30%, transparent) top,
    linear-gradient(transparent, var(--chakra-colors-blue-700) 70%) bottom,
    linear-gradient(rgba(236, 251, 255, 0.18), transparent) top,
    linear-gradient(transparent, rgba(236, 251, 255, 0.18)) bottom`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 2rem, 100% 2rem, 100% 0.25rem, 100% 0.25rem',
  backgroundAttachment: 'local, local, scroll, scroll',
};

const sectionIndex = (status: StudentStatus) =>
  sections.findIndex((section) => section.statuses.includes(status));

const sortBy =
  ({ key, descending }: Sort) =>
  (a: GetStudentInputDetailsDto, b: GetStudentInputDetailsDto) => {
    const text = (v: JsonValue | undefined) => valueText(v) ?? '';
    const order =
      key === 'name'
        ? lastNameOf(a).localeCompare(lastNameOf(b))
        : key === 'birth'
        ? text(a.inputDetails.birth_date).localeCompare(text(b.inputDetails.birth_date))
        : key === 'score'
        ? topScore(a) - topScore(b)
        : 0;
    return descending ? -order : order;
  };

// Evidence -------------------------------------------------------------------

/** The latest search IDRS ran for this student; earlier ones are history. */
const latestResult = (group: GetStudentInputDetailsDto) =>
  [...group.results].sort((a, b) => +new Date(b.createdOn) - +new Date(a.createdOn))[0];

const suggestionsOf = (group: GetStudentInputDetailsDto): Candidate[] => {
  const latest = latestResult(group);
  return (latest?.suggestions ?? [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      studentUniqueId: s.studentUniqueId,
      rosterDetails: s.rosterDetails,
      score: s.score,
      source: 'suggestion' as const,
      // A match to a suggestion names it by its result and position.
      resultId: latest.id,
      ordinal: s.ordinal,
    }));
};

const valueText = (value: JsonValue | undefined): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value
      .map((v) =>
        v && typeof v === 'object' && !Array.isArray(v) && 'id_value' in v
          ? [v.id_type, v.id_value].filter(Boolean).join(' ')
          : valueText(v)
      )
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

/** What the list's search box matches against: name, birth date and IDs. */
const searchText = (group: GetStudentInputDetailsDto) =>
  [studentName(group.inputDetails), secondId(group)].join(' ').toLowerCase();

/** A second identifier beside the name, so similarly named records stay distinguishable. */
const secondId = (group: GetStudentInputDetailsDto) => {
  const d = group.inputDetails;
  return [
    valueText(d.birth_date) && `b. ${valueText(d.birth_date)}`,
    valueText(d.student_ids) && `ID ${valueText(d.student_ids)}`,
  ]
    .filter(Boolean)
    .join(' · ');
};

const realDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Missing or invalid values in the file: clues, not a diagnosis of IDRS. */
const fileIssues = (group: GetStudentInputDetailsDto) => {
  const d = group.inputDetails;
  const issues: string[] = [];
  if (!valueText(d.first_name)) issues.push('No first name in your file.');
  if (!valueText(d.last_name)) issues.push('No last name in your file.');
  if (!valueText(d.birth_date)) issues.push('No date of birth in your file.');
  else if (typeof d.birth_date === 'string' && !realDate(d.birth_date))
    issues.push(`Date of birth ${d.birth_date} isn't a valid date.`);
  return issues;
};

const copy = (value: string) => {
  navigator.clipboard?.writeText(value).catch(() => undefined);
};

const CopyButton = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <QuietButton
      size="xs"
      paddingX="100"
      minWidth="0"
      onClick={() => {
        copy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={copied ? 'Copied' : `Copy ${value}`}
      title={copied ? 'Copied' : `Copy ${value}`}
      leftIcon={label ? copied ? <CheckIcon /> : <CopyIcon /> : undefined}
    >
      {label ?? (copied ? <CheckIcon /> : <CopyIcon />)}
    </QuietButton>
  );
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// The workspace ---------------------------------------------------------------

/**
 * The list beside the workspace, grouped by status: the side list holds the
 * students and the submit button, and the top counts them and shows batches.
 */
export const WorkspaceReview = () => {
  const { groups, overLimit, isLoading, isError, statusOf, decisions } = useReviewSession();
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
  const [sort, setSort] = useState<Sort>({ key: 'file', descending: false });
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
  const queue = groups
    .filter((g) => countTest(suggestionsOf(g).length) && (!terms || searchText(g).includes(terms)))
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
  // Past the review limit the API sends only the count: that many students to
  // match means something is wrong with the file, not a queue to work through.
  if (overLimit && !groups.length) {
    return (
      <Box textStyle="body" layerStyle="contentBox" padding="400">
        {overLimit.toLocaleString()} students couldn't be matched, which is too many to review here.
        That usually means something is off with the file, such as the wrong ID column. Check the
        file and reprocess it.
      </Box>
    );
  }
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected = groups.find((g) => g.correlationId === selectedId) ?? queue[0] ?? groups[0];
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');
  const toReview = groups.filter((g) => statusOf(g.correlationId) === 'to-review');
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
      excludedCount={groups.filter((g) => statusOf(g.correlationId) === 'excluded').length}
    />
  );

  const advance = (from: string) => {
    const index = queue.findIndex((g) => g.correlationId === from);
    const after = [...queue.slice(index + 1), ...queue.slice(0, Math.max(index, 0))];
    const next = after.find((g) => statusOf(g.correlationId) === 'to-review');
    if (next) setSelectedId(next.correlationId);
  };
  const move = (step: number) => {
    if (!queue.length) return;
    const index = queue.findIndex((g) => g.correlationId === selected.correlationId);
    setSelectedId(queue[(index + step + queue.length) % queue.length].correlationId);
  };
  const position = queue.findIndex((g) => g.correlationId === selected.correlationId);

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
  const changedOptions = [countFilter !== null, sort.key !== 'file'].filter(Boolean).length;
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
        {queue.length} of {groups.length} students
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
          total={groups.length}
          first={queue.find((g) => statusOf(g.correlationId) === 'to-review') ?? toReview[0]}
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
              group={selected}
              onSaved={(action) => {
                // Undo goes back to the student it undoes, even past the
                // prompt to submit.
                const id = selected.correlationId;
                setLastAction({
                  ...action,
                  undo: () => {
                    action.undo();
                    setSelectedId(id);
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
          only counts them, and shows submitted batches. */}
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
            {sections.map(({ title, statuses, finished }) => {
              const members = queue.filter((g) => statuses.includes(statusOf(g.correlationId)));
              // A folded group opens while its student is the one shown,
              // e.g. after stepping to it with previous and next.
              const holdsSelected = members.some((g) => g.correlationId === shownId);
              const isOpen = !finished || openFinished.has(title) || holdsSelected;
              // Saved matches and the button that submits them sit
              // together, in one place, even when empty.
              const isReadyBox = statuses.includes('ready');
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
                      {members.map((group) => (
                        <QueueRow
                          key={group.correlationId}
                          group={group}
                          decision={decisions.get(group.correlationId)}
                          status={statusOf(group.correlationId)}
                          isSelected={group.correlationId === shownId}
                          onSelect={() => setSelectedId(group.correlationId)}
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
                    isDisabled={!ready.length}
                    onClick={() => setReviewing(true)}
                  >
                    Review and submit {ready.length || ''}{' '}
                    {ready.length === 1 ? 'match' : 'matches'}
                  </PrimaryButton>
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
  const { groups, statusOf } = useReviewSession();
  return (
    groups.length > 0 &&
    groups.every((g) => ['reprocessed', 'excluded'].includes(statusOf(g.correlationId)))
  );
};

const ReviewComplete = () => (
  <HStack gap="100" role="status" whiteSpace="nowrap">
    <CheckIcon color="green.100" boxSize="0.8rem" />
    <Box>Review complete</Box>
  </HStack>
);

/** Progress toward review done: students decided, whether or not submitted. */
const ReviewProgress = () => {
  const { groups, statusOf } = useReviewSession();
  const done = useReviewDone();
  const decided = groups.filter(
    (g) => !['to-review', 'run-failed'].includes(statusOf(g.correlationId))
  ).length;
  return (
    <HStack gap="300" fontSize="0.8rem">
      <Progress
        flex="1"
        value={groups.length ? (decided / groups.length) * 100 : 0}
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
          {decided} of {groups.length} decided
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
      This opens the first student under To review. You can also pick any student there.
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
        . Check them and submit from Ready to submit, in the list.
      </Box>
      <Box fontSize="0.85rem" opacity="0.75">
        To look at a student again, pick them from the list.
      </Box>
    </VStack>
  </HStack>
);

/** Every batch, newest first, with a support path when one had trouble. */
const BatchList = () => {
  const { batches } = useReviewSession();
  return (
    <VStack alignItems="stretch" gap="100">
      {[...batches].reverse().map((batch) => (
        <BatchSummary key={batch.id} batch={batch} number={batches.indexOf(batch) + 1} />
      ))}
      {batches.some((b) => b.status === 'complete with errors' || b.status === 'failed') && (
        <SupportPath batches={batches} />
      )}
    </VStack>
  );
};

/** The summary's counts. */
const overviewTiles: { label: string; statuses: StudentStatus[] }[] = [
  { label: 'Needs review', statuses: ['to-review'] },
  { label: 'Matches to submit', statuses: ['ready'] },
  { label: 'Excluded', statuses: ['excluded'] },
  { label: 'Submitted', statuses: ['reprocessing', 'reprocessed', 'run-failed'] },
];

/** Progress that says what's left to do, with identity and processing kept apart. */
const Overview = () => {
  const { groups, statusOf, batches } = useReviewSession();
  const count = (...statuses: StudentStatus[]) =>
    groups.filter((g) => statuses.includes(statusOf(g.correlationId))).length;
  const tooMany = groups.length > USUAL_MAXIMUM;
  const tiles = overviewTiles.map((tile) => ({ ...tile, value: count(...tile.statuses) }));

  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      {tooMany && <TooManyNote count={groups.length} />}
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
      {batches.length > 0 && (
        <Box paddingTop="200" borderTopWidth="1px" borderColor="blue.50-40">
          <BatchList />
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

export const TooManyNote = ({ count }: { count: number }) => (
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

/** One line per batch; expands to its counts and students. */
const BatchSummary = ({ batch, number }: { batch: Batch; number: number }) => {
  const [open, setOpen] = useState(false);
  const troubled = batch.status === 'complete with errors' || batch.status === 'failed';
  return (
    <VStack alignItems="stretch" gap="100">
      <HStack
        as="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        gap="300"
        paddingX="200"
        paddingY="100"
        borderRadius="4px"
        _hover={{ bg: 'blue.600' }}
        fontSize="0.9rem"
        textAlign="left"
      >
        <Box width="1rem" opacity="0.8">
          {open ? '▾' : '▸'}
        </Box>
        <BatchIcon status={batch.status} />
        <Box fontWeight="600">Batch {number}</Box>
        <Box opacity="0.85">
          {batch.items.length} {batch.items.length === 1 ? 'student' : 'students'} · submitted{' '}
          {time(batch.submittedAt)}
        </Box>
        <Box flex="1" />
        <Box color={troubled ? 'pink.100' : undefined}>
          {isFinished(batch) ? batchStatusLabel[batch.status] : 'Running'}
        </Box>
      </HStack>
      {open && <BatchCard batch={batch} />}
    </VStack>
  );
};

/** Complete, complete with errors, failed, or still running, at a glance. */
const BatchIcon = ({ status }: { status: Batch['status'] }) => {
  if (status === 'queued' || status === 'processing') {
    return <Spinner size="xs" color="blue.50" aria-label="Running" />;
  }
  const icon = {
    complete: { glyph: '✓', color: 'green.100', label: 'Complete' },
    'complete with errors': { glyph: '⚠', color: 'pink.100', label: 'Complete with errors' },
    failed: { glyph: '✕', color: 'pink.100', label: 'Run failed' },
  }[status];
  return (
    <Box
      as="span"
      role="img"
      aria-label={icon.label}
      title={icon.label}
      color={icon.color}
      fontWeight="700"
      width="1rem"
      textAlign="center"
    >
      {icon.glyph}
    </Box>
  );
};

const batchStatusLabel: Record<Batch['status'], string> = {
  queued: 'Queued',
  processing: 'Running',
  complete: 'Complete',
  'complete with errors': 'Complete with errors',
  failed: 'Run failed',
};

const QueueRow = ({
  group,
  decision,
  status,
  isSelected,
  onSelect,
}: {
  group: GetStudentInputDetailsDto;
  decision: Decision | undefined;
  status: StudentStatus;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const count = suggestionsOf(group).length;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);
  return (
    <VStack
      as="button"
      ref={ref}
      onClick={onSelect}
      alignItems="stretch"
      gap="0"
      paddingX="200"
      paddingY="100"
      borderRadius="4px"
      bg={isSelected ? 'blue.500' : undefined}
      _hover={{ bg: isSelected ? 'blue.500' : 'blue.600' }}
      textAlign="left"
    >
      <Box fontWeight="600">{studentName(group.inputDetails)}</Box>
      <HStack justifyContent="space-between" gap="200" fontSize="0.75rem" opacity="0.75">
        <Box>{secondId(group)}</Box>
        <Box whiteSpace="nowrap">
          {status === 'ready' && decision?.kind === 'match'
            ? decision.candidate.studentUniqueId
            : `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`}
        </Box>
      </HStack>
    </VStack>
  );
};

type LastAction = { message: string; undo: () => void; advance: boolean };

const LastActionBar = ({ action, onDismiss }: { action: LastAction; onDismiss: () => void }) => (
  <HStack
    marginBottom="300"
    padding="200"
    paddingLeft="300"
    borderRadius="6px"
    bg="blue.600"
    borderLeftWidth="3px"
    borderColor="green.100"
    justifyContent="space-between"
    role="status"
  >
    <Box fontSize="0.9rem">{action.message}</Box>
    <HStack gap="100">
      <QuietButton
        onClick={() => {
          action.undo();
          onDismiss();
        }}
      >
        Undo
      </QuietButton>
      <QuietButton onClick={onDismiss} aria-label="Dismiss">
        ✕
      </QuietButton>
    </HStack>
  </HStack>
);

// One student ------------------------------------------------------------------

const Workspace = ({
  group,
  onSaved,
}: {
  group: GetStudentInputDetailsDto;
  onSaved: (action: LastAction) => void;
}) => {
  const { job, statusOf, decisions, decide, undo, batchOf, batches } = useReviewSession();
  const id = group.correlationId;
  const status = statusOf(id);
  const decision = decisions.get(id);
  const batch = batchOf(id);
  const isSubmitted = status === 'reprocessing' || status === 'reprocessed';
  const suggestions = suggestionsOf(group);

  // Saying none fit stays on this student and opens search and exclude.
  const [noneFit, setNoneFit] = useState(false);

  // A match found by searching stays in view beside the suggestions.
  const fromSearch =
    decision?.kind === 'match' && decision.candidate.source === 'search'
      ? decision.candidate
      : null;
  const candidates =
    fromSearch && !suggestions.some((c) => c.studentUniqueId === fromSearch.studentUniqueId)
      ? [...suggestions, fromSearch]
      : suggestions;
  const saved = decision?.kind === 'match' ? decision.candidate.studentUniqueId : null;
  const name = studentName(group.inputDetails);

  // Restoring the prior decision is what makes an undo trustworthy.
  const restore = (previous: Decision | undefined) => () =>
    previous ? decide(id, previous) : undo(id);

  // One step: the submit list is where matches get their second look.
  const use = (candidate: Candidate) => {
    const previous = decision;
    decide(id, { kind: 'match', candidate });
    onSaved({
      message: `Saved ${candidate.studentUniqueId} as the match for ${name}.`,
      undo: restore(previous),
      advance: true,
    });
  };
  const clear = () => {
    const previous = decision;
    undo(id);
    onSaved({
      message: `Cleared the decision for ${name}.`,
      undo: restore(previous),
      advance: false,
    });
  };
  const exclude = () => {
    const previous = decision;
    decide(id, { kind: 'not-in-roster' });
    setNoneFit(false);
    onSaved({ message: `Excluded ${name} from this job.`, undo: restore(previous), advance: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea') || isSubmitted) return;
  };

  const issues = fileIssues(group);
  const batchNumber = batch ? batches.findIndex((b) => b.id === batch.id) + 1 : 0;

  return (
    <VStack alignItems="stretch" gap="400" onKeyDown={onKeyDown}>
      {/* The source record stays put while everything else changes. */}
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          From your file
        </Box>
        <HStack gap="300" alignItems="baseline" flexWrap="wrap">
          <Box textStyle="h4">{name}</Box>
          <Box opacity="0.85">{secondId(group)}</Box>
        </HStack>
        {issues.map((issue) => (
          <Box key={issue} fontSize="0.85rem" color="purple.200">
            {issue}
          </Box>
        ))}
      </VStack>

      <DecisionState
        correlationId={id}
        status={status}
        decision={decision}
        batch={batch}
        batchNumber={batchNumber}
        reference={`Job ${job.id}${batch ? ` · batch ${batchNumber}` : ''}`}
      />

      {(noneFit || (!isSubmitted && candidates.length === 0)) && !isSubmitted ? (
        <NoSuggestionFits
          group={group}
          suggestionCount={suggestions.length}
          onBack={candidates.length ? () => setNoneFit(false) : undefined}
          onUse={use}
          onExclude={exclude}
          search={<Search group={group} saved={saved} onUse={use} />}
        >
          {decision && (
            <QuietButton alignSelf="flex-start" onClick={clear}>
              Clear decision
            </QuietButton>
          )}
        </NoSuggestionFits>
      ) : (
        <VStack alignItems="stretch" gap="200">
          <EvidenceTable
            group={group}
            candidates={candidates}
            saved={saved}
            onUse={isSubmitted ? undefined : use}
          />
          {!isSubmitted && (
            <HStack gap="300" paddingTop="100">
              <SecondaryButton onClick={() => setNoneFit(true)}>
                {candidates.length === 1 ? 'Not this student' : 'None of these'}
              </SecondaryButton>
              <Box fontSize="0.8rem" opacity="0.7">
                Search the roster or exclude this record.
              </Box>
              <Box flex="1" />
              {decision && <QuietButton onClick={clear}>Clear decision</QuietButton>}
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
};

/** What's been decided and what's happened since, kept apart. */
const DecisionState = ({
  correlationId,
  status,
  decision,
  batch,
  batchNumber,
  reference,
}: {
  correlationId: string;
  status: StudentStatus;
  decision: Decision | undefined;
  batch: Batch | undefined;
  batchNumber: number;
  reference: string;
}) => {
  const by = decision ? ` by ${decision.decidedBy} at ${time(decision.decidedAt)}` : '';
  let body: ReactNode = null;
  if (status === 'ready' && decision?.kind === 'match') {
    body = `Match saved${by}: ${decision.candidate.studentUniqueId}${
      decision.candidate.source === 'search' ? ', found by searching' : ''
    }. Not submitted yet.`;
  } else if (status === 'excluded') {
    body = `Excluded from this job${by}. Its records won't be reprocessed.`;
  } else if (
    batch &&
    (status === 'reprocessing' || status === 'reprocessed' || status === 'run-failed')
  ) {
    const chosen = batch.items.find((it) => it.correlationId === correlationId)?.decision.candidate
      .studentUniqueId;
    body = (
      <VStack alignItems="flex-start" gap="100">
        <Box>
          Submitted in batch {batchNumber}
          {chosen ? ` with ${chosen}` : ''} · batch {batch.status}.
        </Box>
        {status === 'run-failed' ? (
          <Box fontSize="0.85rem" opacity="0.85">
            The run failed before attempting anything. Retry the batch below.
          </Box>
        ) : (
          <HStack fontSize="0.85rem" opacity="0.85" gap="200" flexWrap="wrap">
            <Box>
              Correcting a submitted identity isn't supported here yet. To report a wrong match,
              contact support with {reference}.
            </Box>
            <CopyButton value={reference} label="Copy reference" />
          </HStack>
        )}
      </VStack>
    );
  }
  if (!body) return null;
  return (
    <Box
      padding="300"
      borderRadius="6px"
      borderWidth="1px"
      borderColor="blue.50-40"
      fontSize="0.9rem"
    >
      {body}
    </Box>
  );
};

type Row = {
  label: string;
  file: string | null;
  roster: (candidate: StudentRosterDetailsJson) => string | null;
  /** Compared rows get marks. */
  compared: boolean;
  /** Only the roster has these; they're a click away. */
  rosterOnly: boolean;
};

const rows: Row[] = [
  {
    label: 'First name',
    file: null,
    roster: (r) => valueText(r.first_name),
    compared: true,
    rosterOnly: false,
  },
  {
    label: 'Last name',
    file: null,
    roster: (r) => valueText(r.last_name),
    compared: true,
    rosterOnly: false,
  },
  {
    label: 'Date of birth',
    file: null,
    roster: (r) => valueText(r.birth_date),
    compared: true,
    rosterOnly: false,
  },
  // Both sides have IDs, but usually from different ID systems (the roster's
  // are typed), so they're shown side by side without a mark.
  {
    label: 'Student IDs',
    file: null,
    roster: (r) => valueText(r.student_ids),
    compared: false,
    rosterOnly: false,
  },
  {
    label: 'Middle name',
    file: null,
    roster: (r) => valueText(r.middle_name),
    compared: false,
    rosterOnly: true,
  },
  {
    label: 'School years',
    file: null,
    roster: (r) => valueText(r.school_years),
    compared: false,
    rosterOnly: true,
  },
];

const MAX_COMPARED = 3;

const rosterDetailsKey = 'runway.match-review.roster-details';

/**
 * The file against every candidate, aligned, so the eye runs across a row.
 * Each candidate's column is its own tinted band, so one student's details
 * read together. Nothing is hidden: a conflict all candidates share stays in
 * view, and roster-only details are a click away.
 */
const EvidenceTable = ({
  group,
  candidates,
  saved,
  onUse,
}: {
  group: GetStudentInputDetailsDto;
  candidates: Candidate[];
  saved: string | null;
  onUse?: (candidate: Candidate) => void;
}) => {
  // Details only the roster has are a click away; remembered across students.
  const [showRosterOnly, setShowRosterOnlyState] = useState(() => {
    try {
      return window.localStorage.getItem(rosterDetailsKey) === 'open';
    } catch {
      return false;
    }
  });
  const setShowRosterOnly = (open: boolean) => {
    setShowRosterOnlyState(open);
    try {
      window.localStorage.setItem(rosterDetailsKey, open ? 'open' : 'closed');
    } catch {
      // A remembered preference is a convenience.
    }
  };
  // With many candidates, compare a shortlist; the full list stays one click away.
  const [shortlist, setShortlist] = useState<string[]>(() =>
    candidates.slice(0, MAX_COMPARED).map((c) => c.studentUniqueId)
  );
  const shown =
    candidates.length > MAX_COMPARED
      ? candidates.filter((c) => shortlist.includes(c.studentUniqueId))
      : candidates;
  const comparisons = shown.map((c) => compare(group.inputDetails, c.rosterDetails));
  const fileValue: Record<string, string | null> = {
    'First name': valueText(group.inputDetails.first_name),
    'Last name': valueText(group.inputDetails.last_name),
    'Date of birth': valueText(group.inputDetails.birth_date),
    'Middle name': null,
    'Student IDs': valueText(group.inputDetails.student_ids),
    'School years': null,
  };
  const agreementOf = (label: string, index: number): Agreement =>
    comparisons[index].fields.find((f) => f.label === label)?.agreement ?? 'unknown';
  // The band behind each candidate's column; a saved match's band is outlined.
  const band = (c: Candidate) => ({
    bg: 'blue.600',
    borderBottomWidth: '0',
    boxShadow:
      saved === c.studentUniqueId
        ? 'inset 2px 0 0 var(--chakra-colors-green-100), inset -2px 0 0 var(--chakra-colors-green-100)'
        : undefined,
  });

  const renderRow = (row: Row) => (
    <Tr key={row.label}>
      <Td whiteSpace="nowrap" opacity="0.85">
        {row.label}
      </Td>
      <Td>{fileValue[row.label] ?? <Missing compared={!row.rosterOnly} />}</Td>
      {shown.map((c, i) => {
        const value = row.roster(c.rosterDetails);
        return (
          <Td key={c.studentUniqueId} {...band(c)}>
            <HStack gap="100" alignItems="baseline">
              {row.compared ? (
                <AgreementMark agreement={agreementOf(row.label, i)} />
              ) : (
                // Keeps unmarked values aligned with marked ones.
                !row.rosterOnly && <Box width="1.5rem" flexShrink={0} />
              )}
              <Box>{value ?? <Missing compared={!row.rosterOnly} />}</Box>
            </HStack>
          </Td>
        );
      })}
    </Tr>
  );

  return (
    <VStack alignItems="stretch" gap="200">
      {candidates.length > MAX_COMPARED && (
        <HStack gap="300" flexWrap="wrap" fontSize="0.85rem">
          <Box opacity="0.8">
            Comparing {shown.length} of {candidates.length}:
          </Box>
          {candidates.map((c) => (
            <Checkbox
              key={c.studentUniqueId}
              size="sm"
              isChecked={shortlist.includes(c.studentUniqueId)}
              isDisabled={
                !shortlist.includes(c.studentUniqueId) && shortlist.length >= MAX_COMPARED
              }
              onChange={() =>
                setShortlist((list) =>
                  list.includes(c.studentUniqueId)
                    ? list.filter((x) => x !== c.studentUniqueId)
                    : [...list, c.studentUniqueId]
                )
              }
            >
              {c.studentUniqueId}
            </Checkbox>
          ))}
        </HStack>
      )}
      <Box overflowX="auto">
        <Table
          size="sm"
          sx={{
            // Separate cells, so each candidate's band has space around it.
            borderCollapse: 'separate',
            borderSpacing: '0.5rem 0',
            td: { paddingX: '200', verticalAlign: 'top', borderColor: 'blue.50-40' },
            th: { paddingX: '200' },
          }}
        >
          <Thead>
            <Tr>
              <Th />
              <Th color="blue.50" textTransform="none" fontSize="0.8rem">
                In your file
              </Th>
              {shown.map((c) => (
                <Th
                  key={c.studentUniqueId}
                  color="blue.50"
                  textTransform="none"
                  fontSize="0.8rem"
                  borderTopRadius="8px"
                  paddingTop="200"
                  {...band(c)}
                  boxShadow={
                    saved === c.studentUniqueId
                      ? 'inset 0 2px 0 var(--chakra-colors-green-100), inset 2px 0 0 var(--chakra-colors-green-100), inset -2px 0 0 var(--chakra-colors-green-100)'
                      : undefined
                  }
                >
                  <HStack gap="100">
                    <Box>{c.studentUniqueId}</Box>
                    <CopyButton value={c.studentUniqueId} />
                  </HStack>
                  <Box fontWeight="normal" opacity="0.8">
                    {[
                      c.source === 'search' && 'Found by your search',
                      c.score !== null && `match score ${c.score}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                      .replace(/^./, (first) => first.toUpperCase())}
                  </Box>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {rows.filter((row) => !row.rosterOnly).map(renderRow)}
            {/* The toggle stays put; roster details open beneath it. */}
            <Tr>
              <Td paddingY="100" colSpan={2}>
                <QuietButton
                  size="xs"
                  paddingX="0"
                  onClick={() => setShowRosterOnly(!showRosterOnly)}
                  aria-expanded={showRosterOnly}
                >
                  {showRosterOnly ? '▾' : '▸'} Roster details
                </QuietButton>
              </Td>
              {shown.map((c) => (
                <Td key={c.studentUniqueId} {...band(c)} />
              ))}
            </Tr>
            {showRosterOnly && rows.filter((row) => row.rosterOnly).map(renderRow)}
            <Tr>
              <Td />
              <Td />
              {shown.map((c) => (
                <Td
                  key={c.studentUniqueId}
                  {...band(c)}
                  borderBottomRadius="8px"
                  paddingBottom="300"
                  boxShadow={
                    saved === c.studentUniqueId
                      ? 'inset 0 -2px 0 var(--chakra-colors-green-100), inset 2px 0 0 var(--chakra-colors-green-100), inset -2px 0 0 var(--chakra-colors-green-100)'
                      : undefined
                  }
                >
                  {saved === c.studentUniqueId ? (
                    <Box fontWeight="600" color="green.100" paddingY="100">
                      ✓ Saved match
                    </Box>
                  ) : (
                    onUse && (
                      <PrimaryButton onClick={() => onUse(c)}>
                        {c.source === 'search' ? 'Use this student' : 'Use suggestion'}
                      </PrimaryButton>
                    )
                  )}
                </Td>
              ))}
            </Tr>
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
};

const Missing = ({ compared }: { compared: boolean }) => (
  <Box as="span" opacity="0.55" fontStyle="italic">
    {compared ? 'missing' : '—'}
  </Box>
);

/** Search, remembered per student so a trip to the SIS doesn't lose it. */
const Search = ({
  group,
  saved,
  onUse,
}: {
  group: GetStudentInputDetailsDto;
  saved: string | null;
  onUse: (candidate: Candidate) => void;
}) => {
  const { search, searchOf, setSearch } = useReviewSession();
  const remembered = searchOf(group.correlationId);
  const [terms, setTerms] = useState<SearchTerms>(
    remembered?.terms ?? termsFrom(group.inputDetails)
  );
  const [searching, setSearching] = useState(false);
  const hits = remembered?.hits ?? null;

  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setSearching(true);
    setError(null);
    try {
      const found = await search(group.correlationId, terms);
      setSearch(group.correlationId, { terms, hits: found });
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'The search failed.');
    }
    setSearching(false);
  };
  const field = (key: keyof SearchTerms, label: string, placeholder?: string) => (
    <SearchField
      id={`search-${key}-${group.correlationId}`}
      label={label}
      value={terms[key]}
      placeholder={placeholder}
      onChange={(value) => setTerms({ ...terms, [key as string]: value })}
      onEnter={run}
    />
  );

  return (
    <VStack alignItems="stretch" gap="300">
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="200">
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('birth_date', 'Date of birth', 'YYYY-MM-DD')}
        {field('student_ids', 'Student IDs', 'any IDs, e.g. state or local')}
      </SimpleGrid>
      <HStack gap="300">
        <SecondaryButton onClick={run} isLoading={searching}>
          Search
        </SecondaryButton>
        <Box fontSize="0.8rem" opacity="0.7">
          Results are compared with your file, not with these search terms.
        </Box>
      </HStack>
      {error && !searching && <Box color="pink.100">Couldn't search: {error}</Box>}
      {hits && !searching && hits.length === 0 && (
        <Box>No one in the roster matches those details.</Box>
      )}
      {hits && !searching && hits.length > 0 && (
        <Box bg="blue.700" borderRadius="6px" padding="200">
          <EvidenceTable
            group={group}
            candidates={hits.map((hit) => ({
              studentUniqueId: hit.studentUniqueId,
              rosterDetails: hit.rosterDetails,
              score: hit.score,
              source: 'search' as const,
              searchDetails: hit.searchDetails,
            }))}
            saved={saved}
            onUse={onUse}
          />
        </Box>
      )}
    </VStack>
  );
};

// Submitting -------------------------------------------------------------------

/**
 * A record as three lines, name, birth date and IDs, laid out the same for
 * the file and the roster so the two read across. Given the file to compare
 * `against`, the name and birth date carry the usual = / ≠ marks.
 */
const RecordLines = ({
  details,
  against,
}: {
  details: StudentInputDetailsJson | StudentRosterDetailsJson;
  against?: StudentInputDetailsJson;
}) => {
  const fields = against ? compare(against, details as StudentRosterDetailsJson).fields : null;
  const agreement = (label: string): Agreement =>
    fields?.find((f) => f.label === label)?.agreement ?? 'unknown';
  // The name is the same only if both parts are; any part that differs, differs.
  const nameMark: Agreement = [agreement('First name'), agreement('Last name')].includes(
    'different'
  )
    ? 'different'
    : agreement('First name') === 'same' && agreement('Last name') === 'same'
    ? 'same'
    : 'unknown';
  const line = (content: ReactNode, mark?: Agreement | null, bold = false) => (
    <HStack gap="200" minHeight="1.75rem" alignItems="center">
      {mark !== undefined &&
        (mark ? <AgreementMark agreement={mark} /> : <Box width="1.5rem" flexShrink={0} />)}
      <Box fontWeight={bold ? '600' : 'normal'} fontSize={bold ? '0.95rem' : '0.85rem'}>
        {content}
      </Box>
    </HStack>
  );
  const marks = !!against;
  return (
    <VStack alignItems="stretch" gap="0">
      {line(studentName(details), marks ? nameMark : undefined, true)}
      {line(
        `born ${valueText(details.birth_date) ?? '—'}`,
        marks ? agreement('Date of birth') : undefined
      )}
      {/* IDs come from different systems, so they're shown, not marked. */}
      {line(`IDs ${valueText(details.student_ids) ?? '—'}`, marks ? null : undefined)}
    </VStack>
  );
};

/** A compact checkpoint: what will be reprocessed, with a way back to the evidence. */
const SubmitReview = ({
  isOpen,
  ready,
  onClose,
  onView,
}: {
  isOpen: boolean;
  ready: GetStudentInputDetailsDto[];
  onClose: () => void;
  onView: (correlationId: string) => void;
}) => {
  const { decisions, submit, groups, statusOf } = useReviewSession();
  const [sent, setSent] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) {
      setSent(false);
      setConflict(null);
    }
  }, [isOpen]);
  const excluded = groups.filter((g) => statusOf(g.correlationId) === 'excluded');
  const byOthers = ready.filter((g) => {
    const by = decisions.get(g.correlationId)?.decidedBy;
    return by && by !== 'you';
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="blue.700" color="blue.50">
        <ModalHeader>
          Reprocess {ready.length} {ready.length === 1 ? 'record group' : 'record groups'} with
          these identities
        </ModalHeader>
        <ModalBody>
          {conflict && (
            <VStack
              alignItems="flex-start"
              gap="200"
              marginBottom="300"
              padding="300"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="pink.100"
            >
              <Box>
                Nothing was submitted: {conflict} The list has been refreshed; check it, then submit
                again.
              </Box>
            </VStack>
          )}
          {byOthers.length > 0 && (
            <Box
              marginBottom="300"
              padding="300"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="purple.200"
              fontSize="0.9rem"
            >
              {byOthers.length} of these {byOthers.length === 1 ? 'match was' : 'matches were'}{' '}
              saved by another reviewer. Submitting sends them as they are; check them if you're not
              expecting that.
            </Box>
          )}
          <Table size="sm">
            <Thead>
              <Tr>
                <Th color="blue.50" textTransform="none">
                  From your file
                </Th>
                <Th color="blue.50" textTransform="none">
                  Matched to
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {ready.map((group) => {
                const decision = decisions.get(group.correlationId);
                const candidate = decision?.kind === 'match' ? decision.candidate : null;
                return (
                  <Tr key={group.correlationId}>
                    <Td>
                      <RecordLines details={group.inputDetails} />
                    </Td>
                    <Td>
                      {candidate && (
                        <RecordLines
                          details={candidate.rosterDetails}
                          against={group.inputDetails}
                        />
                      )}
                      {candidate?.source === 'search' && (
                        <Box fontSize="0.75rem" opacity="0.8">
                          Found by search
                        </Box>
                      )}
                      {decision && decision.decidedBy !== 'you' && (
                        <Box fontSize="0.75rem" color="purple.200">
                          Saved by {decision.decidedBy}
                        </Box>
                      )}
                    </Td>
                    <Td textAlign="right">
                      <QuietButton onClick={() => onView(group.correlationId)}>
                        View evidence
                      </QuietButton>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
          {excluded.length > 0 && (
            <Box marginTop="300" fontSize="0.85rem" opacity="0.85">
              Not part of this submission: {excluded.length} excluded from this job (
              {excluded.map((g) => studentName(g.inputDetails)).join(', ')}). Exclusions already
              apply.
            </Box>
          )}
          <Box marginTop="300" fontSize="0.85rem" opacity="0.85">
            The run will report how many records loaded, skipped or failed for the batch as a whole,
            not per student. You can keep reviewing while it runs.
          </Box>
        </ModalBody>
        <ModalFooter gap="200">
          <QuietButton onClick={onClose}>Keep reviewing</QuietButton>
          <PrimaryButton
            isDisabled={sent || !ready.length}
            isLoading={sent}
            onClick={async () => {
              setSent(true);
              const result = await submit(ready.map((g) => g.correlationId));
              setSent(false);
              if (result.ok) onClose();
              else setConflict(result.message);
            }}
          >
            Submit batch
          </PrimaryButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

/** Errors come with a next step: a reference for support, and logs for those who can see them. */
const SupportPath = ({ batches }: { batches: Batch[] }) => {
  const { job } = useReviewSession();
  const troubled = batches
    .map((b, i) => ({ batch: b, number: i + 1 }))
    .filter(({ batch }) => batch.status === 'complete with errors' || batch.status === 'failed');
  const reference = `Job ${job.id} · batch ${troubled.map((t) => t.number).join(', ')}`;
  return (
    <VStack
      alignItems="flex-start"
      gap="100"
      padding="300"
      borderRadius="6px"
      borderWidth="1px"
      borderColor="pink.100"
      fontSize="0.9rem"
    >
      <Box fontWeight="600">
        {troubled.length} {troubled.length === 1 ? 'batch' : 'batches'} reported problems
      </Box>
      <Box>
        The matches still stand; retrying or changing a match won't fix a delivery error. Support
        can trace failed records from each run's troubleshooting logs.
      </Box>
      <HStack gap="200" flexWrap="wrap">
        <Box>Contact support with {reference}</Box>
        <CopyButton value={reference} label="Copy reference" />
        <QuietButton size="xs" isDisabled title="Support users only; not in the prototype">
          Open run logs (support)
        </QuietButton>
      </HStack>
    </VStack>
  );
};

import {
  Box,
  Checkbox,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Select,
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
import { Fragment, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '@chakra-ui/icons';
import { Agreement, compare } from './compare';
import {
  AgreementMark,
  BatchCard,
  PrimaryButton,
  NoSuggestionFits,
  useOrientation,
  PrototypeControls,
  SearchField,
  QuietButton,
  SecondaryButton,
  studentName,
} from './components';
import { searchRoster, termsFrom, SearchTerms } from './mockIdrs';
import {
  Batch,
  Candidate,
  Decision,
  isFinished,
  StudentStatus,
  useReviewSession,
} from './reviewSession';

/*
 * PROTOTYPE, design 5: Review workspace, following the design review in
 * docs/student-identity-review-ux.md. One persistent queue and one focused
 * workspace. Suggestion count is a filter, not a workflow. Two destinations:
 * save a match, or exclude the record from this job (mostly for junk data);
 * rejecting the suggestions is neither. Submitting is a deliberate
 * checkpoint, and batch outcomes stay with the batch.
 */

// Queue ----------------------------------------------------------------------

const statusLabel: Record<StudentStatus, string> = {
  'to-review': 'Needs review',
  ready: 'Match saved',
  reprocessing: 'Submitted',
  reprocessed: 'Submitted',
  'run-failed': 'Run failed',
  excluded: 'Excluded',
};

type StatusFilter = 'open' | 'to-review' | 'ready' | 'excluded' | 'submitted';
type CountFilter = 'none' | 'one' | 'several';

const statusFilters: { key: StatusFilter; label: string; includes: StudentStatus[] }[] = [
  {
    key: 'open',
    label: 'Open',
    includes: ['to-review', 'ready', 'run-failed'],
  },
  { key: 'to-review', label: 'Needs review', includes: ['to-review'] },
  { key: 'ready', label: 'Match saved', includes: ['ready'] },
  { key: 'excluded', label: 'Excluded', includes: ['excluded'] },
  { key: 'submitted', label: 'Submitted', includes: ['reprocessing', 'reprocessed', 'run-failed'] },
];

const countFilters: { key: CountFilter; label: string; test: (n: number) => boolean }[] = [
  { key: 'none', label: 'No suggestions', test: (n) => n === 0 },
  { key: 'one', label: 'One', test: (n) => n === 1 },
  { key: 'several', label: 'Several', test: (n) => n > 1 },
];

type SortKey = 'file' | 'name' | 'birth' | 'id' | 'suggestions' | 'score' | 'status';
type Sort = { key: SortKey; descending: boolean };

/** Each sort's natural first direction: best scores first, most suggestions first. */
const sorts: { key: SortKey; label: string; descending: boolean }[] = [
  { key: 'file', label: 'File order', descending: false },
  { key: 'name', label: 'Last name', descending: false },
  { key: 'birth', label: 'Date of birth', descending: false },
  { key: 'id', label: 'Local ID', descending: false },
  { key: 'suggestions', label: 'Suggestions', descending: true },
  { key: 'score', label: 'Top match score', descending: true },
  { key: 'status', label: 'Status', descending: false },
];

const lastNameOf = (group: GetStudentInputDetailsDto) =>
  `${valueText(group.inputDetails.last_name) ?? ''} ${
    valueText(group.inputDetails.first_name) ?? ''
  }`.toLowerCase();

const topScore = (group: GetStudentInputDetailsDto) =>
  Math.max(-1, ...suggestionsOf(group).map((c) => c.score ?? -1));

// Work waiting on the reviewer first, then work in flight, then work done.
const statusOrder: StudentStatus[] = [
  'to-review',
  'run-failed',
  'ready',
  'reprocessing',
  'reprocessed',
  'excluded',
];

/** The split view's list groups, in the order work moves through them. */
const sections: { title: string; statuses: StudentStatus[]; finished?: boolean }[] = [
  { title: 'To review', statuses: ['to-review'] },
  { title: 'Run failed', statuses: ['run-failed'] },
  { title: 'Ready to submit', statuses: ['ready'] },
  { title: 'Reprocessing', statuses: ['reprocessing'] },
  // Finished work starts collapsed, out of the way of what's left to do.
  { title: 'Reprocessed', statuses: ['reprocessed'], finished: true },
  { title: 'Excluded', statuses: ['excluded'], finished: true },
];

const sectionIndex = (status: StudentStatus) =>
  sections.findIndex((section) => section.statuses.includes(status));

const sortBy =
  ({ key, descending }: Sort, statusOf: (id: string) => StudentStatus) =>
  (a: GetStudentInputDetailsDto, b: GetStudentInputDetailsDto) => {
    const text = (v: JsonValue | undefined) => valueText(v) ?? '';
    const order =
      key === 'name'
        ? lastNameOf(a).localeCompare(lastNameOf(b))
        : key === 'birth'
        ? text(a.inputDetails.birth_date).localeCompare(text(b.inputDetails.birth_date))
        : key === 'id'
        ? text(a.inputDetails.student_ids).localeCompare(
            text(b.inputDetails.student_ids),
            undefined,
            { numeric: true }
          )
        : key === 'suggestions'
        ? suggestionsOf(a).length - suggestionsOf(b).length
        : key === 'score'
        ? topScore(a) - topScore(b)
        : key === 'status'
        ? statusOrder.indexOf(statusOf(a.correlationId)) -
          statusOrder.indexOf(statusOf(b.correlationId))
        : 0;
    return descending ? -order : order;
  };

// Evidence -------------------------------------------------------------------

/** The latest search IDRS ran for this student; earlier ones are history. */
const latestResult = (group: GetStudentInputDetailsDto) =>
  [...group.results].sort((a, b) => +new Date(b.createdOn) - +new Date(a.createdOn))[0];

const suggestionsOf = (group: GetStudentInputDetailsDto): Candidate[] =>
  (latestResult(group)?.suggestions ?? [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      studentUniqueId: s.studentUniqueId,
      rosterDetails: s.rosterDetails,
      score: s.score,
      source: 'suggestion' as const,
    }));

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

const selectedKey = (jobId: number) => `runway.match-review-prototype.${jobId}.selected`;

/**
 * `split` is the list beside the workspace, grouped by status: the side list
 * tracks progress and holds the submit button, and the top shows batches.
 * `topbar` turns that around: the side list holds only students still to
 * review, and the top collects decisions, submits them and shows what's
 * been submitted. `table` starts from the whole list as a sortable table;
 * opening a student condenses it to the side list, like opening a thread or
 * a ticket. `inline` keeps the table and opens the review pane beneath the
 * student's row.
 */
export const WorkspaceReview = ({
  layout = 'split',
}: {
  layout?: 'split' | 'topbar' | 'table' | 'inline';
}) => {
  const { job, groups, isLoading, isError, statusOf, decisions } = useReviewSession();
  // null means that filter is off. Clicking the active chip turns it off.
  // The split view groups the list by status instead of filtering by it.
  const grouped = layout === 'split';
  // The top-bar view's list is only students still to review; the top bar
  // has the rest.
  const reviewOnly = layout === 'topbar';
  // Expanding rows filters by status from the summary's counts, and starts
  // showing everyone.
  const tilesFilter = layout === 'inline';
  const defaultStatus: StatusFilter | null =
    grouped || tilesFilter ? null : reviewOnly ? 'to-review' : 'open';
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(defaultStatus);
  const [countFilter, setCountFilter] = useState<CountFilter | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(selectedKey(job.id));
    } catch {
      return null;
    }
  });
  // Set once the reviewer picks a student, so the prompt to submit gives way
  // to the student they asked for. Cleared when they save a decision.
  const [lookingBack, setLookingBack] = useState(false);
  const setSelectedId = (id: string | null) => {
    setLookingBack(true);
    setSelectedIdState(id);
    try {
      if (id) window.localStorage.setItem(selectedKey(job.id), id);
    } catch {
      // A remembered place is a convenience.
    }
  };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'file', descending: false });
  const [expanded, setExpanded] = useState(layout === 'table');
  // Inline: the one row open beneath the table, if any.
  const [inlineId, setInlineId] = useState<string | null>(null);
  const chooseSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: sorts.find((s) => s.key === key)?.descending ?? false }
    );
  const [reviewing, setReviewing] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [openFinished, setOpenFinished] = useState<Set<string>>(() => new Set());
  const toggleFinished = (title: string) =>
    setOpenFinished((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });
  const sideList = useRef<HTMLDivElement>(null);
  const done = useReviewDone();

  const includes = statusFilters.find((f) => f.key === statusFilter)?.includes;
  const countTest = countFilters.find((f) => f.key === countFilter)?.test ?? (() => true);
  const terms = query.trim().toLowerCase();
  const queue = groups
    .filter(
      (g) =>
        (!includes || includes.includes(statusOf(g.correlationId))) &&
        countTest(suggestionsOf(g).length) &&
        (!terms || searchText(g).includes(terms))
    )
    .sort(sortBy(sort, statusOf))
    // Grouped, the list reads section by section, so previous and next do too.
    .sort((a, b) =>
      grouped
        ? sectionIndex(statusOf(a.correlationId)) - sectionIndex(statusOf(b.correlationId))
        : 0
    );
  const filtered = statusFilter !== defaultStatus || countFilter !== null || !!terms;
  const clearFilters = () => {
    setStatusFilter(defaultStatus);
    setCountFilter(null);
    setQuery('');
  };

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected = groups.find((g) => g.correlationId === selectedId) ?? queue[0] ?? groups[0];
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');
  // Every student has a decision, but saved matches haven't been submitted.
  const awaitingSubmit =
    ready.length > 0 && !groups.some((g) => statusOf(g.correlationId) === 'to-review');
  const submitFrom =
    layout === 'split'
      ? 'Ready to submit, in the list'
      : layout === 'topbar'
      ? 'Matches to submit, above'
      : layout === 'inline'
      ? 'Review and submit, below'
      : 'Review and submit, above';
  const submitPrompt = (
    <SubmitPrompt
      readyCount={ready.length}
      excludedCount={groups.filter((g) => statusOf(g.correlationId) === 'excluded').length}
      from={submitFrom}
      lookFrom={layout === 'topbar' ? 'the lists above' : 'the list'}
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
  const nextToReview = (() => {
    const after = [...queue.slice(position + 1), ...queue.slice(0, Math.max(position, 0))];
    return after.find(
      (g) => g.correlationId !== selected.correlationId && statusOf(g.correlationId) === 'to-review'
    );
  })();

  const searchBox = (
    <Input
      id={`workspace-queue-search-${layout}`}
      size="sm"
      placeholder="Search by name, birth date or ID"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      aria-label="Search the list"
    />
  );
  const filterChips = (
    <>
      {!grouped && !reviewOnly && !tilesFilter && (
        <FilterChips
          label="Status"
          options={statusFilters.map(({ key, label }) => ({
            key,
            label,
            count: groups.filter((g) =>
              (statusFilters.find((f) => f.key === key)?.includes ?? []).includes(
                statusOf(g.correlationId)
              )
            ).length,
          }))}
          value={statusFilter}
          onChange={(key) => setStatusFilter(key === statusFilter ? null : (key as StatusFilter))}
        />
      )}
      <FilterChips
        label="Suggestions"
        options={countFilters.map(({ key, label }) => ({ key, label }))}
        value={countFilter}
        onChange={(key) => setCountFilter(key === countFilter ? null : (key as CountFilter))}
      />
    </>
  );
  const countLine = (
    <HStack fontSize="0.8rem" gap="200" minHeight="1.5rem">
      <Box opacity="0.8" whiteSpace="nowrap">
        {queue.length} of {groups.length} students
        {tilesFilter &&
          statusFilter &&
          ` · ${overviewTiles.find((t) => t.key === statusFilter)?.label.toLowerCase()}`}
      </Box>
      {filtered && (
        <QuietButton size="xs" onClick={clearFilters}>
          Clear filters
        </QuietButton>
      )}
    </HStack>
  );
  const open = (id: string) => {
    setSelectedId(id);
    setExpanded(false);
  };

  return (
    <VStack alignItems="stretch" width="100%" gap="400">
      {layout === 'split' ? (
        <BatchesPanel />
      ) : layout === 'topbar' ? (
        <ProgressBar
          selectedId={selected.correlationId}
          onOpen={setSelectedId}
          onReview={() => setReviewing(true)}
          onToReview={() => {
            const first = queue.find((g) => statusOf(g.correlationId) === 'to-review');
            if (first) setSelectedId(first.correlationId);
            sideList.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }}
        />
      ) : layout === 'inline' ? null : (
        <Overview onReview={() => setReviewing(true)} readyCount={ready.length} />
      )}

      {layout === 'inline' ? (
        <VStack alignItems="stretch" gap="300" layerStyle="contentBox" padding="300">
          <HStack gap="300" alignItems="flex-start" flexWrap="wrap">
            <Box width="20rem">{searchBox}</Box>
            <VStack alignItems="stretch" gap="100" fontSize="0.8rem" flex="1">
              {filterChips}
            </VStack>
          </HStack>
          {countLine}
          {awaitingSubmit && !inlineId && (
            <VStack alignItems="stretch" gap="200">
              {lastAction && (
                <LastActionBar action={lastAction} onDismiss={() => setLastAction(null)} />
              )}
              {submitPrompt}
            </VStack>
          )}
          <StudentTable
            queue={queue}
            sort={sort}
            onSort={chooseSort}
            onOpen={(id) => setInlineId(id === inlineId ? null : id)}
            lastOpened={inlineId}
            expandedId={inlineId}
            renderExpanded={(group) => {
              const index = queue.findIndex((g) => g.correlationId === group.correlationId);
              const step = (by: number) =>
                setInlineId(queue[(index + by + queue.length) % queue.length].correlationId);
              const after = [...queue.slice(index + 1), ...queue.slice(0, Math.max(index, 0))];
              const next = after.find(
                (g) =>
                  g.correlationId !== group.correlationId &&
                  statusOf(g.correlationId) === 'to-review'
              );
              return (
                <InlinePane
                  position={`${index + 1} of ${queue.length}`}
                  onPrevious={queue.length > 1 ? () => step(-1) : undefined}
                  onNext={queue.length > 1 ? () => step(1) : undefined}
                  onNextToReview={next ? () => setInlineId(next.correlationId) : undefined}
                  onClose={() => setInlineId(null)}
                  lastAction={lastAction}
                  onDismissAction={() => setLastAction(null)}
                >
                  <Workspace
                    key={group.correlationId}
                    group={group}
                    onSaved={(action) => {
                      setLastAction(action);
                      if (action.advance) setInlineId(next?.correlationId ?? null);
                    }}
                  />
                </InlinePane>
              );
            }}
          />
        </VStack>
      ) : expanded ? (
        <VStack alignItems="stretch" gap="300" layerStyle="contentBox" padding="300">
          <HStack gap="300" alignItems="flex-start" flexWrap="wrap">
            <Box width="20rem">{searchBox}</Box>
            <VStack alignItems="stretch" gap="100" fontSize="0.8rem" flex="1">
              {filterChips}
            </VStack>
          </HStack>
          {countLine}
          <StudentTable
            queue={queue}
            sort={sort}
            onSort={chooseSort}
            onOpen={open}
            lastOpened={selectedId}
          />
        </VStack>
      ) : (
        <HStack
          alignItems="flex-start"
          gap="400"
          width="100%"
          onKeyDown={(event: KeyboardEvent) => {
            if (layout !== 'table' || event.key !== 'Escape') return;
            if ((event.target as HTMLElement).closest('input, textarea')) return;
            setExpanded(true);
          }}
        >
          <VStack
            ref={sideList}
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
            {layout === 'table' && (
              <SecondaryButton size="xs" alignSelf="flex-start" onClick={() => setExpanded(true)}>
                ⤢ Back to table
              </SecondaryButton>
            )}
            {grouped && done && (
              <Box fontSize="0.9rem">
                <ReviewComplete />
              </Box>
            )}
            <VStack alignItems="stretch" gap="200" fontSize="0.8rem">
              {filterChips}
            </VStack>
            {countLine}
            <HStack fontSize="0.8rem" gap="200">
              <Box as="label" htmlFor={`workspace-queue-sort-${layout}`} opacity="0.8">
                Sort
              </Box>
              <Select
                id={`workspace-queue-sort-${layout}`}
                size="xs"
                flex="1"
                value={sort.key}
                onChange={(event) => chooseSort(event.target.value as SortKey)}
                bg="blue.600"
                color="blue.50"
                borderColor="blue.50-40"
                _hover={{ borderColor: 'blue.50' }}
                // The open list is drawn by the browser; give its options the same colors.
                sx={{
                  option: {
                    background: 'var(--chakra-colors-blue-700)',
                    color: 'var(--chakra-colors-blue-50)',
                  },
                }}
              >
                {sorts.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </HStack>
            {searchBox}
            <VStack
              alignItems="stretch"
              gap="0"
              flex="1"
              minHeight="0"
              overflowY="auto"
              marginX="-200"
            >
              {queue.length === 0 &&
                (reviewOnly && !filtered ? (
                  <Box padding="200" opacity="0.8" fontSize="0.9rem">
                    Every student has a decision. Check your matches above and submit them.
                  </Box>
                ) : (
                  <Box padding="200" opacity="0.8" fontSize="0.9rem">
                    Nothing matches.{' '}
                    <QuietButton size="xs" onClick={clearFilters}>
                      Clear filters
                    </QuietButton>
                  </Box>
                ))}
              {(grouped ? sections : [{ title: '', statuses: statusOrder, finished: false }]).map(
                ({ title, statuses, finished }) => {
                  const members = queue.filter((g) => statuses.includes(statusOf(g.correlationId)));
                  // A folded group opens while its student is the one shown,
                  // e.g. after stepping to it with previous and next.
                  const holdsSelected = members.some(
                    (g) => g.correlationId === selected.correlationId
                  );
                  const isOpen = !finished || openFinished.has(title) || holdsSelected;
                  // As in the focus view, saved matches and the button that
                  // submits them sit together, in one place, even when empty.
                  const isReadyBox = grouped && statuses.includes('ready');
                  if (!members.length && !isReadyBox) return null;
                  const list = (
                    <VStack
                      key={title || 'all'}
                      alignItems="stretch"
                      gap="0"
                      marginBottom={isReadyBox ? '0' : '200'}
                    >
                      {grouped && !finished && (
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
                      {grouped && finished && (
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
                      {isOpen &&
                        members.map((group) => (
                          <QueueRow
                            key={group.correlationId}
                            group={group}
                            decision={decisions.get(group.correlationId)}
                            status={statusOf(group.correlationId)}
                            showStatus={!grouped && !reviewOnly}
                            isSelected={group.correlationId === selected.correlationId}
                            onSelect={() => setSelectedId(group.correlationId)}
                          />
                        ))}
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
                }
              )}
            </VStack>
          </VStack>
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
            <HStack
              justifyContent="space-between"
              marginBottom="300"
              fontSize="0.85rem"
              gap="200"
              flexWrap="wrap"
            >
              <Box opacity="0.8">
                {position >= 0
                  ? `${position + 1} of ${queue.length} in this list`
                  : reviewOnly
                  ? 'Already decided'
                  : 'Not in the current list'}
              </Box>
              <HStack gap="100">
                <QuietButton size="xs" isDisabled={queue.length < 2} onClick={() => move(-1)}>
                  ‹ Previous
                </QuietButton>
                <QuietButton size="xs" isDisabled={queue.length < 2} onClick={() => move(1)}>
                  Next ›
                </QuietButton>
                <SecondaryButton
                  size="xs"
                  isDisabled={!nextToReview}
                  onClick={() => nextToReview && setSelectedId(nextToReview.correlationId)}
                >
                  Next to review
                </SecondaryButton>
              </HStack>
            </HStack>
            {lastAction && (
              <LastActionBar action={lastAction} onDismiss={() => setLastAction(null)} />
            )}
            {awaitingSubmit && !lookingBack ? (
              submitPrompt
            ) : (
              <Workspace
                key={selected.correlationId}
                group={selected}
                onSaved={(action) => {
                  setLastAction(action);
                  if (action.advance) advance(selected.correlationId);
                  // A decision brings back the prompt to submit, if it was the last one.
                  setLookingBack(false);
                }}
              />
            )}
          </Box>
        </HStack>
      )}

      <PrototypeControls />

      {layout === 'inline' && (
        // As in triage, progress and the submit button stay in reach at the
        // bottom while the table scrolls.
        <Box
          position="sticky"
          bottom="0"
          zIndex={1}
          borderRadius="8px"
          boxShadow="0 -4px 12px rgba(0,0,0,0.3)"
          maxHeight="40vh"
          overflowY="auto"
        >
          <Overview
            onReview={() => setReviewing(true)}
            readyCount={ready.length}
            statusFilter={statusFilter}
            onStatusFilter={(key) => setStatusFilter(key === statusFilter ? null : key)}
          />
        </Box>
      )}

      <SubmitReview
        isOpen={reviewing}
        ready={ready}
        onClose={() => setReviewing(false)}
        onView={(id) => {
          setReviewing(false);
          if (layout === 'inline') setInlineId(id);
          else open(id);
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

/**
 * Shown in place of a student once every student has a decision but saved
 * matches are waiting. It points at the page's one submit button rather
 * than adding another.
 */
const SubmitPrompt = ({
  readyCount,
  excludedCount,
  from,
  lookFrom,
}: {
  readyCount: number;
  excludedCount: number;
  from: string;
  lookFrom: string;
}) => (
  <HStack alignItems="flex-start" gap="300" paddingY="400" role="status">
    <CheckIcon color="green.100" boxSize="1.1rem" marginTop="0.3rem" />
    <VStack alignItems="flex-start" gap="100">
      <Box textStyle="h4">Every student has a decision</Box>
      <Box>
        {readyCount} {readyCount === 1 ? 'match is' : 'matches are'} ready to submit
        {excludedCount > 0 &&
          `, and ${excludedCount} ${excludedCount === 1 ? 'record is' : 'records are'} excluded`}
        . Check them and submit from {from}.
      </Box>
      <Box fontSize="0.85rem" opacity="0.75">
        To look at a student again, pick them from {lookFrom}.
      </Box>
    </VStack>
  </HStack>
);

/** Every batch, newest first, with a support path when one had trouble. */
const BatchList = ({ emptyText }: { emptyText: string }) => {
  const { batches } = useReviewSession();
  if (!batches.length) {
    return (
      <Box fontSize="0.85rem" opacity="0.75">
        {emptyText}
      </Box>
    );
  }
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

/** The split view's top: only what's been submitted. The list tracks the rest. */
const BatchesPanel = () => {
  const { groups } = useReviewSession();
  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      {groups.length > USUAL_MAXIMUM && <TooManyNote count={groups.length} />}
      <Box fontSize="0.9rem" fontWeight="600">
        Submitted batches
      </Box>
      <BatchList emptyText="Nothing submitted yet. Submit your saved matches from the list; each submission runs as a batch, and batches can run side by side." />
    </VStack>
  );
};

type TopView = 'ready' | 'excluded' | 'submitted';

/**
 * The top-bar view's progress: where decisions are collected, submitted and
 * followed. Each count opens its students; "Needs review" points at the list.
 */
const ProgressBar = ({
  selectedId,
  onOpen,
  onReview,
  onToReview,
}: {
  selectedId: string;
  onOpen: (id: string) => void;
  onReview: () => void;
  onToReview: () => void;
}) => {
  const { groups, statusOf } = useReviewSession();
  const done = useReviewDone();
  const [view, setView] = useState<TopView>('ready');
  const of = (...statuses: StudentStatus[]) =>
    groups.filter((g) => statuses.includes(statusOf(g.correlationId)));
  const ready = of('ready');
  const excluded = of('excluded');
  const submitted = of('reprocessing', 'reprocessed', 'run-failed');
  const toReview = of('to-review');
  const decided = groups.length - toReview.length - of('run-failed').length;
  const tiles: { key: TopView | 'to-review'; label: string; value: number }[] = [
    { key: 'to-review', label: 'Needs review', value: toReview.length },
    { key: 'ready', label: 'Matches to submit', value: ready.length },
    { key: 'excluded', label: 'Excluded', value: excluded.length },
    { key: 'submitted', label: 'Submitted', value: submitted.length },
  ];

  return (
    <VStack alignItems="stretch" gap="300" layerStyle="contentBox" padding="300">
      {groups.length > USUAL_MAXIMUM && <TooManyNote count={groups.length} />}
      <HStack gap="200" flexWrap="wrap">
        {tiles.map((tile) => {
          const isActive = tile.key === view;
          return (
            <VStack
              key={tile.key}
              as="button"
              onClick={() => (tile.key === 'to-review' ? onToReview() : setView(tile.key))}
              aria-pressed={tile.key === 'to-review' ? undefined : isActive}
              alignItems="flex-start"
              gap="0"
              paddingX="300"
              paddingY="100"
              borderRadius="6px"
              borderWidth="1px"
              borderColor={isActive ? 'blue.50' : 'transparent'}
              bg={isActive ? 'blue.600' : undefined}
              _hover={{ bg: 'blue.600' }}
              textAlign="left"
            >
              <Box fontSize="1.3rem" fontWeight="600" lineHeight="1.2">
                {tile.value}
              </Box>
              <Box fontSize="0.8rem" opacity="0.8">
                {tile.label}
                {tile.key === 'to-review' && ' ↓'}
              </Box>
            </VStack>
          );
        })}
      </HStack>
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
      <VStack
        alignItems="stretch"
        gap="200"
        paddingTop="300"
        borderTopWidth="1px"
        borderColor="blue.50-40"
      >
        {view === 'ready' && (
          <>
            <DecidedList
              members={ready}
              selectedId={selectedId}
              onOpen={onOpen}
              emptyText="Students you match land here until you submit them."
            />
            <PrimaryButton alignSelf="flex-end" isDisabled={!ready.length} onClick={onReview}>
              Review and submit {ready.length || ''} {ready.length === 1 ? 'match' : 'matches'}
            </PrimaryButton>
          </>
        )}
        {view === 'excluded' && (
          <DecidedList
            members={excluded}
            selectedId={selectedId}
            onOpen={onOpen}
            emptyText="No records excluded. Excluding a record keeps it out of this job; open it to undo."
          />
        )}
        {view === 'submitted' && (
          <BatchList emptyText="Nothing submitted yet. Each submission runs as a batch, and batches can run side by side." />
        )}
      </VStack>
    </VStack>
  );
};

/** Students with a decision, one per line, each opening in the workspace to look again. */
const DecidedList = ({
  members,
  selectedId,
  onOpen,
  emptyText,
}: {
  members: GetStudentInputDetailsDto[];
  selectedId: string;
  onOpen: (id: string) => void;
  emptyText: string;
}) => {
  const { decisions } = useReviewSession();
  if (!members.length) {
    return (
      <Box fontSize="0.85rem" opacity="0.75">
        {emptyText}
      </Box>
    );
  }
  return (
    <VStack alignItems="stretch" gap="0">
      {members.map((group) => {
        const decision = decisions.get(group.correlationId);
        const candidate = decision?.kind === 'match' ? decision.candidate : null;
        const isSelected = group.correlationId === selectedId;
        return (
          <HStack
            key={group.correlationId}
            as="button"
            onClick={() => onOpen(group.correlationId)}
            gap="300"
            paddingX="200"
            paddingY="100"
            borderRadius="4px"
            bg={isSelected ? 'blue.500' : undefined}
            _hover={{ bg: isSelected ? 'blue.500' : 'blue.600' }}
            fontSize="0.9rem"
            textAlign="left"
          >
            <OneLine name={studentName(group.inputDetails)} rest={[secondId(group)]} />
            {candidate && (
              <>
                <Box opacity="0.7" aria-label="matched to">
                  →
                </Box>
                <OneLine
                  name={studentName(candidate.rosterDetails)}
                  rest={[
                    valueText(candidate.rosterDetails.birth_date) &&
                      `b. ${valueText(candidate.rosterDetails.birth_date)}`,
                    `ID ${candidate.studentUniqueId}`,
                  ]}
                />
              </>
            )}
          </HStack>
        );
      })}
    </VStack>
  );
};

/** A student in one line: name, then details that fit, then truncated. */
const OneLine = ({ name, rest }: { name: string; rest: (string | null | undefined)[] }) => (
  <Box flex="1" minWidth="0" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
    <Box as="span" fontWeight="600">
      {name}
    </Box>
    <Box as="span" fontSize="0.8rem" opacity="0.75">
      {rest
        .filter(Boolean)
        .map((part) => ` · ${part}`)
        .join('')}
    </Box>
  </Box>
);

/** The summary's counts, each the status filter for its students. */
const overviewTiles: { key: StatusFilter; label: string; statuses: StudentStatus[] }[] = [
  { key: 'to-review', label: 'Needs review', statuses: ['to-review'] },
  { key: 'ready', label: 'Matches to submit', statuses: ['ready'] },
  { key: 'excluded', label: 'Excluded', statuses: ['excluded'] },
  { key: 'submitted', label: 'Submitted', statuses: ['reprocessing', 'reprocessed', 'run-failed'] },
];

/**
 * Progress that says what's left to do, with identity and processing kept
 * apart. Given `onStatusFilter`, each count filters the list to its students.
 */
const Overview = ({
  readyCount,
  onReview,
  statusFilter,
  onStatusFilter,
}: {
  readyCount: number;
  onReview: () => void;
  statusFilter?: StatusFilter | null;
  onStatusFilter?: (key: StatusFilter) => void;
}) => {
  const { groups, statusOf, batches } = useReviewSession();
  const done = useReviewDone();
  const count = (...statuses: StudentStatus[]) =>
    groups.filter((g) => statuses.includes(statusOf(g.correlationId))).length;
  const decided = groups.length - count('to-review', 'run-failed');
  const tooMany = groups.length > USUAL_MAXIMUM;
  const tiles = overviewTiles.map((tile) => ({ ...tile, value: count(...tile.statuses) }));

  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      {tooMany && <TooManyNote count={groups.length} />}
      <HStack justifyContent="space-between" flexWrap="wrap" gap="300">
        <HStack gap="500" flexWrap="wrap">
          {tiles.map((tile) => {
            const isActive = tile.key === statusFilter;
            const filterable = onStatusFilter
              ? {
                  as: 'button' as const,
                  onClick: () => onStatusFilter(tile.key),
                  'aria-pressed': isActive,
                  title: isActive ? 'Show all students' : `Show only ${tile.label.toLowerCase()}`,
                  paddingX: '300',
                  paddingY: '100',
                  marginX: '-300',
                  borderRadius: '6px',
                  borderWidth: '1px',
                  borderColor: isActive ? 'blue.50' : 'transparent',
                  bg: isActive ? 'blue.600' : undefined,
                  _hover: { bg: 'blue.600' },
                  textAlign: 'left' as const,
                }
              : {};
            return (
              <VStack key={tile.key} alignItems="flex-start" gap="0" {...filterable}>
                <Box fontSize="1.3rem" fontWeight="600" lineHeight="1.2">
                  {tile.value}
                </Box>
                <Box fontSize="0.8rem" opacity="0.8">
                  {tile.label}
                </Box>
              </VStack>
            );
          })}
        </HStack>
        <PrimaryButton isDisabled={!readyCount} onClick={onReview}>
          Review and submit {readyCount || ''} {readyCount === 1 ? 'match' : 'matches'}
        </PrimaryButton>
      </HStack>
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
      {batches.length > 0 && (
        <Box paddingTop="200" borderTopWidth="1px" borderColor="blue.50-40">
          <BatchList emptyText="" />
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
      {open && <BatchCard batch={batch} number={number} compact />}
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

const FilterChips = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; count?: number }[];
  value: string | null;
  onChange: (key: string) => void;
}) => (
  <HStack gap="100" flexWrap="wrap" rowGap="100">
    <Box opacity="0.8" marginRight="100" width="100%">
      {label}
    </Box>
    {options.map((option) => (
      <Box
        as="button"
        key={option.key}
        onClick={() => onChange(option.key)}
        paddingX="200"
        paddingY="1px"
        borderRadius="999px"
        borderWidth="1px"
        borderColor={value === option.key ? 'blue.50' : 'blue.50-40'}
        bg={value === option.key ? 'blue.600' : undefined}
        aria-pressed={value === option.key}
      >
        {option.label}
        {option.count !== undefined && ` ${option.count}`}
      </Box>
    ))}
  </HStack>
);

const QueueRow = ({
  group,
  decision,
  status,
  showStatus,
  isSelected,
  onSelect,
}: {
  group: GetStudentInputDetailsDto;
  decision: Decision | undefined;
  status: StudentStatus;
  /** Off when a group heading already says it. */
  showStatus: boolean;
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
      <HStack justifyContent="space-between" gap="200">
        <Box fontWeight="600">{studentName(group.inputDetails)}</Box>
        {showStatus && (
          <Box fontSize="0.75rem" opacity="0.85" whiteSpace="nowrap">
            {statusLabel[status]}
          </Box>
        )}
      </HStack>
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

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Student' },
  { key: 'birth', label: 'Date of birth' },
  { key: 'id', label: 'Local ID' },
  { key: 'suggestions', label: 'Suggestions', numeric: true },
  { key: 'score', label: 'Top match score', numeric: true },
  { key: 'status', label: 'Status' },
];

/** The whole list as a table: click a header to sort, a row to open the student. */
const StudentTable = ({
  queue,
  sort,
  onSort,
  onOpen,
  lastOpened,
  expandedId,
  renderExpanded,
}: {
  queue: GetStudentInputDetailsDto[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  onOpen: (correlationId: string) => void;
  /** The student last open, marked so returning to the table keeps your place. */
  lastOpened: string | null;
  /** Inline: the row whose review pane is open beneath it. */
  expandedId?: string | null;
  renderExpanded?: (group: GetStudentInputDetailsDto) => ReactNode;
}) => {
  const { statusOf, decisions } = useReviewSession();
  const lastRow = useRef<HTMLTableRowElement>(null);
  const inline = !!renderExpanded;
  // Bring the open row to the top when it changes, so its pane is in view.
  useEffect(() => {
    lastRow.current?.scrollIntoView({ block: inline ? 'start' : 'nearest', behavior: 'smooth' });
  }, [inline, lastOpened]);
  if (!queue.length) {
    return (
      <Box padding="200" opacity="0.8" fontSize="0.9rem">
        Nothing matches.
      </Box>
    );
  }
  return (
    <Box {...(inline ? {} : { overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' })}>
      <Table size="sm" sx={{ 'td, th': { paddingX: '200' } }}>
        <Thead position="sticky" top="0" bg="blue.700" zIndex={2}>
          <Tr>
            {columns.map((column) => {
              const active = sort.key === column.key;
              return (
                <Th
                  key={column.key}
                  isNumeric={column.numeric}
                  color="blue.50"
                  textTransform="none"
                  fontSize="0.8rem"
                  aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                >
                  <Box
                    as="button"
                    onClick={() => onSort(column.key)}
                    fontWeight={active ? '700' : '600'}
                    _hover={{ textDecoration: 'underline' }}
                  >
                    {column.label}
                    <Box as="span" marginLeft="100" opacity={active ? 1 : 0.3}>
                      {active && sort.descending ? '↓' : '↑'}
                    </Box>
                  </Box>
                </Th>
              );
            })}
            <Th color="blue.50" textTransform="none" fontSize="0.8rem">
              Match
            </Th>
            {inline && <Th width="1.5rem" />}
          </Tr>
        </Thead>
        <Tbody>
          {queue.map((group) => {
            const status = statusOf(group.correlationId);
            const decision = decisions.get(group.correlationId);
            const suggestions = suggestionsOf(group);
            const score = topScore(group);
            const isLast = group.correlationId === lastOpened;
            const isOpen = inline && group.correlationId === expandedId;
            return (
              <Fragment key={group.correlationId}>
                <Tr
                  ref={isLast ? lastRow : undefined}
                  onClick={() => onOpen(group.correlationId)}
                  onKeyDown={(event) => event.key === 'Enter' && onOpen(group.correlationId)}
                  tabIndex={0}
                  cursor="pointer"
                  // Clear of the sticky header when scrolled to the top.
                  scrollMarginTop="3rem"
                  bg={isOpen ? 'blue.500' : isLast ? 'blue.600' : undefined}
                  _hover={{ bg: isOpen ? 'blue.500' : 'blue.600' }}
                  _focusVisible={{ outline: '2px solid', outlineColor: 'blue.50' }}
                  aria-label={`${isOpen ? 'Close' : 'Open'} ${studentName(group.inputDetails)}`}
                  aria-expanded={inline ? isOpen : undefined}
                >
                  <Td fontWeight="600">{studentName(group.inputDetails)}</Td>
                  <Td>{valueText(group.inputDetails.birth_date) ?? '—'}</Td>
                  <Td>{valueText(group.inputDetails.student_ids) ?? '—'}</Td>
                  <Td isNumeric>{suggestions.length}</Td>
                  <Td isNumeric>{score >= 0 ? score : '—'}</Td>
                  <Td whiteSpace="nowrap">{statusLabel[status]}</Td>
                  <Td whiteSpace="nowrap">
                    {decision?.kind === 'match' ? decision.candidate.studentUniqueId : ''}
                    {status === 'excluded' ? 'excluded' : ''}
                  </Td>
                  {inline && (
                    <Td opacity="0.8" textAlign="center">
                      {isOpen ? '▾' : '▸'}
                    </Td>
                  )}
                </Tr>
                {isOpen && renderExpanded && (
                  <Tr>
                    <Td colSpan={columns.length + 2} padding="0" borderBottomWidth="0">
                      {renderExpanded(group)}
                    </Td>
                  </Tr>
                )}
              </Fragment>
            );
          })}
        </Tbody>
      </Table>
    </Box>
  );
};

/** The review pane opened beneath a row, framed to set it apart from the table around it. */
const InlinePane = ({
  position,
  onPrevious,
  onNext,
  onNextToReview,
  onClose,
  lastAction,
  onDismissAction,
  children,
}: {
  position: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onNextToReview?: () => void;
  onClose: () => void;
  lastAction: LastAction | null;
  onDismissAction: () => void;
  children: ReactNode;
}) => (
  <Box
    marginX="300"
    marginTop="200"
    marginBottom="400"
    padding="400"
    // The page's own surface, so the panel's colors read as they do
    // everywhere else; the frame is what sets it apart from the rows.
    bg="blue.700"
    borderWidth="2px"
    borderColor="blue.200"
    borderRadius="8px"
    boxShadow="0 6px 18px rgba(0,0,0,0.35)"
    // Keys act on this student; Esc closes the pane.
    onKeyDown={(event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea')) return;
      if (event.key === 'Escape') onClose();
      if (event.key === 'j') onNext?.();
      if (event.key === 'k') onPrevious?.();
    }}
    tabIndex={-1}
    outline="none"
    cursor="auto"
    textAlign="left"
    whiteSpace="normal"
    fontWeight="normal"
    // The table's small size would otherwise shrink everything in the pane.
    fontSize="1rem"
  >
    <HStack justifyContent="space-between" marginBottom="300" fontSize="0.85rem" gap="200">
      <Box opacity="0.8">{position}</Box>
      <HStack gap="100">
        <QuietButton size="xs" isDisabled={!onPrevious} onClick={onPrevious}>
          ‹ Previous
        </QuietButton>
        <QuietButton size="xs" isDisabled={!onNext} onClick={onNext}>
          Next ›
        </QuietButton>
        <SecondaryButton size="xs" isDisabled={!onNextToReview} onClick={onNextToReview}>
          Next to review
        </SecondaryButton>
        <QuietButton size="xs" onClick={onClose} aria-label="Close">
          ✕
        </QuietButton>
      </HStack>
    </HStack>
    {lastAction && <LastActionBar action={lastAction} onDismiss={onDismissAction} />}
    {children}
  </Box>
);

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
          {/* The count matters when a suggestion is past the fold. */}
          <Box fontSize="0.85rem" opacity="0.8">
            {`${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}`}
          </Box>
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
                Then search the roster, or exclude the record.
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

const rosterDetailsKey = 'runway.match-review-prototype.roster-details';

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
  const [orientation] = useOrientation();
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

  // Rows: each candidate is a band across the fields, under the file's record.
  const fields = rows.filter((row) => !row.rosterOnly || showRosterOnly);
  const rowBand = (c: Candidate, edge: 'first' | 'middle' | 'last') => {
    const isSaved = saved === c.studentUniqueId;
    const line = 'var(--chakra-colors-green-100)';
    const shadows = isSaved
      ? [
          `inset 0 2px 0 ${line}`,
          `inset 0 -2px 0 ${line}`,
          edge === 'first' && `inset 2px 0 0 ${line}`,
          edge === 'last' && `inset -2px 0 0 ${line}`,
        ].filter(Boolean)
      : [];
    return {
      bg: 'blue.600',
      borderBottomWidth: '0',
      borderLeftRadius: edge === 'first' ? '8px' : undefined,
      borderRightRadius: edge === 'last' ? '8px' : undefined,
      boxShadow: shadows.length ? shadows.join(', ') : undefined,
    };
  };
  const rowsTable = (
    <Box overflowX="auto">
      <Table
        size="sm"
        sx={{
          // Separate rows, so each candidate's band has space around it.
          borderCollapse: 'separate',
          borderSpacing: '0 0.5rem',
          td: { paddingX: '200', paddingY: '200', verticalAlign: 'top', borderColor: 'blue.50-40' },
          th: { paddingX: '200' },
        }}
      >
        <Thead>
          <Tr>
            <Th />
            {fields.map((row) => (
              <Th
                key={row.label}
                color="blue.50"
                textTransform="none"
                fontSize="0.8rem"
                whiteSpace="nowrap"
              >
                {row.label}
              </Th>
            ))}
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td fontWeight="600" whiteSpace="nowrap">
              In your file
            </Td>
            {fields.map((row) => (
              <Td key={row.label}>
                {fileValue[row.label] ?? <Missing compared={!row.rosterOnly} />}
              </Td>
            ))}
            <Td />
          </Tr>
          {shown.map((c, i) => (
            <Tr key={c.studentUniqueId}>
              <Td {...rowBand(c, 'first')} whiteSpace="nowrap">
                <HStack gap="100" fontWeight="600">
                  <Box>{c.studentUniqueId}</Box>
                  <CopyButton value={c.studentUniqueId} />
                </HStack>
                <Box fontSize="0.75rem" opacity="0.8">
                  {c.source === 'search' ? 'Found by your search' : 'Suggestion'}
                  {c.score !== null && ` · score ${c.score}`}
                </Box>
              </Td>
              {fields.map((row) => {
                const value = row.roster(c.rosterDetails);
                return (
                  <Td key={row.label} {...rowBand(c, 'middle')}>
                    <HStack gap="100" alignItems="baseline">
                      {row.compared && <AgreementMark agreement={agreementOf(row.label, i)} />}
                      <Box>{value ?? <Missing compared={!row.rosterOnly} />}</Box>
                    </HStack>
                  </Td>
                );
              })}
              <Td {...rowBand(c, 'last')} whiteSpace="nowrap">
                {saved === c.studentUniqueId ? (
                  <Box fontWeight="600" color="green.100" paddingY="100">
                    ✓ Saved match
                  </Box>
                ) : (
                  onUse && (
                    <PrimaryButton size="sm" onClick={() => onUse(c)}>
                      {c.source === 'search' ? 'Use this student' : 'Use suggestion'}
                    </PrimaryButton>
                  )
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
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
      {orientation === 'rows' && (
        <>
          <QuietButton
            size="xs"
            alignSelf="flex-start"
            paddingX="0"
            onClick={() => setShowRosterOnly(!showRosterOnly)}
            aria-expanded={showRosterOnly}
          >
            {showRosterOnly ? '▾' : '▸'} Roster details: middle name, school years
          </QuietButton>
          {rowsTable}
        </>
      )}
      {orientation === 'columns' && (
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
                      {c.source === 'search' ? 'Found by your search' : 'Suggestion'}
                      {c.score !== null && ` · match score ${c.score}`}
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
                  <Box as="span" fontSize="0.75rem" opacity="0.6" marginLeft="200">
                    middle name, school years
                  </Box>
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
      )}
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
  const { roster, searchOf, setSearch } = useReviewSession();
  const remembered = searchOf(group.correlationId);
  const [terms, setTerms] = useState<SearchTerms>(
    remembered?.terms ?? termsFrom(group.inputDetails)
  );
  const [searching, setSearching] = useState(false);
  const hits = remembered?.hits ?? null;

  const run = async () => {
    setSearching(true);
    const found = await searchRoster(roster, terms);
    setSearch(group.correlationId, { terms, hits: found });
    setSearching(false);
  };
  const field = (key: keyof SearchTerms, label: string, placeholder?: string) => (
    <SearchField
      id={`search-${key}-${group.correlationId}`}
      label={label}
      value={terms[key]}
      placeholder={placeholder}
      onChange={(value) => setTerms({ ...terms, [key]: value })}
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
          Results are compared with your file, not with these search terms. Prototype: a pretend
          roster.
        </Box>
      </HStack>
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
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setSent(false);
      setConflict(false);
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
                Nothing was submitted. Some of these matches changed since this page loaded them,
                perhaps by another reviewer. Refresh to see the latest, then submit again.
              </Box>
              <SecondaryButton onClick={() => window.location.reload()}>Refresh</SecondaryButton>
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
            onClick={() => {
              setSent(true);
              const result = submit(ready.map((g) => g.correlationId));
              if (result.ok) onClose();
              else setConflict(true);
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

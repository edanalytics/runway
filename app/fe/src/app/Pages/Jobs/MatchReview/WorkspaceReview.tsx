import {
  Box,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
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
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { KeyboardEvent, ReactNode, useEffect, useState } from 'react';
import { Agreement, compare } from './compare';
import {
  AgreementMark,
  BatchCard,
  ComparisonTable,
  DesignIntro,
  PrimaryButton,
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

const CopyButton = ({ value, label = 'Copy' }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <QuietButton
      size="xs"
      onClick={() => {
        copy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={`Copy ${value}`}
    >
      {copied ? 'Copied' : label}
    </QuietButton>
  );
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// The workspace ---------------------------------------------------------------

const selectedKey = (jobId: number) => `runway.match-review-prototype.${jobId}.selected`;

export const WorkspaceReview = () => {
  const { job, groups, isLoading, isError, statusOf, decisions } = useReviewSession();
  // null means that filter is off. Clicking the active chip turns it off.
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>('open');
  const [countFilter, setCountFilter] = useState<CountFilter | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(selectedKey(job.id));
    } catch {
      return null;
    }
  });
  const setSelectedId = (id: string | null) => {
    setSelectedIdState(id);
    try {
      if (id) window.localStorage.setItem(selectedKey(job.id), id);
    } catch {
      // A remembered place is a convenience.
    }
  };
  const [query, setQuery] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);

  const includes = statusFilters.find((f) => f.key === statusFilter)?.includes;
  const countTest = countFilters.find((f) => f.key === countFilter)?.test ?? (() => true);
  const terms = query.trim().toLowerCase();
  const queue = groups.filter(
    (g) =>
      (!includes || includes.includes(statusOf(g.correlationId))) &&
      countTest(suggestionsOf(g).length) &&
      (!terms || searchText(g).includes(terms))
  );
  const filtered = statusFilter !== 'open' || countFilter !== null || !!terms;
  const clearFilters = () => {
    setStatusFilter('open');
    setCountFilter(null);
    setQuery('');
  };

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const selected = groups.find((g) => g.correlationId === selectedId) ?? queue[0] ?? groups[0];
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');

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

  return (
    <VStack alignItems="stretch" width="100%" gap="400">
      <DesignIntro
        title="Review workspace"
        bet="Following the design review: one queue and one workspace, built for a defensible choice first. Save a match, or exclude a record from this job, mostly for junk data; submit saved matches when you reach a stopping point. Keyboard: j/k to move, s to save, x to exclude."
      />
      <Overview onReview={() => setReviewing(true)} readyCount={ready.length} />

      <HStack alignItems="flex-start" gap="400" width="100%">
        <VStack
          width="20rem"
          flexShrink={0}
          alignItems="stretch"
          layerStyle="contentBox"
          padding="300"
          gap="300"
        >
          <Input
            id="workspace-queue-search"
            size="sm"
            placeholder="Search by name, birth date or ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search the list"
          />
          <VStack alignItems="stretch" gap="200" fontSize="0.8rem">
            <FilterChips
              label="Show"
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
              onChange={(key) =>
                setStatusFilter(key === statusFilter ? null : (key as StatusFilter))
              }
            />
            <FilterChips
              label="Suggestions"
              options={countFilters.map(({ key, label }) => ({ key, label }))}
              value={countFilter}
              onChange={(key) => setCountFilter(key === countFilter ? null : (key as CountFilter))}
            />
          </VStack>
          <HStack justifyContent="space-between" fontSize="0.8rem" opacity="0.8">
            <Box>
              {queue.length} of {groups.length} students
            </Box>
            {filtered && (
              <QuietButton size="xs" onClick={clearFilters}>
                Clear filters
              </QuietButton>
            )}
          </HStack>
          <VStack alignItems="stretch" gap="0" maxHeight="60vh" overflowY="auto" marginX="-200">
            {queue.length === 0 && (
              <Box padding="200" opacity="0.8" fontSize="0.9rem">
                Nothing matches.{' '}
                <QuietButton size="xs" onClick={clearFilters}>
                  Clear filters
                </QuietButton>
              </Box>
            )}
            {queue.map((group) => (
              <QueueRow
                key={group.correlationId}
                group={group}
                decision={decisions.get(group.correlationId)}
                status={statusOf(group.correlationId)}
                isSelected={group.correlationId === selected.correlationId}
                onSelect={() => setSelectedId(group.correlationId)}
              />
            ))}
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
          {lastAction && (
            <LastActionBar action={lastAction} onDismiss={() => setLastAction(null)} />
          )}
          <Workspace
            key={selected.correlationId}
            group={selected}
            onSaved={(action) => {
              setLastAction(action);
              if (action.advance) advance(selected.correlationId);
            }}
          />
        </Box>
      </HStack>

      <PrototypeControls />

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

/** Progress that says what's left to do, with identity and processing kept apart. */
const Overview = ({ readyCount, onReview }: { readyCount: number; onReview: () => void }) => {
  const { groups, statusOf, batches } = useReviewSession();
  const count = (...statuses: StudentStatus[]) =>
    groups.filter((g) => statuses.includes(statusOf(g.correlationId))).length;
  const tiles: { label: string; value: number }[] = [
    { label: 'Needs review', value: count('to-review') },
    { label: 'Matches to submit', value: readyCount },
    { label: 'Excluded', value: count('excluded') },
    { label: 'Submitted', value: count('reprocessing', 'reprocessed', 'run-failed') },
  ];

  return (
    <VStack alignItems="stretch" gap="200" layerStyle="contentBox" padding="300">
      <HStack justifyContent="space-between" flexWrap="wrap" gap="300">
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
        <PrimaryButton isDisabled={!readyCount} onClick={onReview}>
          Review and submit {readyCount || ''} {readyCount === 1 ? 'match' : 'matches'}
        </PrimaryButton>
      </HStack>
      {batches.length > 0 && (
        <VStack
          alignItems="stretch"
          gap="100"
          paddingTop="200"
          borderTopWidth="1px"
          borderColor="blue.50-40"
        >
          {[...batches].reverse().map((batch) => (
            <BatchSummary key={batch.id} batch={batch} number={batches.indexOf(batch) + 1} />
          ))}
          {batches.some((b) => b.status === 'complete with errors' || b.status === 'failed') && (
            <SupportPath batches={batches} />
          )}
        </VStack>
      )}
    </VStack>
  );
};

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
  return (
    <VStack
      as="button"
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
        <Box fontSize="0.75rem" opacity="0.85" whiteSpace="nowrap">
          {statusLabel[status]}
        </Box>
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

  // The candidate the reviewer has selected but not yet saved. Never defaulted.
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [found, setFound] = useState<Candidate | null>(
    decision?.kind === 'match' && decision.candidate.source === 'search' ? decision.candidate : null
  );
  const [confirmingExclude, setConfirmingExclude] = useState(false);
  const [searching, setSearching] = useState(suggestions.length === 0);

  const candidates =
    found && !suggestions.some((c) => c.studentUniqueId === found.studentUniqueId)
      ? [...suggestions, found]
      : suggestions;
  const saved = decision?.kind === 'match' ? decision.candidate.studentUniqueId : null;
  const name = studentName(group.inputDetails);

  // Restoring the prior decision is what makes an undo trustworthy.
  const restore = (previous: Decision | undefined) => () =>
    previous ? decide(id, previous) : undo(id);

  const save = () => {
    if (!selected) return;
    const previous = decision;
    decide(id, { kind: 'match', candidate: selected });
    onSaved({
      message: `Saved ${selected.studentUniqueId} as the match for ${name}.`,
      undo: restore(previous),
      advance: true,
    });
  };
  const exclude = () => {
    const previous = decision;
    decide(id, { kind: 'not-in-roster' });
    setConfirmingExclude(false);
    onSaved({ message: `Excluded ${name} from this job.`, undo: restore(previous), advance: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea') || isSubmitted) return;
    if (event.key === 's') save();
    if (event.key === 'x') setConfirmingExclude(true);
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

      <VStack alignItems="stretch" gap="200">
        {/* The count matters when a suggestion is past the fold. */}
        <Box fontSize="0.85rem" opacity="0.8">
          {suggestions.length === 0
            ? 'No suggestions'
            : `${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}`}
        </Box>
        {candidates.length > 0 && (
          <EvidenceTable
            group={group}
            candidates={candidates}
            selected={selected?.studentUniqueId ?? null}
            saved={saved}
            onSelect={isSubmitted ? undefined : setSelected}
          />
        )}
      </VStack>

      {!isSubmitted && (
        <VStack alignItems="stretch" gap="200">
          <SecondaryButton alignSelf="flex-start" onClick={() => setSearching(!searching)}>
            {searching ? 'Hide roster search' : 'Search the roster'}
          </SecondaryButton>
          {searching && (
            <Search
              group={group}
              onSelect={(candidate) => {
                setFound(candidate);
                setSelected(candidate);
              }}
            />
          )}
        </VStack>
      )}

      {!isSubmitted && (
        <VStack
          alignItems="stretch"
          gap="300"
          paddingTop="300"
          borderTopWidth="1px"
          borderColor="blue.50-40"
        >
          {confirmingExclude ? (
            <VStack
              alignItems="stretch"
              gap="200"
              padding="300"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="pink.100"
            >
              <Box fontSize="0.9rem">
                Exclude {name} from this job? Use this for junk data, or a student who isn't in the
                roster. Their records won't be reprocessed. You can undo it, and it doesn't carry
                over to other jobs.
              </Box>
              <HStack gap="200">
                <SecondaryButton borderColor="pink.100" color="pink.100" onClick={exclude}>
                  Exclude from this job
                </SecondaryButton>
                <QuietButton onClick={() => setConfirmingExclude(false)}>Cancel</QuietButton>
              </HStack>
            </VStack>
          ) : (
            // The same actions, in the same places, for every record.
            <HStack gap="300" flexWrap="wrap">
              <QuietButton color="pink.100" onClick={() => setConfirmingExclude(true)}>
                Exclude from this job… (x)
              </QuietButton>
              <Box flex="1" />
              {decision && (
                <QuietButton
                  onClick={() => {
                    const previous = decision;
                    undo(id);
                    onSaved({
                      message: `Cleared the decision for ${name}.`,
                      undo: restore(previous),
                      advance: false,
                    });
                  }}
                >
                  Clear decision
                </QuietButton>
              )}
              <PrimaryButton
                isDisabled={!selected || selected.studentUniqueId === saved}
                onClick={save}
              >
                {selected
                  ? `Save match: ${selected.studentUniqueId} (s)`
                  : 'Select a student to save a match'}
              </PrimaryButton>
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
  /** Compared rows get marks; roster-only rows are shown for context. */
  compared: boolean;
};

const rows: Row[] = [
  { label: 'First name', file: null, roster: (r) => valueText(r.first_name), compared: true },
  { label: 'Last name', file: null, roster: (r) => valueText(r.last_name), compared: true },
  { label: 'Date of birth', file: null, roster: (r) => valueText(r.birth_date), compared: true },
  { label: 'Middle name', file: null, roster: (r) => valueText(r.middle_name), compared: false },
  { label: 'Student IDs', file: null, roster: (r) => valueText(r.student_ids), compared: false },
  { label: 'School years', file: null, roster: (r) => valueText(r.school_years), compared: false },
];

const MAX_COMPARED = 3;

/**
 * The file against every candidate, aligned, so the eye runs across a row.
 * Nothing is hidden: a conflict all candidates share stays in view, and
 * roster-only details are shown even with nothing to compare them to.
 */
const EvidenceTable = ({
  group,
  candidates,
  selected,
  saved,
  onSelect,
}: {
  group: GetStudentInputDetailsDto;
  candidates: Candidate[];
  selected: string | null;
  saved: string | null;
  onSelect?: (candidate: Candidate) => void;
}) => {
  // Details only the roster has are a click away, so the compared rows read cleanly.
  const [showRosterOnly, setShowRosterOnly] = useState(false);
  // With many candidates, compare a shortlist; the full list stays one click away.
  const [shortlist, setShortlist] = useState<string[]>(() =>
    candidates.slice(0, MAX_COMPARED).map((c) => c.studentUniqueId)
  );
  useEffect(() => {
    const last = candidates[candidates.length - 1];
    if (last?.source === 'search' && !shortlist.includes(last.studentUniqueId)) {
      setShortlist((list) => [...list.slice(-(MAX_COMPARED - 1)), last.studentUniqueId]);
    }
  }, [candidates, shortlist]);
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
          sx={{ td: { paddingX: '200', verticalAlign: 'top' }, th: { paddingX: '200' } }}
        >
          <Thead>
            <Tr>
              <Th />
              <Th color="blue.50" textTransform="none" fontSize="0.8rem">
                In your file
              </Th>
              {shown.map((c) => {
                const isSelected = selected === c.studentUniqueId;
                return (
                  <Th
                    key={c.studentUniqueId}
                    color="blue.50"
                    textTransform="none"
                    fontSize="0.8rem"
                    bg={isSelected ? 'blue.600' : undefined}
                    borderTopRadius="6px"
                  >
                    <HStack gap="100">
                      <Box>{c.studentUniqueId}</Box>
                      <CopyButton value={c.studentUniqueId} />
                    </HStack>
                    <Box fontWeight="normal" opacity="0.8">
                      {c.source === 'search' ? 'Found by your search' : 'Suggestion'}
                      {saved === c.studentUniqueId && ' · saved match'}
                    </Box>
                  </Th>
                );
              })}
            </Tr>
          </Thead>
          <Tbody>
            {rows
              .filter((row) => row.compared || showRosterOnly)
              .map((row) => (
                <Tr key={row.label}>
                  <Td whiteSpace="nowrap" opacity="0.85">
                    {row.label}
                  </Td>
                  <Td>{fileValue[row.label] ?? <Missing compared={row.compared} />}</Td>
                  {shown.map((c, i) => {
                    const value = row.roster(c.rosterDetails);
                    return (
                      <Td
                        key={c.studentUniqueId}
                        bg={selected === c.studentUniqueId ? 'blue.600' : undefined}
                      >
                        <HStack gap="100" alignItems="baseline">
                          {row.compared && <AgreementMark agreement={agreementOf(row.label, i)} />}
                          <Box>{value ?? <Missing compared={row.compared} />}</Box>
                        </HStack>
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            <Tr>
              <Td colSpan={2 + shown.length} paddingY="100">
                <QuietButton
                  size="xs"
                  paddingX="0"
                  onClick={() => setShowRosterOnly(!showRosterOnly)}
                  aria-expanded={showRosterOnly}
                >
                  {showRosterOnly ? '▾ Hide roster details' : '▸ Roster details'}
                </QuietButton>
                <Box as="span" fontSize="0.75rem" opacity="0.6" marginLeft="200">
                  middle name, student IDs, school years · shown, not compared
                </Box>
              </Td>
            </Tr>
            <Tr>
              <Td opacity="0.85" fontSize="0.8rem">
                Match score
              </Td>
              <Td />
              {shown.map((c) => (
                <Td
                  key={c.studentUniqueId}
                  fontSize="0.8rem"
                  opacity="0.85"
                  bg={selected === c.studentUniqueId ? 'blue.600' : undefined}
                >
                  {c.score ?? '—'}
                </Td>
              ))}
            </Tr>
            {onSelect && (
              <Tr>
                <Td />
                <Td />
                {shown.map((c) => {
                  const isSelected = selected === c.studentUniqueId;
                  return (
                    <Td
                      key={c.studentUniqueId}
                      bg={isSelected ? 'blue.600' : undefined}
                      borderBottomRadius="6px"
                    >
                      {isSelected ? (
                        <PrimaryButton aria-pressed onClick={() => onSelect(c)}>
                          ✓ Selected
                        </PrimaryButton>
                      ) : (
                        <SecondaryButton aria-pressed={false} onClick={() => onSelect(c)}>
                          Select
                        </SecondaryButton>
                      )}
                    </Td>
                  );
                })}
              </Tr>
            )}
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
  onSelect,
}: {
  group: GetStudentInputDetailsDto;
  onSelect: (candidate: Candidate) => void;
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
    <FormControl>
      <FormLabel
        fontSize="0.8rem"
        marginBottom="100"
        htmlFor={`search-${key}-${group.correlationId}`}
      >
        {label}
      </FormLabel>
      <Input
        id={`search-${key}-${group.correlationId}`}
        size="sm"
        value={terms[key]}
        placeholder={placeholder}
        onChange={(event) => setTerms({ ...terms, [key]: event.target.value })}
        onKeyDown={(event) => event.key === 'Enter' && run()}
      />
    </FormControl>
  );

  return (
    <VStack alignItems="stretch" gap="300" padding="300" borderRadius="6px" bg="blue.600">
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="200">
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('birth_date', 'Date of birth', 'YYYY-MM-DD')}
        {field('student_unique_id', 'Student unique ID', 'finds exactly one')}
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
      {hits && !searching && (
        <VStack alignItems="stretch" gap="200">
          {hits.length === 0 && <Box>No one in the roster matches those details.</Box>}
          {hits.map((hit) => (
            <HStack
              key={hit.studentUniqueId}
              alignItems="flex-start"
              gap="300"
              padding="200"
              borderRadius="4px"
              bg="blue.700"
            >
              <Box flex="1" minWidth="0">
                <ComparisonTable
                  comparison={compare(group.inputDetails, hit.rosterDetails)}
                  rosterHeading={`${hit.studentUniqueId} · search score ${hit.score}`}
                />
              </Box>
              <SecondaryButton
                onClick={() =>
                  onSelect({
                    studentUniqueId: hit.studentUniqueId,
                    rosterDetails: hit.rosterDetails,
                    score: hit.score,
                    source: 'search',
                  })
                }
              >
                Add to comparison
              </SecondaryButton>
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
};

// Submitting -------------------------------------------------------------------

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
                      <Box fontWeight="600">{studentName(group.inputDetails)}</Box>
                      <Box fontSize="0.75rem" opacity="0.8">
                        {secondId(group)}
                      </Box>
                    </Td>
                    <Td>
                      <Box>{candidate?.studentUniqueId}</Box>
                      <Box fontSize="0.75rem" opacity="0.8">
                        {candidate && studentName(candidate.rosterDetails)}
                        {candidate?.source === 'search' && ' · found by search'}
                      </Box>
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

const PrototypeControls = () => {
  const {
    groups,
    statusOf,
    decide,
    failNextRun,
    setFailNextRun,
    conflictNextSubmit,
    setConflictNextSubmit,
  } = useReviewSession();
  // Someone else saving the top suggestion for a student still needing review.
  const other = groups.find(
    (g) => statusOf(g.correlationId) === 'to-review' && suggestionsOf(g).length > 0
  );
  return (
    <VStack alignItems="flex-start" fontSize="0.8rem" opacity="0.75" gap="100">
      <HStack gap="300" flexWrap="wrap">
        <Box>Prototype:</Box>
        <Checkbox
          size="sm"
          isChecked={failNextRun}
          onChange={(e) => setFailNextRun(e.target.checked)}
        >
          Next batch's run fails outright
        </Checkbox>
        <Checkbox
          size="sm"
          isChecked={conflictNextSubmit}
          onChange={(e) => setConflictNextSubmit(e.target.checked)}
        >
          Next submission finds a conflicting change
        </Checkbox>
        <QuietButton
          size="xs"
          isDisabled={!other}
          onClick={() =>
            other &&
            decide(
              other.correlationId,
              { kind: 'match', candidate: suggestionsOf(other)[0] },
              'another reviewer'
            )
          }
        >
          Another reviewer saves a match
        </QuietButton>
      </HStack>
      <Box>Decisions persist in this browser; reload to try leaving and coming back.</Box>
    </VStack>
  );
};

import {
  Box,
  Checkbox,
  HStack,
  SimpleGrid,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useToast,
  VStack,
} from '@chakra-ui/react';
import {
  GetStudentInputDetailsDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { compare, isComparedField } from './compare';
import {
  AgreementMark,
  PrimaryButton,
  NoSuggestionFits,
  SearchField,
  QuietButton,
  SecondaryButton,
  studentName,
  secondId,
  dateTime,
  CopyButton,
  CrossYearCue,
  deciderName,
  matchedCandidate,
  suggestionsOf,
} from './components';
import { valueText } from './values';
import { useMe } from '../../../api/queries/me.queries';
import { ContactSupport } from '../../../components/SupportButton';
import { termsFrom, SearchTerms } from './search';
import { Candidate, DecisionChoice, DecisionResult, useReviewSession } from './reviewSession';
import { outcomeLabel, sendRunOutcome, submissionNumber, submissionReference } from './sendRun';

const realDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Missing or invalid values in the file: clues, not a diagnosis of IDRS. */
const fileIssues = (student: GetStudentInputDetailsDto) => {
  const d = student.inputDetails;
  const issues: string[] = [];
  if (!valueText(d.first_name)) issues.push('No first name in your file.');
  if (!valueText(d.last_name)) issues.push('No last name in your file.');
  if (!valueText(d.birth_date)) issues.push('No date of birth in your file.');
  else if (typeof d.birth_date === 'string' && !realDate(d.birth_date))
    issues.push(`Date of birth ${d.birth_date} isn't a valid date.`);
  return issues;
};

/** A saved decision, as the page reports it, with a way to undo it. */
export type LastAction = {
  correlationId: string;
  message: string;
  undo: () => Promise<DecisionResult>;
  advance: boolean;
};

export const LastActionBar = ({
  action,
  onDismiss,
}: {
  action: LastAction;
  onDismiss: () => void;
}) => {
  const { students } = useReviewSession();
  const canUndo = students.some(
    (student) => student.correlationId === action.correlationId && student.sendRunId === null
  );
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentAction = useRef<LastAction | null>(action);
  // A new action has its own Undo state. Ignore the old request if its
  // action was replaced or the banner was dismissed while it was pending.
  useEffect(() => {
    currentAction.current = action;
    setUndoing(false);
    setError(null);
    return () => {
      currentAction.current = null;
    };
  }, [action]);
  return (
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
      <Box fontSize="0.9rem">
        {error ? `Couldn't undo that: ${error} The page has been refreshed.` : action.message}
      </Box>
      <HStack gap="100">
        {!error && canUndo && (
          <QuietButton
            isLoading={undoing}
            onClick={async () => {
              setUndoing(true);
              const result = await action.undo();
              if (currentAction.current !== action) return;
              setUndoing(false);
              if (result.ok) onDismiss();
              else setError(result.message);
            }}
          >
            Undo
          </QuietButton>
        )}
        <QuietButton onClick={onDismiss} aria-label="Dismiss">
          ✕
        </QuietButton>
      </HStack>
    </HStack>
  );
};

export const StudentPane = ({
  student,
  onSaved,
}: {
  student: GetStudentInputDetailsDto;
  onSaved: (action: LastAction) => void;
}) => {
  const { decide, clear } = useReviewSession();
  const toast = useToast();
  const { correlationId: id, decision } = student;
  // Once a student's match is in a send run, failed or not, they take no new
  // decision (Decisions Log #46): a failed one's remedy is its submission's.
  const isSubmitted = student.sendRunId !== null;
  const suggestions = suggestionsOf(student);

  // Saying none fit stays on this student and opens search and exclude.
  const [noneFit, setNoneFit] = useState(false);

  const matched = matchedCandidate(student);
  // A match found by searching stays in view beside the suggestions.
  const fromSearch = matched?.source === 'search' ? matched : null;
  const candidates =
    fromSearch && !suggestions.some((c) => c.studentUniqueId === fromSearch.studentUniqueId)
      ? [...suggestions, fromSearch]
      : suggestions;
  const matchedId = matched?.studentUniqueId ?? null;
  const name = studentName(student.inputDetails);

  // Why the last write was refused, shown here on the student.
  const [error, setError] = useState<string | null>(null);
  // Whether this student is still the one shown: the pane is keyed by
  // student, so it unmounts when the reviewer moves on.
  const shown = useRef(true);
  const saving = useRef(false);
  const [pending, setPending] = useState<{ candidateId?: string } | null>(null);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  /**
   * Waits for a write: only once it's saved does the page say so, offer an
   * undo and move on. Restoring the prior decision is what makes an undo
   * trustworthy. It replaces the version this write produced, so a change
   * by someone else since is refused rather than overwritten.
   */
  const save = async (
    write: (onSaved: (version: number | null) => void) => Promise<DecisionResult>,
    action: { message: string; advance: boolean; candidateId?: string }
  ) => {
    if (saving.current) return false;
    saving.current = true;
    setPending({ candidateId: action.candidateId });
    const previous: DecisionChoice | null = matched
      ? { kind: 'match', candidate: matched }
      : decision?.kind === 'exclude'
      ? { kind: 'exclude' }
      : null;
    setError(null);
    const result = await write((version) => {
      // The session calls this alongside the cache update, so the saved
      // student never paints between the response and moving to the next.
      if (!shown.current) return;
      onSaved({
        correlationId: id,
        message: action.message,
        advance: action.advance,
        undo: () => (previous ? decide(id, previous, version) : clear(id, version)),
      });
    });
    saving.current = false;
    if (shown.current) setPending(null);
    if (!result.ok) {
      // Once the reviewer has moved to another student, this pane is gone,
      // so a toast reports the refusal instead, naming no one.
      if (shown.current) setError(result.message);
      else
        toast({
          status: 'error',
          title: 'A decision you made couldn’t be saved',
          description: `${result.message} The list has been refreshed.`,
          isClosable: true,
        });
      return false;
    }
    return true;
  };

  // One step: the submit list is where matches get their second look.
  const use = (candidate: Candidate) =>
    save(
      (onSaved) => decide(id, { kind: 'match', candidate }, decision?.version ?? null, onSaved),
      {
        message: `Saved ${candidate.studentUniqueId} as the match for ${name}.`,
        advance: true,
        candidateId: candidate.studentUniqueId,
      }
    );
  const clearDecision = () =>
    save((onSaved) => clear(id, decision?.version ?? null, onSaved), {
      message: `Cleared the decision for ${name}.`,
      advance: false,
    });
  const exclude = async () => {
    const saved = await save(
      (onSaved) => decide(id, { kind: 'exclude' }, decision?.version ?? null, onSaved),
      {
        message: `Excluded ${name} from this job.`,
        advance: true,
      }
    );
    if (saved) setNoneFit(false);
  };

  const issues = fileIssues(student);

  return (
    <VStack
      as="fieldset"
      disabled={!!pending}
      aria-busy={!!pending}
      minWidth="0"
      padding="0"
      margin="0"
      border="0"
      alignItems="stretch"
      gap="400"
    >
      {/* The source record stays put while everything else changes. */}
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          From your file
        </Box>
        <HStack gap="300" alignItems="baseline" flexWrap="wrap">
          <Box textStyle="h4">{name}</Box>
          <Box opacity="0.85">{secondId(student)}</Box>
        </HStack>
        {issues.map((issue) => (
          <Box key={issue} fontSize="0.85rem" color="purple.200">
            {issue}
          </Box>
        ))}
      </VStack>

      <DecisionState student={student} />

      {error && (
        <Box
          padding="300"
          borderRadius="6px"
          borderWidth="1px"
          borderColor="pink.100"
          fontSize="0.9rem"
          role="alert"
        >
          Couldn't save that: {error} The page has been refreshed.
        </Box>
      )}

      {(noneFit || (!isSubmitted && candidates.length === 0)) && !isSubmitted ? (
        <NoSuggestionFits
          suggestionCount={suggestions.length}
          onBack={candidates.length ? () => setNoneFit(false) : undefined}
          onExclude={exclude}
          search={
            <Search
              student={student}
              matchedId={matchedId}
              onUse={use}
              savingMatchId={pending?.candidateId}
            />
          }
        >
          {decision && (
            <QuietButton alignSelf="flex-start" onClick={clearDecision}>
              Clear decision
            </QuietButton>
          )}
        </NoSuggestionFits>
      ) : (
        <VStack alignItems="stretch" gap="200">
          <EvidenceTable
            student={student}
            candidates={candidates}
            matchedId={matchedId}
            onUse={isSubmitted ? undefined : use}
            savingMatchId={pending?.candidateId}
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
              {decision && <QuietButton onClick={clearDecision}>Clear decision</QuietButton>}
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
};

/** What's been decided and what's happened since, kept apart. */
const DecisionState = ({ student }: { student: GetStudentInputDetailsDto }) => {
  const { job, sendRuns } = useReviewSession();
  const { data: me } = useMe();
  const { status, decision } = student;
  const matched = matchedCandidate(student);
  // The submission that decides the student's status, once they've been submitted.
  const sendRun = sendRuns.find(({ id }) => id === student.sendRunId);
  const by = decision
    ? ` by ${deciderName(decision, me?.user?.id)} on ${dateTime(decision.decidedOn)}`
    : '';
  let body: ReactNode = null;
  if (status === 'ready' && matched) {
    body = `Match saved${by}: ${matched.studentUniqueId}${
      matched.source === 'search' ? ', found by searching' : ''
    }. Not submitted yet.`;
  } else if (status === 'excluded') {
    body = `Excluded from this job${by}. Its records won't be reprocessed.`;
  } else if (sendRun) {
    // No decision can follow a send, so the current one is what was sent.
    const chosen = matched?.studentUniqueId;
    const number = submissionNumber(sendRuns, sendRun);
    const outcome = sendRunOutcome(sendRun, job.template.reportResources);
    body = (
      <VStack alignItems="flex-start" gap="100">
        <Box>
          Sent in submission {number}
          {chosen ? ` with ${chosen}` : ''} · {outcomeLabel[outcome]}.
        </Box>
        {status === 'run-failed' ? (
          <Box fontSize="0.85rem" opacity="0.85">
            Reprocessing failed for that submission. The match still stands. Submission {number},
            above, is where to contact support or send its students again.
          </Box>
        ) : (
          <HStack fontSize="0.85rem" gap="300" flexWrap="wrap" justifyContent="space-between">
            <Box flex="1" minWidth="16rem" opacity="0.85">
              Correcting a submitted identity isn't supported here yet. To report a wrong match,
              contact support.
            </Box>
            <ContactSupport
              message={`${submissionReference(job.id, number, sendRun)}: reporting a wrong match`}
            />
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
      {matched && (
        <Box marginTop="100">
          <CrossYearCue rosterDetails={matched.rosterDetails} />
        </Box>
      )}
    </Box>
  );
};

/**
 * A row of the evidence table: a field of the roster's details, and of the
 * file's too unless only the roster has it. Rows for compared fields get marks.
 */
type Row = { label: string } & (
  | { field: keyof StudentInputDetailsJson & keyof StudentRosterDetailsJson; rosterOnly: false }
  /** Only the roster has these; they're a click away. */
  | {
      field: Exclude<keyof StudentRosterDetailsJson, keyof StudentInputDetailsJson>;
      rosterOnly: true;
    }
);

const rows: Row[] = [
  { field: 'first_name', label: 'First name', rosterOnly: false },
  { field: 'last_name', label: 'Last name', rosterOnly: false },
  { field: 'birth_date', label: 'Date of birth', rosterOnly: false },
  // Both sides have IDs, but usually from different ID systems (the roster's
  // are typed), so they're shown side by side without a mark.
  { field: 'student_ids', label: 'Student IDs', rosterOnly: false },
  { field: 'middle_name', label: 'Middle name', rosterOnly: true },
  { field: 'school_years', label: 'School years', rosterOnly: true },
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
  student,
  candidates,
  matchedId,
  onUse,
  savingMatchId,
}: {
  student: GetStudentInputDetailsDto;
  candidates: Candidate[];
  matchedId: string | null;
  onUse?: (candidate: Candidate) => void;
  savingMatchId?: string;
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
  const comparisons = shown.map((c) => compare(student.inputDetails, c.rosterDetails));
  // The band behind each candidate's column; a saved match's band is outlined.
  const band = (c: Candidate) => ({
    bg: 'blue.600',
    borderBottomWidth: '0',
    boxShadow:
      matchedId === c.studentUniqueId
        ? 'inset 2px 0 0 var(--chakra-colors-green-100), inset -2px 0 0 var(--chakra-colors-green-100)'
        : undefined,
  });

  const renderRow = (row: Row) => (
    <Tr key={row.field}>
      <Td whiteSpace="nowrap" opacity="0.85">
        {row.label}
      </Td>
      <Td>
        {(row.rosterOnly ? null : valueText(student.inputDetails[row.field])) ?? (
          <Missing compared={!row.rosterOnly} />
        )}
      </Td>
      {shown.map((c, i) => {
        const value = valueText(c.rosterDetails[row.field]);
        return (
          <Td key={c.studentUniqueId} {...band(c)}>
            <HStack gap="100" alignItems="baseline">
              {isComparedField(row.field) ? (
                <AgreementMark agreement={comparisons[i][row.field]} />
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
                    matchedId === c.studentUniqueId
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
                      c.score !== null && `match score ${c.score.toFixed(5)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                      .replace(/^./, (first) => first.toUpperCase())}
                  </Box>
                  <CrossYearCue rosterDetails={c.rosterDetails} />
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
                    matchedId === c.studentUniqueId
                      ? 'inset 0 -2px 0 var(--chakra-colors-green-100), inset 2px 0 0 var(--chakra-colors-green-100), inset -2px 0 0 var(--chakra-colors-green-100)'
                      : undefined
                  }
                >
                  {matchedId === c.studentUniqueId ? (
                    <Box fontWeight="600" color="green.100" paddingY="100">
                      ✓ Saved match
                    </Box>
                  ) : (
                    onUse && (
                      <PrimaryButton
                        onClick={() => onUse(c)}
                        isLoading={savingMatchId === c.studentUniqueId}
                        loadingText="Saving…"
                      >
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
  <Box as="span" opacity="0.8" fontStyle="italic">
    {compared ? 'missing' : '—'}
  </Box>
);

/** Search, remembered per student so a trip to the SIS doesn't lose it. */
const Search = ({
  student,
  matchedId,
  onUse,
  savingMatchId,
}: {
  student: GetStudentInputDetailsDto;
  matchedId: string | null;
  onUse: (candidate: Candidate) => void;
  savingMatchId?: string;
}) => {
  const { search, searchOf, setSearch } = useReviewSession();
  const remembered = searchOf(student.correlationId);
  const [terms, setTerms] = useState<SearchTerms>(
    remembered?.terms ?? termsFrom(student.inputDetails)
  );
  const [searching, setSearching] = useState(false);
  const hits = remembered?.hits ?? null;

  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setSearching(true);
    setError(null);
    const result = await search(student.correlationId, terms);
    if (result.ok) setSearch(student.correlationId, { terms, hits: result.candidates });
    else setError(result.message);
    setSearching(false);
  };
  const field = (key: keyof SearchTerms, label: string, placeholder?: string) => (
    <SearchField
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
      <SecondaryButton alignSelf="flex-start" onClick={run} isLoading={searching}>
        Search
      </SecondaryButton>
      {error && !searching && <Box color="pink.100">Couldn't search: {error}</Box>}
      {hits && !searching && hits.length === 0 && (
        <Box>No one in the roster matches those details.</Box>
      )}
      {hits && !searching && hits.length > 0 && (
        <Box bg="blue.700" borderRadius="6px" padding="200">
          <EvidenceTable
            student={student}
            candidates={hits}
            matchedId={matchedId}
            onUse={onUse}
            savingMatchId={savingMatchId}
          />
        </Box>
      )}
    </VStack>
  );
};

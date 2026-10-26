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
  VStack,
} from '@chakra-ui/react';
import {
  GetSendRunDto,
  GetStudentInputDetailsDto,
  StudentRosterDetailsJson,
  StudentMatchStatus,
} from '@edanalytics/models';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Agreement, compare } from './compare';
import {
  AgreementMark,
  PrimaryButton,
  NoSuggestionFits,
  SearchField,
  QuietButton,
  SecondaryButton,
  studentName,
  secondId,
  valueText,
  dateTime,
  CopyButton,
  CrossYearCue,
  suggestionsOf,
} from './components';
import { ContactSupport } from '../../../components/SupportButton';
import { termsFrom, SearchTerms } from './search';
import { Candidate, Decision, DecisionResult, useReviewSession } from './reviewSession';
import { outcomeLabel, sendRunOutcome, submissionNumber, submissionReference } from './sendRun';

// Evidence -------------------------------------------------------------------

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
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new action replaces the last, along with any refusal of its undo.
  useEffect(() => setError(null), [action]);
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
        {!error && (
          <QuietButton
            isLoading={undoing}
            onClick={async () => {
              setUndoing(true);
              const result = await action.undo();
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

// One student ------------------------------------------------------------------

export const Workspace = ({
  student,
  onSaved,
}: {
  student: GetStudentInputDetailsDto;
  onSaved: (action: LastAction) => void;
}) => {
  const { statusOf, decisions, decide, clear, sendRunOf } = useReviewSession();
  const id = student.correlationId;
  const status = statusOf(id);
  const decision = decisions.get(id);
  const sendRun = sendRunOf(id);
  // Once a student's match is in a send run, failed or not, they take no new
  // decision (Decisions Log #46): a failed one's remedy is its submission's.
  const isSubmitted =
    status === 'reprocessing' || status === 'reprocessed' || status === 'run-failed';
  const suggestions = suggestionsOf(student);

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
  const name = studentName(student.inputDetails);

  // Why the last write was refused, shown here on the student.
  const [error, setError] = useState<string | null>(null);
  // Whether this student is still the one shown: the pane is keyed by
  // student, so it unmounts when the reviewer moves on.
  const shown = useRef(true);
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
    write: Promise<DecisionResult>,
    action: { message: string; advance: boolean }
  ) => {
    const previous = decision;
    setError(null);
    const result = await write;
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    // A save that lands after the reviewer has moved to another student
    // still stands, but reporting it would take them back, or replace a
    // newer action's undo with this older one.
    if (!shown.current) return true;
    onSaved({
      ...action,
      undo: () => (previous ? decide(id, previous, result.version) : clear(id, result.version)),
    });
    return true;
  };

  // One step: the submit list is where matches get their second look.
  const use = (candidate: Candidate) =>
    save(decide(id, { kind: 'match', candidate }, decision?.version ?? null), {
      message: `Saved ${candidate.studentUniqueId} as the match for ${name}.`,
      advance: true,
    });
  const clearDecision = () =>
    save(clear(id, decision?.version ?? null), {
      message: `Cleared the decision for ${name}.`,
      advance: false,
    });
  const exclude = async () => {
    const saved = await save(decide(id, { kind: 'exclude' }, decision?.version ?? null), {
      message: `Excluded ${name} from this job.`,
      advance: true,
    });
    if (saved) setNoneFit(false);
  };

  const issues = fileIssues(student);

  return (
    <VStack alignItems="stretch" gap="400">
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

      <DecisionState status={status} decision={decision} sendRun={sendRun} />

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
          search={<Search student={student} saved={saved} onUse={use} />}
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
              {decision && <QuietButton onClick={clearDecision}>Clear decision</QuietButton>}
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
};

/** What's been decided and what's happened since, kept apart. */
const DecisionState = ({
  status,
  decision,
  sendRun,
}: {
  status: StudentMatchStatus;
  decision: Decision | undefined;
  /** The submission that decides the student's status, once they've been submitted. */
  sendRun: GetSendRunDto | undefined;
}) => {
  const { job, sendRuns } = useReviewSession();
  const by = decision ? ` by ${decision.decidedBy} on ${dateTime(decision.decidedAt)}` : '';
  let body: ReactNode = null;
  if (status === 'ready' && decision?.kind === 'match') {
    body = `Match saved${by}: ${decision.candidate.studentUniqueId}${
      decision.candidate.source === 'search' ? ', found by searching' : ''
    }. Not submitted yet.`;
  } else if (status === 'excluded') {
    body = `Excluded from this job${by}. Its records won't be reprocessed.`;
  } else if (
    sendRun &&
    (status === 'reprocessing' || status === 'reprocessed' || status === 'run-failed')
  ) {
    // No decision can follow a send, so the current one is what was sent.
    const chosen = decision?.kind === 'match' ? decision.candidate.studentUniqueId : null;
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
            That submission's run failed. The match still stands. Submission {number}, above, is
            where to contact support or send its students again.
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
      {decision?.kind === 'match' && (
        <Box marginTop="100">
          <CrossYearCue rosterDetails={decision.candidate.rosterDetails} />
        </Box>
      )}
    </Box>
  );
};

type Row = {
  label: string;
  roster: (candidate: StudentRosterDetailsJson) => string | null;
  /** Compared rows get marks. */
  compared: boolean;
  /** Only the roster has these; they're a click away. */
  rosterOnly: boolean;
};

const rows: Row[] = [
  {
    label: 'First name',
    roster: (r) => valueText(r.first_name),
    compared: true,
    rosterOnly: false,
  },
  {
    label: 'Last name',
    roster: (r) => valueText(r.last_name),
    compared: true,
    rosterOnly: false,
  },
  {
    label: 'Date of birth',
    roster: (r) => valueText(r.birth_date),
    compared: true,
    rosterOnly: false,
  },
  // Both sides have IDs, but usually from different ID systems (the roster's
  // are typed), so they're shown side by side without a mark.
  {
    label: 'Student IDs',
    roster: (r) => valueText(r.student_ids),
    compared: false,
    rosterOnly: false,
  },
  {
    label: 'Middle name',
    roster: (r) => valueText(r.middle_name),
    compared: false,
    rosterOnly: true,
  },
  {
    label: 'School years',
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
  student,
  candidates,
  saved,
  onUse,
}: {
  student: GetStudentInputDetailsDto;
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
  const comparisons = shown.map((c) => compare(student.inputDetails, c.rosterDetails));
  const fileValue: Record<string, string | null> = {
    'First name': valueText(student.inputDetails.first_name),
    'Last name': valueText(student.inputDetails.last_name),
    'Date of birth': valueText(student.inputDetails.birth_date),
    'Middle name': null,
    'Student IDs': valueText(student.inputDetails.student_ids),
    'School years': null,
  };
  const agreementOf = (label: string, index: number): Agreement =>
    comparisons[index].find((f) => f.label === label)?.agreement ?? 'unknown';
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
  <Box as="span" opacity="0.8" fontStyle="italic">
    {compared ? 'missing' : '—'}
  </Box>
);

/** Search, remembered per student so a trip to the SIS doesn't lose it. */
const Search = ({
  student,
  saved,
  onUse,
}: {
  student: GetStudentInputDetailsDto;
  saved: string | null;
  onUse: (candidate: Candidate) => void;
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
    try {
      const found = await search(student.correlationId, terms);
      setSearch(student.correlationId, { terms, hits: found });
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'The search failed.');
    }
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
            student={student}
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

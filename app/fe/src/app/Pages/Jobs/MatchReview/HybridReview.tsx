import {
  Box,
  HStack,
  Spinner,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import { GetStudentInputDetailsDto, JsonValue } from '@edanalytics/models';
import { ReactNode, useEffect, useState } from 'react';
import { compare, ComparedField, Comparison } from './compare';
import {
  AgreementMark,
  BatchActivity,
  DesignIntro,
  FileLine,
  NoSuggestionFits,
  OthersMatchesNote,
  PrimaryButton,
  PrototypeControls,
  QuietButton,
  ReviewProgress,
  SecondaryButton,
  studentName,
} from './components';
import { Candidate, StudentStatus, suggestedCandidates, useReviewSession } from './reviewSession';

/*
 * PROTOTYPE, design 4: Focus by decision type. A hybrid of focus and triage.
 * Students are sorted by the kind of decision they need, like triage, and
 * each kind gets its own focus view built for that decision, like focus.
 *
 * The Executor auto-matches very strong matches, so nothing here is a
 * rubber stamp: every view leads with what differs, not what agrees, and
 * nothing is accepted in bulk.
 */

type DecisionType = 'verify' | 'choose' | 'find';

const typeOf = (group: GetStudentInputDetailsDto): DecisionType => {
  const count = suggestedCandidates(group).length;
  return count === 0 ? 'find' : count === 1 ? 'verify' : 'choose';
};

const types: { type: DecisionType; title: string }[] = [
  { type: 'verify', title: 'One suggestion' },
  { type: 'choose', title: 'Several suggestions' },
  { type: 'find', title: 'No suggestions' },
];

const isOpen = (status: StudentStatus) => status === 'to-review';

export const HybridReview = () => {
  const { groups, isLoading, isError, statusOf, decisions, submit } = useReviewSession();
  const [type, setType] = useState<DecisionType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showReady, setShowReady] = useState(true);

  // Start on the first kind of decision that has anyone waiting.
  useEffect(() => {
    if (type || !groups.length) return;
    const first = types.find(({ type: t }) =>
      groups.some((g) => typeOf(g) === t && isOpen(statusOf(g.correlationId)))
    );
    setType(first?.type ?? 'verify');
  }, [groups, type, statusOf]);

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;
  if (!type) return null;

  const members = groups.filter((g) => typeOf(g) === type);
  const openMembers = members.filter((g) => isOpen(statusOf(g.correlationId)));
  const selected =
    members.find((g) => g.correlationId === selectedId) ?? openMembers[0] ?? members[0];

  // Where Next goes: the next undecided student here, else in the next group.
  const nextHere = openMembers.find((g) => g.correlationId !== selected?.correlationId);
  const nextType = types.find(
    ({ type: t }) =>
      t !== type && groups.some((g) => typeOf(g) === t && isOpen(statusOf(g.correlationId)))
  );
  const nextThere =
    nextType &&
    groups.find((g) => typeOf(g) === nextType.type && isOpen(statusOf(g.correlationId)));
  const nextStep: NextStep | null = nextHere
    ? {
        label: `Next: ${studentName(nextHere.inputDetails)}`,
        go: () => setSelectedId(nextHere.correlationId),
      }
    : nextType && nextThere
    ? {
        label: `Next: ${studentName(nextThere.inputDetails)}`,
        detail: `in ${nextType.title.toLowerCase()}`,
        go: () => {
          setType(nextType.type);
          setSelectedId(nextThere.correlationId);
        },
      }
    : null;
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');

  return (
    <VStack alignItems="flex-start" width="100%" gap="400" paddingBottom="500">
      <DesignIntro
        title="By suggestion count"
        bet="Students grouped by what the matching returned (one suggestion, several, or none), each group with a view tuned to it: one suggestion leads with what differs, several are lined up side by side, and none starts from what in the file may have kept them from being found. Nothing moves on by itself: a decision shows what you chose, and Next (or Enter) takes you on. Saved matches from every group collect in the bar below, ready to submit."
      />
      <ReviewProgress />
      <HStack width="100%" gap="300" alignItems="stretch">
        {types.map(({ type: t, title }) => {
          const all = groups.filter((g) => typeOf(g) === t);
          const waiting = all.filter((g) => isOpen(statusOf(g.correlationId))).length;
          const isSelected = t === type;
          return (
            <VStack
              as="button"
              key={t}
              flex="1"
              alignItems="flex-start"
              gap="100"
              padding="300"
              borderRadius="6px"
              borderWidth="2px"
              borderColor={isSelected ? 'blue.50' : 'transparent'}
              bg={isSelected ? 'blue.600' : 'blue.700'}
              _hover={{ bg: 'blue.600' }}
              textAlign="left"
              onClick={() => {
                setType(t);
                setSelectedId(null);
              }}
            >
              <HStack justifyContent="space-between" width="100%" flexWrap="wrap" gap="200">
                <Box textStyle="h5">{title}</Box>
                <Box fontSize="0.9rem" opacity={all.length ? 1 : 0.6}>
                  {all.length === 0 ? 'none' : `${all.length - waiting} of ${all.length} decided`}
                </Box>
              </HStack>
            </VStack>
          );
        })}
      </HStack>

      {members.length === 0 ? (
        <Box layerStyle="contentBox" padding="400" width="100%">
          No students need this kind of decision.
        </Box>
      ) : (
        <HStack alignItems="flex-start" width="100%" gap="400">
          <VStack
            width="15rem"
            flexShrink={0}
            alignItems="stretch"
            layerStyle="contentBox"
            padding="200"
            gap="100"
          >
            {members.map((group) => (
              <QueueRow
                key={group.correlationId}
                group={group}
                isSelected={group.correlationId === selected?.correlationId}
                onSelect={() => setSelectedId(group.correlationId)}
              />
            ))}
          </VStack>
          <Box flex="1" minWidth="0" layerStyle="contentBox" padding="400">
            {selected && (
              <FocusFor
                key={selected.correlationId}
                type={type}
                group={selected}
                nextStep={nextStep}
                // Pin the student so deciding never swaps who's on screen.
                onDecide={() => setSelectedId(selected.correlationId)}
              />
            )}
          </Box>
        </HStack>
      )}

      <VStack
        position="sticky"
        bottom="0"
        width="100%"
        alignItems="stretch"
        gap="200"
        padding="300"
        bg="blue.700"
        borderTopWidth="1px"
        borderColor="blue.50-40"
        borderRadius="6px"
        boxShadow="0 -4px 12px rgba(0,0,0,0.3)"
      >
        <HStack justifyContent="space-between" gap="300">
          <Box>
            {ready.length ? (
              <ReadySummary ready={ready} />
            ) : (
              'Matches collect here, from every kind of decision, until you submit them.'
            )}
          </Box>
          <HStack gap="200">
            <OthersMatchesNote ready={ready} />
            {ready.length > 0 && (
              <QuietButton onClick={() => setShowReady(!showReady)}>
                {showReady ? 'Hide list' : 'Show list'}
              </QuietButton>
            )}
            <PrimaryButton
              isDisabled={!ready.length}
              onClick={() => submit(ready.map((g) => g.correlationId))}
            >
              Submit {ready.length || ''} for reprocessing
            </PrimaryButton>
          </HStack>
        </HStack>
        {/* Every match waiting to go, whichever pane it was made in. */}
        {showReady && ready.length > 0 && (
          <HStack gap="200" flexWrap="wrap">
            {ready.map((g) => {
              const decision = decisions.get(g.correlationId);
              const t = typeOf(g);
              return (
                <HStack
                  as="button"
                  key={g.correlationId}
                  onClick={() => {
                    setType(t);
                    setSelectedId(g.correlationId);
                  }}
                  gap="200"
                  paddingX="200"
                  paddingY="100"
                  borderRadius="4px"
                  borderWidth="1px"
                  borderColor={
                    g.correlationId === selected?.correlationId ? 'blue.50' : 'blue.50-40'
                  }
                  _hover={{ bg: 'blue.600' }}
                  fontSize="0.85rem"
                  title="Open this student"
                >
                  <Box fontWeight="600">{studentName(g.inputDetails)}</Box>
                  <Box opacity="0.85">
                    → {decision?.kind === 'match' ? decision.candidate.studentUniqueId : ''}
                  </Box>
                  <Box opacity="0.6">{types.find((x) => x.type === t)?.title}</Box>
                </HStack>
              );
            })}
          </HStack>
        )}
      </VStack>

      <VStack alignItems="flex-start" width="100%" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet." />
      </VStack>
      <PrototypeControls />
    </VStack>
  );
};

const ReadySummary = ({ ready }: { ready: GetStudentInputDetailsDto[] }) => {
  const count = (t: DecisionType) => ready.filter((g) => typeOf(g) === t).length;
  const parts = types
    .map(({ type, title }) => count(type) && `${count(type)} with ${title.toLowerCase()}`)
    .filter(Boolean);
  return (
    <>
      {ready.length} {ready.length === 1 ? 'match' : 'matches'} ready to submit ({parts.join(', ')}
      ).
    </>
  );
};

const glyph: Record<StudentStatus, string> = {
  'to-review': '○',
  'run-failed': '!',
  ready: '●',
  reprocessing: '…',
  reprocessed: '✓',
  excluded: '⊘',
};

const QueueRow = ({
  group,
  isSelected,
  onSelect,
}: {
  group: GetStudentInputDetailsDto;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const { statusOf, decisions } = useReviewSession();
  const status = statusOf(group.correlationId);
  const decision = decisions.get(group.correlationId);
  return (
    <HStack
      as="button"
      onClick={onSelect}
      gap="200"
      paddingX="200"
      paddingY="100"
      borderRadius="4px"
      bg={isSelected ? 'blue.500' : undefined}
      _hover={{ bg: isSelected ? 'blue.500' : 'blue.600' }}
      textAlign="left"
      opacity={isOpen(status) ? 1 : 0.7}
    >
      <Box width="1rem" color={status === 'reprocessed' ? 'green.100' : undefined}>
        {glyph[status]}
      </Box>
      <Box flex="1">{studentName(group.inputDetails)}</Box>
      {(status === 'ready' || status === 'reprocessed') && decision?.kind === 'match' && (
        <Box fontSize="0.75rem" opacity="0.8">
          {decision.candidate.studentUniqueId}
        </Box>
      )}
      {status === 'excluded' && (
        <Box fontSize="0.75rem" opacity="0.8">
          excluded
        </Box>
      )}
    </HStack>
  );
};

/** What every view shares: the file record and a decided state. */
type NextStep = { label: string; detail?: string; go: () => void };

/**
 * One student, from deciding to decided. The panel never moves on by
 * itself: a decision shows what was decided, and the reviewer moves on with
 * Next, so the student on screen only changes when they ask.
 */
const FocusFor = ({
  type,
  group,
  nextStep,
  onDecide,
}: {
  type: DecisionType;
  group: GetStudentInputDetailsDto;
  nextStep: NextStep | null;
  onDecide: () => void;
}) => {
  const { statusOf, decisions, decide, undo, batchOf } = useReviewSession();
  const [changing, setChanging] = useState(false);
  const [justDecided, setJustDecided] = useState(false);
  const status = statusOf(group.correlationId);
  const decision = decisions.get(group.correlationId);

  const actions: Actions = {
    match: (candidate) => {
      onDecide();
      decide(group.correlationId, { kind: 'match', candidate });
      setChanging(false);
      setJustDecided(true);
    },
    notInRoster: () => {
      onDecide();
      decide(group.correlationId, { kind: 'not-in-roster' });
      setChanging(false);
      setJustDecided(true);
    },
  };

  let body: ReactNode;
  if (isOpen(status) || changing) {
    body =
      type === 'verify' ? (
        <VerifyView group={group} actions={actions} />
      ) : type === 'choose' ? (
        <ChooseView group={group} actions={actions} />
      ) : (
        <FindView group={group} actions={actions} />
      );
  } else if (status === 'reprocessing') {
    body = <Box>Submitted and reprocessing. See the batch below.</Box>;
  } else if (decision) {
    const batch = status === 'reprocessed' ? batchOf(group.correlationId) : undefined;
    const chosen = decision.kind === 'match' ? decision.candidate : null;
    body = (
      <VStack
        alignItems="stretch"
        gap="300"
        padding="300"
        borderRadius="6px"
        borderLeftWidth="3px"
        borderColor={justDecided ? 'green.100' : 'blue.50-40'}
        bg="blue.600"
      >
        <VStack alignItems="flex-start" gap="100">
          <Box fontSize="0.8rem" opacity="0.8">
            {justDecided ? 'Decided' : batch ? 'Reprocessed' : 'Your decision'}
          </Box>
          {chosen ? (
            <>
              <Box fontWeight="600">
                {batch ? 'Reprocessed with' : 'Matched to'} {chosen.studentUniqueId}
                {chosen.source === 'search' ? ', found by searching' : ''}
              </Box>
              <Box fontSize="0.9rem" opacity="0.85">
                In the roster: {studentName(chosen.rosterDetails)}
                {typeof chosen.rosterDetails.birth_date === 'string' &&
                  `, born ${chosen.rosterDetails.birth_date}`}
              </Box>
            </>
          ) : (
            <Box fontWeight="600">Excluded from this job. Their assessments won't be loaded.</Box>
          )}
          {batch?.status === 'complete with errors' && (
            <Box fontSize="0.9rem" opacity="0.85">
              Their batch completed with errors. The run can't say whose assessments failed, so this
              match stands; support can trace the failures from the run's logs.
            </Box>
          )}
        </VStack>
        <HStack gap="200" flexWrap="wrap">
          {nextStep ? (
            <PrimaryButton autoFocus={justDecided} onClick={nextStep.go}>
              {nextStep.label} →
            </PrimaryButton>
          ) : (
            <Box fontSize="0.9rem">Every student has a decision; submit your matches below.</Box>
          )}
          {nextStep?.detail && (
            <Box fontSize="0.8rem" opacity="0.7">
              {nextStep.detail}
            </Box>
          )}
          <Box flex="1" />
          <QuietButton
            onClick={() => {
              setChanging(true);
              setJustDecided(false);
            }}
          >
            Change
          </QuietButton>
          {(status === 'ready' || status === 'excluded') && (
            <QuietButton
              onClick={() => {
                undo(group.correlationId);
                setJustDecided(false);
              }}
            >
              Undo
            </QuietButton>
          )}
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack alignItems="stretch" gap="400">
      <VStack alignItems="flex-start" gap="100">
        <Box fontSize="0.8rem" opacity="0.8">
          From your file
        </Box>
        <Box textStyle="h4">{studentName(group.inputDetails)}</Box>
        <FileLine details={group.inputDetails} withName={false} />
        {/* Find explains these in its own terms. */}
        {type !== 'find' &&
          fileIssues(group).map((issue) => (
            <Box key={issue} fontSize="0.85rem" color="purple.200">
              {issue}
            </Box>
          ))}
      </VStack>
      {body}
    </VStack>
  );
};

type Actions = {
  match: (candidate: Candidate) => void;
  notInRoster: () => void;
};

/** Stays on this student and opens the other ways forward. */
const NoneFitButton = ({ count, onClick }: { count: number; onClick: () => void }) => (
  <HStack gap="300">
    <SecondaryButton onClick={onClick}>
      {count === 1 ? 'Not this student' : 'None of these'}
    </SecondaryButton>
    <Box fontSize="0.8rem" opacity="0.7">
      Then search the roster, or exclude the record.
    </Box>
  </HStack>
);

/**
 * The file against each suggestion, one column each, so the eye runs across
 * a row. With several, rows where the suggestions disagree are marked.
 */
const SuggestionTable = ({
  group,
  candidates,
  onlyDeciding = false,
  onUse,
}: {
  group: GetStudentInputDetailsDto;
  candidates: Candidate[];
  onlyDeciding?: boolean;
  onUse: (candidate: Candidate) => void;
}) => {
  const comparisons: Comparison[] = candidates.map((c) =>
    compare(group.inputDetails, c.rosterDetails)
  );
  const rows = comparisons[0].fields.map((field, index) => {
    const cells = comparisons.map((c) => c.fields[index]);
    const deciding =
      candidates.length > 1 &&
      (new Set(cells.map((c) => c.agreement)).size > 1 ||
        new Set(cells.map((c) => c.roster)).size > 1);
    return { label: field.label, file: field.file, cells, deciding };
  });
  const shown = onlyDeciding ? rows.filter((r) => r.deciding) : rows;
  return (
    <>
      <Box overflowX="auto">
        <Table size="sm" sx={{ td: { paddingX: '200' }, th: { paddingX: '200' } }}>
          <Thead>
            <Tr>
              <Th />
              <Th color="blue.50" textTransform="none" fontSize="0.8rem">
                In your file
              </Th>
              {candidates.map((c) => (
                <Th key={c.studentUniqueId} color="blue.50" textTransform="none" fontSize="0.8rem">
                  {c.studentUniqueId}
                  <Box fontWeight="normal" opacity="0.8">
                    Match score {c.score}
                  </Box>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {shown.map((row) => (
              <Tr key={row.label} bg={row.deciding ? 'blue.600' : undefined}>
                <Td whiteSpace="nowrap" opacity="0.85">
                  {row.label}
                  {row.deciding && (
                    <Box fontSize="0.7rem" color="purple.200">
                      tells them apart
                    </Box>
                  )}
                </Td>
                <Td>{row.file ?? '—'}</Td>
                {row.cells.map((cell, i) => (
                  <Td key={candidates[i].studentUniqueId}>
                    <HStack gap="200">
                      <AgreementMark agreement={cell.agreement} />
                      <Box>{cell.roster ?? '—'}</Box>
                    </HStack>
                  </Td>
                ))}
              </Tr>
            ))}
            <Tr>
              <Td />
              <Td />
              {candidates.map((c) => (
                <Td key={c.studentUniqueId}>
                  <PrimaryButton onClick={() => onUse(c)}>Use suggestion</PrimaryButton>
                </Td>
              ))}
            </Tr>
          </Tbody>
        </Table>
      </Box>
      {onlyDeciding && !shown.length && (
        <Box opacity="0.8">
          Nothing tells them apart: every row reads the same across suggestions.
        </Box>
      )}
    </>
  );
};

// Verify ---------------------------------------------------------------------

const describe = (field: ComparedField) =>
  `${field.file ?? 'missing'} in your file, ${field.roster ?? 'missing'} in the roster`;

/**
 * One suggestion that wasn't a strong enough match to use automatically.
 * Lead with why: what differs, and what couldn't be compared.
 */
const VerifyView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const [candidate] = suggestedCandidates(group);
  const [noneFit, setNoneFit] = useState(false);
  const comparison = compare(group.inputDetails, candidate.rosterDetails);
  const differs = comparison.fields.filter((f) => f.agreement === 'different');
  const unknown = comparison.fields.filter(
    (f) => f.agreement === 'unknown' && f.label !== 'Student IDs'
  );

  if (noneFit) {
    return (
      <NoSuggestionFits
        group={group}
        suggestionCount={1}
        onBack={() => setNoneFit(false)}
        onUse={actions.match}
        onExclude={actions.notInRoster}
      />
    );
  }

  return (
    <VStack alignItems="stretch" gap="300">
      <VStack
        alignItems="flex-start"
        gap="100"
        padding="300"
        borderRadius="6px"
        borderLeftWidth="3px"
        borderColor={differs.length ? 'pink.100' : 'blue.50-40'}
        bg="blue.600"
      >
        {differs.length ? (
          <>
            <Box fontWeight="600">What differs</Box>
            {differs.map((f) => (
              <HStack key={f.label} gap="200" alignItems="center">
                <AgreementMark agreement={f.agreement} />
                <Box>
                  {f.label}: {describe(f)}
                </Box>
              </HStack>
            ))}
          </>
        ) : (
          <Box fontWeight="600">Every field that could be compared is identical.</Box>
        )}
        {unknown.length > 0 && (
          <Box fontSize="0.9rem" opacity="0.85">
            Couldn't compare {unknown.map((f) => f.label.toLowerCase()).join(' or ')}: missing on
            one side.
          </Box>
        )}
      </VStack>
      <SuggestionTable group={group} candidates={[candidate]} onUse={actions.match} />
      <NoneFitButton count={1} onClick={() => setNoneFit(true)} />
    </VStack>
  );
};

// Choose ---------------------------------------------------------------------

/** Several suggestions lined up in one table. */
const ChooseView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const candidates = suggestedCandidates(group);
  const [onlyDeciding, setOnlyDeciding] = useState(false);
  const [noneFit, setNoneFit] = useState(false);

  if (noneFit) {
    return (
      <NoSuggestionFits
        group={group}
        suggestionCount={candidates.length}
        onBack={() => setNoneFit(false)}
        onUse={actions.match}
        onExclude={actions.notInRoster}
      />
    );
  }

  return (
    <VStack alignItems="stretch" gap="300">
      <HStack justifyContent="space-between">
        {/* The count matters when a suggestion is past the fold. */}
        <Box fontSize="0.85rem" opacity="0.8">
          {candidates.length} suggestions
        </Box>
        <HStack as="label" gap="200" fontSize="0.85rem" cursor="pointer">
          <Switch
            size="sm"
            colorScheme="green"
            isChecked={onlyDeciding}
            onChange={() => setOnlyDeciding(!onlyDeciding)}
          />
          <Box>Only rows that tell them apart</Box>
        </HStack>
      </HStack>
      <SuggestionTable
        group={group}
        candidates={candidates}
        onlyDeciding={onlyDeciding}
        onUse={actions.match}
      />
      <NoneFitButton count={candidates.length} onClick={() => setNoneFit(true)} />
    </VStack>
  );
};

// Find -----------------------------------------------------------------------

const present = (value: JsonValue | undefined) =>
  typeof value === 'string'
    ? value.trim().length > 0
    : Array.isArray(value)
    ? value.length > 0
    : value != null;

const realDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Likely reasons nobody was suggested, from the file record alone. */
const fileIssues = (group: GetStudentInputDetailsDto) => {
  const d = group.inputDetails;
  const issues: string[] = [];
  if (!present(d.first_name)) issues.push('No first name in your file.');
  if (!present(d.last_name)) issues.push('No last name in your file.');
  if (!present(d.birth_date)) issues.push('No date of birth in your file.');
  else if (typeof d.birth_date === 'string' && !realDate(d.birth_date))
    issues.push(`Date of birth ${d.birth_date} isn't a real date.`);
  if (!present(d.student_ids)) issues.push('No student IDs in your file.');
  return issues;
};

/** No suggestions. Start from what in the file may have kept them from being found. */
const FindView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const issues = fileIssues(group);
  return (
    <NoSuggestionFits
      group={group}
      suggestionCount={0}
      onUse={actions.match}
      onExclude={actions.notInRoster}
    >
      <VStack
        alignItems="flex-start"
        gap="100"
        padding="300"
        borderRadius="6px"
        borderLeftWidth="3px"
        borderColor={issues.length ? 'pink.100' : 'blue.50-40'}
        bg="blue.600"
      >
        <Box fontWeight="600">
          {issues.length
            ? 'Why they may not have been found'
            : 'No missing or invalid values detected in these fields'}
        </Box>
        {issues.map((issue) => (
          <Box key={issue}>{issue}</Box>
        ))}
        {!issues.length && (
          <Box fontSize="0.9rem" opacity="0.85">
            They may be new, enrolled under a different name, or not in the roster.
          </Box>
        )}
      </VStack>
    </NoSuggestionFits>
  );
};

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
import { KeyboardEvent, ReactNode, useEffect, useState } from 'react';
import { compare, ComparedField, Comparison } from './compare';
import {
  AgreementMark,
  BatchActivity,
  ComparisonTable,
  DesignIntro,
  FileLine,
  PrimaryButton,
  QuietButton,
  ReviewProgress,
  ScoreBadge,
  SearchPanel,
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

const types: { type: DecisionType; title: string; question: string }[] = [
  { type: 'verify', title: 'Verify', question: 'One suggestion. Is it the same student?' },
  { type: 'choose', title: 'Choose', question: 'Several suggestions. Which one, if any?' },
  { type: 'find', title: 'Find', question: 'No suggestions. Can you find them?' },
];

const isOpen = (status: StudentStatus) => status === 'to-review';

export const HybridReview = () => {
  const { groups, isLoading, isError, statusOf, submit } = useReviewSession();
  const [type, setType] = useState<DecisionType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const advance = () => {
    const next = openMembers.find((g) => g.correlationId !== selected?.correlationId);
    setSelectedId(next?.correlationId ?? null);
  };
  const nextType = types.find(
    ({ type: t }) =>
      t !== type && groups.some((g) => typeOf(g) === t && isOpen(statusOf(g.correlationId)))
  );
  const ready = groups.filter((g) => statusOf(g.correlationId) === 'ready');

  return (
    <VStack alignItems="flex-start" width="100%" gap="400" paddingBottom="1000">
      <DesignIntro
        title="Focus by decision type"
        bet="The Executor already matched the easy ones, so everyone here needs a real decision. Work one kind of decision at a time, each with a view built for it: verifying one suggestion puts the differences first, choosing lines the suggestions up side by side, and finding starts from why IDRS may have missed them."
      />
      <ReviewProgress />
      <HStack width="100%" gap="300" alignItems="stretch">
        {types.map(({ type: t, title, question }) => {
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
              <HStack justifyContent="space-between" width="100%">
                <Box textStyle="h5">{title}</Box>
                <Box fontSize="0.9rem" opacity={all.length ? 1 : 0.6}>
                  {all.length === 0 ? 'none' : waiting ? `${waiting} to decide` : 'all decided'}
                </Box>
              </HStack>
              <Box fontSize="0.85rem" opacity="0.85">
                {question}
              </Box>
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
                onDecided={advance}
              />
            )}
            {!openMembers.length && (
              <HStack
                marginTop="400"
                paddingTop="300"
                borderTopWidth="1px"
                borderColor="blue.50-40"
                gap="300"
              >
                <Box>All {type} decisions are made.</Box>
                {nextType && (
                  <SecondaryButton
                    onClick={() => {
                      setType(nextType.type);
                      setSelectedId(null);
                    }}
                  >
                    Next: {nextType.title}
                  </SecondaryButton>
                )}
              </HStack>
            )}
          </Box>
        </HStack>
      )}

      <VStack alignItems="flex-start" width="100%" gap="200">
        <Box textStyle="h5">Reprocessing</Box>
        <BatchActivity emptyText="Nothing submitted yet." />
      </VStack>

      <HStack
        position="sticky"
        bottom="0"
        width="100%"
        justifyContent="space-between"
        padding="300"
        bg="blue.700"
        borderTopWidth="1px"
        borderColor="blue.50-40"
        borderRadius="6px"
        boxShadow="0 -4px 12px rgba(0,0,0,0.3)"
      >
        <Box>
          {ready.length ? (
            <ReadySummary ready={ready} />
          ) : (
            'Decisions collect here until you submit them. Submit as often as you like.'
          )}
        </Box>
        <PrimaryButton
          isDisabled={!ready.length}
          onClick={() => submit(ready.map((g) => g.correlationId))}
        >
          Submit {ready.length || ''} for reprocessing
        </PrimaryButton>
      </HStack>
    </VStack>
  );
};

const ReadySummary = ({ ready }: { ready: GetStudentInputDetailsDto[] }) => {
  const count = (t: DecisionType) => ready.filter((g) => typeOf(g) === t).length;
  const parts = types
    .map(({ type, title }) => count(type) && `${count(type)} ${title.toLowerCase()}`)
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
    </HStack>
  );
};

/** What every view shares: the file record and a decided state. */
const FocusFor = ({
  type,
  group,
  onDecided,
}: {
  type: DecisionType;
  group: GetStudentInputDetailsDto;
  onDecided: () => void;
}) => {
  const { statusOf, decisions, decide, undo, batchOf } = useReviewSession();
  const [changing, setChanging] = useState(false);
  const status = statusOf(group.correlationId);
  const decision = decisions.get(group.correlationId);

  const actions: Actions = {
    match: (candidate) => {
      decide(group.correlationId, { kind: 'match', candidate });
      setChanging(false);
      onDecided();
    },
    notInRoster: () => {
      decide(group.correlationId, { kind: 'not-in-roster' });
      setChanging(false);
      onDecided();
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
    body = (
      <VStack alignItems="flex-start" gap="200">
        <Box>
          {decision.kind === 'match'
            ? `${batch ? 'Reprocessed with' : 'You matched this student to'} ${
                decision.candidate.studentUniqueId
              }${decision.candidate.source === 'search' ? ', found by searching' : ''}.`
            : "Excluded: not in the roster. Their assessments won't be loaded."}
        </Box>
        {batch?.status === 'complete with errors' && (
          <Box fontSize="0.9rem" opacity="0.85">
            Their batch completed with errors. The run can't say whose assessments failed, so this
            match stands; support can trace the failures from the run's logs.
          </Box>
        )}
        <HStack gap="200">
          <SecondaryButton onClick={() => setChanging(true)}>Change</SecondaryButton>
          {(status === 'ready' || status === 'excluded') && (
            <QuietButton onClick={() => undo(group.correlationId)}>Undo</QuietButton>
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
        <FileLine details={group.inputDetails} />
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

/** Keys only act while focus is inside the view, never in a text field. */
const shortcuts = (handlers: Record<string, () => void>) => (event: KeyboardEvent) => {
  if ((event.target as HTMLElement).closest('input')) return;
  handlers[event.key]?.();
};

/** Search and "not in roster": where every view ends up when the suggestions don't fit. */
const Fallback = ({
  group,
  actions,
  heading,
}: {
  group: GetStudentInputDetailsDto;
  actions: Actions;
  heading: string;
}) => (
  <VStack alignItems="flex-start" gap="300" width="100%">
    <SearchPanel group={group} onPick={actions.match} heading={heading} />
    <HStack gap="300" paddingTop="200">
      <SecondaryButton onClick={actions.notInRoster}>Exclude: not in roster</SecondaryButton>
      <Box fontSize="0.85rem" opacity="0.8">
        Excluded students aren't reprocessed; their assessments won't load.
      </Box>
    </HStack>
  </VStack>
);

// Verify ---------------------------------------------------------------------

const describe = (field: ComparedField) =>
  `${field.file ?? 'missing'} in your file, ${field.roster ?? 'missing'} in the roster`;

/**
 * One suggestion, and IDRS wasn't sure enough to match it. Lead with the
 * reason it wasn't sure: what differs, and what couldn't be compared.
 */
const VerifyView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const [candidate] = suggestedCandidates(group);
  const [rejected, setRejected] = useState(false);
  const comparison = compare(group.inputDetails, candidate.rosterDetails);
  const differs = comparison.fields.filter((f) => f.agreement === 'different');
  const unknown = comparison.fields.filter(
    (f) => f.agreement === 'unknown' && f.label !== 'Student IDs'
  );

  if (rejected) {
    return (
      <VStack alignItems="flex-start" gap="300" tabIndex={-1} outline="none">
        <HStack gap="300">
          <Box textStyle="h5">Not {candidate.studentUniqueId}. Can you find them?</Box>
          <QuietButton onClick={() => setRejected(false)}>Back to the suggestion</QuietButton>
        </HStack>
        <Fallback group={group} actions={actions} heading="Search with corrected details" />
      </VStack>
    );
  }

  return (
    <VStack
      alignItems="stretch"
      gap="300"
      tabIndex={-1}
      outline="none"
      onKeyDown={shortcuts({ y: () => actions.match(candidate), n: () => setRejected(true) })}
    >
      <HStack gap="300" alignItems="baseline">
        <Box textStyle="h5">Is this {candidate.studentUniqueId} the same student?</Box>
        <ScoreBadge score={candidate.score} />
      </HStack>
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
              <HStack key={f.label} gap="200" alignItems="baseline">
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
      <ComparisonTable comparison={comparison} rosterHeading={candidate.studentUniqueId} />
      <HStack gap="300" paddingTop="200">
        <PrimaryButton onClick={() => actions.match(candidate)}>
          Yes, same student (y)
        </PrimaryButton>
        <SecondaryButton onClick={() => setRejected(true)}>No (n)</SecondaryButton>
      </HStack>
    </VStack>
  );
};

// Choose ---------------------------------------------------------------------

/**
 * Several suggestions in one table, one column each, so the eye runs across
 * a row. Rows where the suggestions disagree are the ones that decide it.
 */
const ChooseView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const candidates = suggestedCandidates(group);
  const comparisons: Comparison[] = candidates.map((c) =>
    compare(group.inputDetails, c.rosterDetails)
  );
  const [onlyDeciding, setOnlyDeciding] = useState(false);
  const [rejected, setRejected] = useState(false);
  const rows = comparisons[0].fields.map((field, index) => {
    const cells = comparisons.map((c) => c.fields[index]);
    const deciding =
      new Set(cells.map((c) => c.agreement)).size > 1 ||
      new Set(cells.map((c) => c.roster)).size > 1;
    return { label: field.label, file: field.file, cells, deciding };
  });
  const shown = onlyDeciding ? rows.filter((r) => r.deciding) : rows;

  if (rejected) {
    return (
      <VStack alignItems="flex-start" gap="300">
        <HStack gap="300">
          <Box textStyle="h5">None of the {candidates.length}. Can you find them?</Box>
          <QuietButton onClick={() => setRejected(false)}>Back to the suggestions</QuietButton>
        </HStack>
        <Fallback group={group} actions={actions} heading="Search with corrected details" />
      </VStack>
    );
  }

  const keys: Record<string, () => void> = { '0': () => setRejected(true) };
  candidates.forEach((c, i) => {
    keys[String(i + 1)] = () => actions.match(c);
  });

  return (
    <VStack alignItems="stretch" gap="300" tabIndex={-1} outline="none" onKeyDown={shortcuts(keys)}>
      <HStack justifyContent="space-between">
        <Box textStyle="h5">Which of these {candidates.length} is the same student?</Box>
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
      <Box overflowX="auto">
        <Table size="sm" sx={{ td: { paddingX: '200' }, th: { paddingX: '200' } }}>
          <Thead>
            <Tr>
              <Th />
              <Th color="blue.50" textTransform="none" fontSize="0.8rem">
                In your file
              </Th>
              {candidates.map((c, i) => (
                <Th key={c.studentUniqueId} color="blue.50" textTransform="none" fontSize="0.8rem">
                  {i + 1}. {c.studentUniqueId}
                  <Box fontWeight="normal" opacity="0.8">
                    IDRS score {c.score}
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
                    <HStack gap="100">
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
              {candidates.map((c, i) => (
                <Td key={c.studentUniqueId}>
                  <PrimaryButton onClick={() => actions.match(c)}>Match ({i + 1})</PrimaryButton>
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
      <HStack>
        <SecondaryButton onClick={() => setRejected(true)}>None of these (0)</SecondaryButton>
      </HStack>
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

/** Likely reasons IDRS found no one, from the file record alone. */
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

/**
 * No suggestions. Start from why IDRS may have missed them, then search.
 * "Not in roster" sits beside the search, not behind it: sometimes the
 * student really isn't there.
 */
const FindView = ({ group, actions }: { group: GetStudentInputDetailsDto; actions: Actions }) => {
  const issues = fileIssues(group);
  return (
    <VStack alignItems="stretch" gap="300">
      <Box textStyle="h5">IDRS suggested no one. Can you find them?</Box>
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
          {issues.length ? 'Why IDRS may have missed them' : 'Nothing looks wrong in your file'}
        </Box>
        {issues.map((issue) => (
          <Box key={issue}>{issue}</Box>
        ))}
        {!issues.length && (
          <Box fontSize="0.9rem" opacity="0.85">
            They may be new, enrolled under a different name, or not in the roster.
          </Box>
        )}
        <Box fontSize="0.85rem" opacity="0.8">
          A student unique ID, if you know it, finds exactly one student.
        </Box>
      </VStack>
      <Fallback group={group} actions={actions} heading="Search the roster" />
    </VStack>
  );
};

import { Box, Checkbox, HStack, Spinner, VStack } from '@chakra-ui/react';
import { GetStudentInputDetailsDto } from '@edanalytics/models';
import { ReactNode, useState } from 'react';
import { compare, Comparison } from './compare';
import {
  AgreementMark,
  BatchActivity,
  ComparisonTable,
  DesignIntro,
  Evidence,
  FileLine,
  PrimaryButton,
  QuietButton,
  SearchPanel,
  SecondaryButton,
  ReviewProgress,
  ScoreBadge,
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
 * PROTOTYPE, design 2: Triage. Everyone at once, sorted by the kind of
 * decision they need. The bet: most unmatched students are obvious once the
 * evidence is lined up, so let reviewers clear those in bulk and spend their
 * attention on the few that need choosing or finding.
 */

type Lane = 'confirm' | 'choose' | 'find';

type Triaged = {
  group: GetStudentInputDetailsDto;
  candidates: Candidate[];
  comparisons: Comparison[];
  lane: Lane;
};

/** By suggestion count: one is a confirm, several a choice, none a find. */
const triage = (group: GetStudentInputDetailsDto): Triaged => {
  const candidates = suggestedCandidates(group);
  const comparisons = candidates.map((candidate) =>
    compare(group.inputDetails, candidate.rosterDetails)
  );
  const lane: Lane =
    candidates.length === 0 ? 'find' : candidates.length === 1 ? 'confirm' : 'choose';
  return { group, candidates, comparisons, lane };
};

const lanes: { lane: Lane; title: string; hint: string }[] = [
  {
    lane: 'confirm',
    title: 'Confirm',
    hint: 'One suggestion each. Check the evidence and accept them together.',
  },
  {
    lane: 'choose',
    title: 'Choose',
    hint: 'Several suggestions each. Open a student to pick.',
  },
  {
    lane: 'find',
    title: 'Find',
    hint: 'IDRS suggested no one. Search with corrected details, or leave them out.',
  },
];

export const TriageReview = () => {
  const { groups, isLoading, isError, statusOf, decide, submit } = useReviewSession();
  // Unchecking is the reviewer's doubt; everything starts accepted.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  if (isLoading) return <Spinner color="blue.50" />;
  if (isError) return <Box>Couldn't load unmatched students.</Box>;
  if (!groups.length) return <Box>No unmatched students for this assessment.</Box>;

  const triaged = groups.map(triage);
  const open = (t: Triaged) => statusOf(t.group.correlationId) === 'to-review';
  const ready = groups.filter((group) => statusOf(group.correlationId) === 'ready');
  const confirmable = triaged.filter(
    (t) =>
      t.lane === 'confirm' &&
      statusOf(t.group.correlationId) === 'to-review' &&
      !unchecked.has(t.group.correlationId)
  );

  const toggle = (id: string) =>
    setUnchecked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <VStack alignItems="flex-start" width="100%" gap="400" paddingBottom="1000">
      <DesignIntro
        title="Triage: everyone at once"
        bet="Most students are obvious once the evidence is lined up. Clear the obvious ones in bulk, then spend your attention on the students who need choosing or finding. Decide in any order; submit whenever you like, as often as you like."
      />
      <ReviewProgress />
      {lanes.map(({ lane, title, hint }) => {
        const members = triaged.filter((t) => t.lane === lane);
        if (!members.length) return null;
        const remaining = members.filter(open).length;
        return (
          <VStack key={lane} alignItems="stretch" width="100%" gap="200">
            <HStack justifyContent="space-between" alignItems="flex-end">
              <VStack alignItems="flex-start" gap="0">
                <Box textStyle="h5">
                  {title}{' '}
                  <Box as="span" opacity="0.7" fontWeight="normal">
                    {remaining} of {members.length} to decide
                  </Box>
                </Box>
                <Box fontSize="0.85rem" opacity="0.8">
                  {hint}
                </Box>
              </VStack>
              {lane === 'confirm' && (
                <PrimaryButton
                  isDisabled={!confirmable.length}
                  onClick={() =>
                    confirmable.forEach((t) =>
                      decide(t.group.correlationId, { kind: 'match', candidate: t.candidates[0] })
                    )
                  }
                >
                  Accept {confirmable.length} checked
                </PrimaryButton>
              )}
            </HStack>
            <VStack alignItems="stretch" layerStyle="contentBox" padding="0" gap="0">
              {members.map((t) => (
                <TriageRow
                  key={t.group.correlationId}
                  triaged={t}
                  checked={!unchecked.has(t.group.correlationId)}
                  onToggle={() => toggle(t.group.correlationId)}
                />
              ))}
            </VStack>
          </VStack>
        );
      })}
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
          {ready.length
            ? `${ready.length} ${ready.length === 1 ? 'match' : 'matches'} not yet submitted.`
            : 'Choose matches, then submit them together. Excluded students are never submitted.'}
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

const TriageRow = ({
  triaged,
  checked,
  onToggle,
}: {
  triaged: Triaged;
  checked: boolean;
  onToggle: () => void;
}) => {
  const { group, candidates, comparisons, lane } = triaged;
  const { statusOf, decisions, decide, undo } = useReviewSession();
  const [expanded, setExpanded] = useState(false);
  const id = group.correlationId;
  const status = statusOf(id);
  const decision = decisions.get(id);
  const isOpen = status === 'to-review';

  const choose = (candidate: Candidate) => {
    decide(id, { kind: 'match', candidate });
    setExpanded(false);
  };
  const notInRoster = () => {
    decide(id, { kind: 'not-in-roster' });
    setExpanded(false);
  };

  let right: ReactNode;
  if (!isOpen) {
    right = (
      <HStack gap="200">
        <Box fontSize="0.9rem" color={status === 'reprocessed' ? 'green.100' : undefined}>
          {statusText(status, decision)}
        </Box>
        {(status === 'ready' || status === 'excluded') && (
          <QuietButton onClick={() => undo(id)}>Undo</QuietButton>
        )}
      </HStack>
    );
  } else if (lane === 'confirm') {
    right = (
      <QuietButton onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide' : 'Details'}
      </QuietButton>
    );
  } else {
    right = (
      <SecondaryButton onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Close' : lane === 'choose' ? `Choose from ${candidates.length}` : 'Find'}
      </SecondaryButton>
    );
  }

  return (
    <Box
      borderBottomWidth="1px"
      borderColor="blue.50-40"
      _last={{ borderBottomWidth: 0 }}
      opacity={isOpen ? 1 : 0.75}
    >
      <HStack paddingX="300" paddingY="200" gap="300" minHeight="3rem">
        {lane === 'confirm' && (
          <Checkbox
            isChecked={status === 'to-review' && checked}
            isDisabled={status !== 'to-review'}
            onChange={onToggle}
            colorScheme="green"
            aria-label={`Accept the match for ${studentName(group.inputDetails)}`}
          />
        )}
        <VStack alignItems="flex-start" gap="0" width="16rem" flexShrink={0}>
          <Box fontWeight="600">{studentName(group.inputDetails)}</Box>
          <FileLine details={group.inputDetails} />
        </VStack>
        <Box flex="1" minWidth="0">
          {lane === 'confirm' && (
            <HStack gap="300" flexWrap="wrap">
              <Box fontWeight="600">{candidates[0].studentUniqueId}</Box>
              <Chips comparison={comparisons[0]} />
              <ScoreBadge score={candidates[0].score} />
            </HStack>
          )}
          {lane === 'choose' && (
            <Box fontSize="0.9rem" opacity="0.85">
              {candidates.length} suggestions. Highest IDRS score: {candidates[0].studentUniqueId} (
              {candidates[0].score}).
            </Box>
          )}
          {lane === 'find' && (
            <Box fontSize="0.9rem" opacity="0.85">
              No suggestions.
            </Box>
          )}
        </Box>
        {right}
      </HStack>
      {expanded && isOpen && (
        <Box paddingX="300" paddingBottom="300" paddingLeft={lane === 'confirm' ? '800' : '300'}>
          {lane === 'confirm' && (
            <VStack alignItems="flex-start" gap="200" maxWidth="40rem">
              <ComparisonTable
                comparison={comparisons[0]}
                rosterHeading={candidates[0].studentUniqueId}
              />
              <HStack gap="200">
                <PrimaryButton onClick={() => choose(candidates[0])}>Accept this one</PrimaryButton>
                <SecondaryButton onClick={notInRoster}>Not in roster</SecondaryButton>
              </HStack>
            </VStack>
          )}
          {lane === 'choose' && (
            <VStack alignItems="stretch" gap="300">
              <HStack alignItems="stretch" gap="300" overflowX="auto" paddingBottom="200">
                {candidates.map((candidate, index) => (
                  <VStack
                    key={candidate.studentUniqueId}
                    alignItems="flex-start"
                    gap="200"
                    padding="300"
                    bg="blue.600"
                    borderRadius="6px"
                    minWidth="20rem"
                    flex="1"
                  >
                    <Evidence comparison={comparisons[index]} score={candidate.score} />
                    <ComparisonTable
                      comparison={comparisons[index]}
                      rosterHeading={candidate.studentUniqueId}
                    />
                    <PrimaryButton onClick={() => choose(candidate)} marginTop="auto">
                      Match {candidate.studentUniqueId}
                    </PrimaryButton>
                  </VStack>
                ))}
              </HStack>
              <HStack gap="200">
                <SecondaryButton onClick={notInRoster}>
                  None of these: exclude, not in roster
                </SecondaryButton>
              </HStack>
              <SearchPanel group={group} onPick={choose} heading="Or search for someone else" />
            </VStack>
          )}
          {lane === 'find' && (
            <VStack alignItems="flex-start" gap="300">
              <SearchPanel group={group} onPick={choose} />
              <SecondaryButton onClick={notInRoster}>Exclude: not in roster</SecondaryButton>
            </VStack>
          )}
        </Box>
      )}
    </Box>
  );
};

/** Field verdicts in a line, for scanning many rows. */
const Chips = ({ comparison }: { comparison: Comparison }) => (
  <HStack gap="300" fontSize="0.8rem">
    {comparison.fields
      .filter((field) => field.agreement !== 'unknown' || field.label !== 'Student IDs')
      .map((field) => (
        <HStack key={field.label} gap="100">
          <AgreementMark agreement={field.agreement} />
          <Box opacity="0.85">{field.label}</Box>
        </HStack>
      ))}
  </HStack>
);

const statusText = (status: StudentStatus, decision: Decision | undefined) => {
  const chosen = decision?.kind === 'match' ? decision.candidate.studentUniqueId : '';
  if (status === 'reprocessing') return 'Reprocessing…';
  if (status === 'reprocessed') return `Reprocessed with ${chosen}`;
  if (status === 'excluded') return 'Excluded: not in roster';
  if (!decision) return '';
  return `Matched ${chosen}`;
};

import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
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
import { GetStudentInputDetailsDto, StudentInputDetailsJson } from '@edanalytics/models';
import { ReactNode, useState } from 'react';
import { Agreement, compare, Comparison } from './compare';
import { SearchHit, searchRoster, SearchTerms, termsFrom } from './mockIdrs';
import {
  Batch,
  Candidate,
  loadedOf,
  StudentStatus,
  totalOf,
  useReviewSession,
} from './reviewSession';

/*
 * PROTOTYPE ONLY. Pieces shared by the review designs.
 */

const agreementStyle: Record<Agreement, { glyph: string; color: string; label: string }> = {
  same: { glyph: '=', color: 'green.100', label: 'identical' },
  different: { glyph: '≠', color: 'pink.100', label: 'not identical' },
  unknown: { glyph: '·', color: 'blue.50-40', label: 'nothing to compare' },
};

export const AgreementMark = ({ agreement }: { agreement: Agreement }) => {
  const { glyph, color, label } = agreementStyle[agreement];
  return (
    <Box
      as="span"
      color={color}
      fontWeight="700"
      title={label}
      aria-label={label}
      width="1rem"
      textAlign="center"
      display="inline-block"
    >
      {glyph}
    </Box>
  );
};

/** IDRS's score: how good a match is is the matching service's judgment, not the app's. */
export const ScoreBadge = ({ score }: { score: number | null }) =>
  score === null ? null : (
    <Box
      as="span"
      paddingX="200"
      paddingY="1px"
      borderRadius="999px"
      borderWidth="1px"
      borderColor="blue.50-40"
      fontSize="0.8rem"
      fontWeight="600"
      whiteSpace="nowrap"
    >
      IDRS score {score}
    </Box>
  );

/** IDRS's score, and which fields are identical, e.g. "Last name and date of birth match." */
export const Evidence = ({
  comparison,
  score,
}: {
  comparison: Comparison;
  score: number | null;
}) => (
  <HStack gap="200" alignItems="baseline" flexWrap="wrap">
    <ScoreBadge score={score} />
    <Box textStyle="body">{comparison.summary}</Box>
  </HStack>
);

const valueOf = (value: unknown) =>
  typeof value === 'string' && value ? value : Array.isArray(value) ? value.join(', ') : null;

export const studentName = (details: StudentInputDetailsJson) =>
  [valueOf(details.first_name), valueOf(details.last_name)].filter(Boolean).join(' ') ||
  'Unnamed student';

/** The file's record in one line: name, date of birth and IDs. */
export const FileLine = ({ details }: { details: StudentInputDetailsJson }) => (
  <HStack gap="300" flexWrap="wrap" alignItems="baseline">
    <Box fontWeight="600">{studentName(details)}</Box>
    <Box opacity="0.8">born {valueOf(details.birth_date) ?? '—'}</Box>
    <Box opacity="0.8">IDs {valueOf(details.student_ids) ?? '—'}</Box>
  </HStack>
);

const Dash = () => (
  <Box as="span" opacity="0.5">
    —
  </Box>
);

/**
 * The file and one roster student, field by field, with each field's verdict
 * between the two values.
 */
export const ComparisonTable = ({
  comparison,
  rosterHeading = 'In the roster',
}: {
  comparison: Comparison;
  rosterHeading?: ReactNode;
}) => (
  <Table
    size="sm"
    width="100%"
    sx={{ td: { paddingX: '200', paddingY: '100' }, th: { paddingX: '200' } }}
  >
    <Thead>
      <Tr>
        <Th color="blue.50" textTransform="none" fontSize="0.8rem" />
        <Th color="blue.50" textTransform="none" fontSize="0.8rem">
          In your file
        </Th>
        <Th width="1rem" />
        <Th color="blue.50" textTransform="none" fontSize="0.8rem">
          {rosterHeading}
        </Th>
      </Tr>
    </Thead>
    <Tbody>
      {comparison.fields.map((field) => (
        <Tr key={field.label}>
          <Td opacity="0.8" whiteSpace="nowrap">
            {field.label}
          </Td>
          <Td>{field.file ?? <Dash />}</Td>
          <Td>
            <AgreementMark agreement={field.agreement} />
          </Td>
          <Td>{field.roster ?? <Dash />}</Td>
        </Tr>
      ))}
    </Tbody>
  </Table>
);

export const PrimaryButton = (props: React.ComponentProps<typeof Button>) => (
  <Button
    size="sm"
    textStyle="button"
    bg="green.100"
    color="green.600"
    _hover={{ bg: 'green.50' }}
    {...props}
  />
);

export const SecondaryButton = (props: React.ComponentProps<typeof Button>) => (
  <Button
    size="sm"
    textStyle="button"
    variant="outline"
    borderColor="green.100"
    color="green.100"
    _hover={{ bg: 'transparent', borderColor: 'green.50', color: 'green.50' }}
    {...props}
  />
);

export const QuietButton = (props: React.ComponentProps<typeof Button>) => (
  <Button size="sm" variant="ghost" color="blue.50" _hover={{ bg: 'blue.600' }} {...props} />
);

/**
 * Search the roster yourself, starting from the file's details. Results are
 * judged against the file, not the search terms: the file record is what
 * will be loaded, whatever it took to find the student.
 */
export const SearchPanel = ({
  group,
  onPick,
  heading = 'Search the roster',
}: {
  group: GetStudentInputDetailsDto;
  onPick: (candidate: Candidate) => void;
  heading?: ReactNode;
}) => {
  const { roster } = useReviewSession();
  const [terms, setTerms] = useState<SearchTerms>(() => termsFrom(group.inputDetails));
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const run = async () => {
    setSearching(true);
    setHits(await searchRoster(roster, terms));
    setSearching(false);
  };
  const field = (key: keyof SearchTerms, label: string, placeholder?: string) => (
    <FormControl>
      <FormLabel fontSize="0.8rem" marginBottom="100">
        {label}
      </FormLabel>
      <Input
        size="sm"
        value={terms[key]}
        placeholder={placeholder}
        onChange={(event) => setTerms({ ...terms, [key]: event.target.value })}
        onKeyDown={(event) => event.key === 'Enter' && run()}
      />
    </FormControl>
  );

  return (
    <VStack alignItems="flex-start" width="100%" gap="300">
      <Box textStyle="h6">{heading}</Box>
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="200" width="100%">
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('birth_date', 'Date of birth', 'YYYY-MM-DD')}
        {field('student_unique_id', 'Student unique ID', 'narrows to one')}
      </SimpleGrid>
      <HStack gap="300">
        <SecondaryButton onClick={run} isLoading={searching}>
          Search
        </SecondaryButton>
        <Box fontSize="0.8rem" opacity="0.7">
          Prototype: searches a pretend roster.
        </Box>
      </HStack>
      {searching && <Spinner size="sm" color="blue.50" />}
      {hits && !searching && (
        <VStack alignItems="flex-start" width="100%" gap="300">
          {hits.length === 0 && <Box>No one in the roster matches those details.</Box>}
          {hits.map((hit) => {
            const comparison = compare(group.inputDetails, hit.rosterDetails);
            return (
              <Box
                key={hit.studentUniqueId}
                width="100%"
                padding="300"
                borderRadius="6px"
                bg="blue.600"
              >
                <HStack justifyContent="space-between" alignItems="flex-start" gap="300">
                  <VStack alignItems="flex-start" gap="100" flex="1">
                    <Evidence comparison={comparison} score={hit.score} />
                    <ComparisonTable comparison={comparison} rosterHeading={hit.studentUniqueId} />
                  </VStack>
                  <PrimaryButton
                    onClick={() =>
                      onPick({
                        studentUniqueId: hit.studentUniqueId,
                        rosterDetails: hit.rosterDetails,
                        score: null,
                        source: 'search',
                      })
                    }
                  >
                    Match
                  </PrimaryButton>
                </HStack>
              </Box>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

const BatchCard = ({ batch, number }: { batch: Batch; number: number }) => {
  const { groups } = useReviewSession();
  const [open, setOpen] = useState(false);
  const nameOf = (correlationId: string) => {
    const group = groups.find((g) => g.correlationId === correlationId);
    return group ? studentName(group.inputDetails) : correlationId;
  };
  const counts = totalOf(batch.summary);
  const isDone = batch.status === 'complete' || batch.status === 'complete with errors';
  return (
    <Box width="100%" padding="300" borderRadius="6px" bg="blue.600">
      <HStack justifyContent="space-between" gap="300" flexWrap="wrap">
        <Box fontWeight="600">
          Batch {number} · {batch.items.length} {batch.items.length === 1 ? 'student' : 'students'}{' '}
          · submitted {time(batch.submittedAt)}
        </Box>
        <Box
          fontSize="0.9rem"
          color={batch.status === 'complete with errors' ? 'pink.100' : undefined}
        >
          {batch.status === 'queued' && 'Queued for reprocessing'}
          {batch.status === 'processing' && 'Reprocessing'}
          {batch.status === 'complete' && 'Complete'}
          {batch.status === 'complete with errors' && 'Complete with errors'}
        </Box>
      </HStack>
      {!isDone && (
        <Progress
          marginTop="200"
          size="xs"
          colorScheme="progressGreen"
          isIndeterminate
          borderRadius="999px"
        />
      )}
      {isDone && (
        <VStack alignItems="flex-start" gap="100" marginTop="200" fontSize="0.9rem">
          <Box>
            {counts.processed} assessment {counts.processed === 1 ? 'record' : 'records'} processed:{' '}
            {loadedOf(counts)} loaded
            {counts.skipped > 0 && `, ${counts.skipped} skipped`}
            {counts.failed > 0 && (
              <Box as="span" color="pink.100">
                , {counts.failed} failed
              </Box>
            )}
            .
          </Box>
          {counts.failed > 0 && (
            <Box opacity="0.85">
              The run can't say which students the failed records belong to. The matches still
              stand; support can trace the failures from the run's troubleshooting logs.
            </Box>
          )}
        </VStack>
      )}
      <QuietButton marginTop="100" paddingX="0" onClick={() => setOpen(!open)}>
        {open ? 'Hide students' : 'Show students'}
      </QuietButton>
      {open && (
        <VStack alignItems="flex-start" gap="100" marginTop="100">
          {batch.items.map((item) => (
            <HStack key={item.correlationId} gap="200" alignItems="baseline" flexWrap="wrap">
              <Box minWidth="10rem">{nameOf(item.correlationId)}</Box>
              <Box opacity="0.8">→ {item.decision.candidate.studentUniqueId}</Box>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
};

/** Every submitted batch, newest first. Batches run side by side. */
export const BatchActivity = ({ emptyText }: { emptyText?: string }) => {
  const { batches } = useReviewSession();
  if (!batches.length) {
    return emptyText ? <Box opacity="0.7">{emptyText}</Box> : null;
  }
  return (
    <VStack alignItems="flex-start" width="100%" gap="200">
      {[...batches].reverse().map((batch) => (
        <BatchCard key={batch.id} batch={batch} number={batches.indexOf(batch) + 1} />
      ))}
    </VStack>
  );
};

/**
 * Where the job's review stands. Review is done when every student has been
 * excluded or had a reprocessing run attempted with their match.
 */
export const ReviewProgress = () => {
  const { groups, statusOf, batches } = useReviewSession();
  const count = (status: StudentStatus) =>
    groups.filter((g) => statusOf(g.correlationId) === status).length;
  const excluded = count('excluded');
  const reprocessed = count('reprocessed');
  const unfinished = batches.filter((b) => b.status === 'queued' || b.status === 'processing');
  const failed = batches.reduce((sum, b) => sum + totalOf(b.summary).failed, 0);
  const isDone = groups.length > 0 && excluded + reprocessed === groups.length;
  return (
    <HStack
      width="100%"
      gap="300"
      padding="300"
      borderRadius="6px"
      borderWidth="1px"
      borderColor={isDone ? (failed ? 'pink.100' : 'green.100') : 'blue.50-40'}
      flexWrap="wrap"
      fontSize="0.9rem"
    >
      <Box fontWeight="600">
        {isDone
          ? failed
            ? 'Review done, with delivery errors'
            : 'Review done'
          : `${groups.length - excluded - reprocessed} of ${
              groups.length
            } students still to finish`}
      </Box>
      <Box opacity="0.85">
        {reprocessed} reprocessed · {excluded} excluded
        {count('reprocessing') > 0 && ` · ${count('reprocessing')} reprocessing`}
        {count('ready') > 0 && ` · ${count('ready')} ready to submit`}
        {count('to-review') > 0 && ` · ${count('to-review')} to review`}
      </Box>
      {failed > 0 && (
        <Box color="pink.100">
          {failed} assessment {failed === 1 ? 'record' : 'records'} failed to load across{' '}
          {batches.filter((b) => totalOf(b.summary).failed > 0).length} of{' '}
          {batches.length - unfinished.length} finished batches
        </Box>
      )}
    </HStack>
  );
};

export const ResetPrototype = () => {
  const { reset } = useReviewSession();
  return (
    <QuietButton onClick={reset} fontSize="0.8rem" opacity="0.7">
      Reset prototype
    </QuietButton>
  );
};

/** A heading for a design, with the bet it makes. */
export const DesignIntro = ({ title, bet }: { title: string; bet: string }) => (
  <HStack width="100%" justifyContent="space-between" alignItems="flex-start" gap="300">
    <VStack alignItems="flex-start" gap="100">
      <Box textStyle="h4">{title}</Box>
      <Box opacity="0.8" maxWidth="50rem">
        {bet}
      </Box>
    </VStack>
    <ResetPrototype />
  </HStack>
);

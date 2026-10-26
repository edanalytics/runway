import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Progress,
  VStack,
} from '@chakra-ui/react';
import { GetStudentInputDetailsDto, StudentInputDetailsJson } from '@edanalytics/models';
import { ReactNode, useState } from 'react';
import { Agreement } from './compare';
import { Batch, Candidate, isFinished, loadedOf, totalOf, useReviewSession } from './reviewSession';

/*
 * Pieces of the match review.
 */

// Shape as well as color tells the marks apart: identical is filled, not
// identical is outlined, nothing to compare is a faint dot.
const agreementStyle: Record<
  Agreement,
  { glyph: string; label: string; color: string; bg?: string; border?: string }
> = {
  same: { glyph: '=', label: 'identical', color: 'green.600', bg: 'green.100' },
  different: { glyph: '≠', label: 'not identical', color: 'pink.100', border: 'pink.100' },
  unknown: { glyph: '·', label: 'nothing to compare', color: 'blue.50-40' },
};

export const AgreementMark = ({ agreement }: { agreement: Agreement }) => {
  const { glyph, label, color, bg, border } = agreementStyle[agreement];
  return (
    <Box
      as="span"
      role="img"
      title={label}
      aria-label={label}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      width="1.5rem"
      height="1.5rem"
      borderRadius="4px"
      fontSize="1.1rem"
      fontWeight="700"
      lineHeight="1"
      color={color}
      bg={bg}
      borderWidth={border ? '2px' : undefined}
      borderColor={border}
    >
      {glyph}
    </Box>
  );
};

const valueOf = (value: unknown) =>
  typeof value === 'string' && value ? value : Array.isArray(value) ? value.join(', ') : null;

export const studentName = (details: StudentInputDetailsJson) =>
  [valueOf(details.first_name), valueOf(details.last_name)].filter(Boolean).join(' ') ||
  'Unnamed student';

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
 * A roster-search field in the theme's input style. The theme's labels are
 * bold and bright; here the label is small and muted so the value, which
 * the reviewer is reading and correcting, stands out.
 */
export const SearchField = ({
  id,
  label,
  value,
  placeholder,
  onChange,
  onEnter,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) => (
  <FormControl>
    <FormLabel
      htmlFor={id}
      textStyle="body"
      fontSize="0.75rem"
      fontWeight="normal"
      color="blue.50"
      opacity="0.7"
      marginBottom="100"
    >
      {label}
    </FormLabel>
    <Input
      id={id}
      size="sm"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.key === 'Enter' && onEnter()}
    />
  </FormControl>
);

/**
 * When no suggestion fits, or there were none: two ways forward, set apart
 * so searching and excluding never read as the same kind of step.
 */
export const NoSuggestionFits = ({
  group,
  suggestionCount,
  onBack,
  onUse,
  onExclude,
  search,
  children,
}: {
  group: GetStudentInputDetailsDto;
  suggestionCount: number;
  search: ReactNode;
  /** Back to the suggestions, when the reviewer came from them. */
  onBack?: () => void;
  onUse: (candidate: Candidate) => void;
  onExclude: () => void;
  /** Context shown above the options, e.g. problems in the file. */
  children?: ReactNode;
}) => (
  <VStack alignItems="stretch" gap="300">
    <HStack justifyContent="space-between" gap="300" flexWrap="wrap">
      <Box textStyle="h5">
        {suggestionCount === 0
          ? 'No suggestions for this student'
          : suggestionCount === 1
          ? 'Not the suggested student'
          : 'None of the suggestions'}
      </Box>
      {onBack && (
        <QuietButton onClick={onBack}>
          ← Back to {suggestionCount === 1 ? 'the suggestion' : 'the suggestions'}
        </QuietButton>
      )}
    </HStack>
    {children}
    <OptionBox
      title="Search the roster"
      detail="Look them up with corrected details, and any IDs you have for them. Using a result matches them and moves on."
    >
      {search}
    </OptionBox>
    <HStack gap="300" opacity="0.7" fontSize="0.85rem">
      <Box flex="1" borderTopWidth="1px" borderColor="blue.50-40" />
      <Box>or</Box>
      <Box flex="1" borderTopWidth="1px" borderColor="blue.50-40" />
    </HStack>
    <OptionBox
      title="Exclude this record from the job"
      detail="For junk data, or a student who isn't in the roster. Their records won't be reprocessed. You can undo this."
      tone="caution"
    >
      <SecondaryButton
        alignSelf="flex-start"
        borderColor="pink.100"
        color="pink.100"
        onClick={onExclude}
      >
        Exclude from this job
      </SecondaryButton>
    </OptionBox>
  </VStack>
);

/** One of the ways forward when no suggestion fits, set apart from the other. */
const OptionBox = ({
  title,
  detail,
  tone,
  children,
}: {
  title: string;
  detail: string;
  tone?: 'caution';
  children: ReactNode;
}) => (
  <VStack
    alignItems="stretch"
    gap="200"
    padding="300"
    borderRadius="6px"
    borderWidth="1px"
    borderColor={tone === 'caution' ? 'pink.100' : 'blue.50-40'}
  >
    <Box textStyle="h6">{title}</Box>
    <Box fontSize="0.85rem" opacity="0.85">
      {detail}
    </Box>
    {children}
  </VStack>
);

export const BatchCard = ({ batch }: { batch: Batch }) => {
  const { groups, retry } = useReviewSession();
  const [open, setOpen] = useState(false);
  const nameOf = (correlationId: string) => {
    const group = groups.find((g) => g.correlationId === correlationId);
    return group ? studentName(group.inputDetails) : correlationId;
  };
  const counts = totalOf(batch.summary);
  const isDone = batch.status === 'complete' || batch.status === 'complete with errors';
  return (
    <Box width="100%" padding="300" borderRadius="6px" bg="blue.600">
      {batch.status === 'failed' && (
        <HStack marginTop="200" gap="300" fontSize="0.9rem" flexWrap="wrap">
          <Box>The run failed before reporting a summary, so nothing was attempted.</Box>
          <SecondaryButton onClick={() => retry(batch.id)}>Retry this batch</SecondaryButton>
        </HStack>
      )}
      {!isFinished(batch) && (
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

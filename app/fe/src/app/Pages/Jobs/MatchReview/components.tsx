import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import {
  GetStudentInputDetailsDto,
  GetStudentMatchDecisionDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
} from '@edanalytics/models';
import { CheckIcon, CopyIcon } from '@chakra-ui/icons';
import { IconExclamation } from '../../../../assets/icons';
import { ReactNode, useState } from 'react';
import { Agreement } from './compare';
import { crossYearOf } from './crossYear';
import { valueText } from './values';
import { Candidate, useReviewSession } from './reviewSession';

/*
 * Pieces of the match review.
 */

export const FailureIndicator = () => (
  <Box
    as="span"
    display="inline-flex"
    alignItems="center"
    justifyContent="center"
    boxSize="1rem"
    flexShrink={0}
    borderRadius="full"
    bg="pink.400"
    aria-hidden="true"
  >
    <IconExclamation width={12} height={12} />
  </Box>
);

// Shape as well as color tells the marks apart: identical is filled, not
// identical is outlined, nothing to compare is a quieter dot. They sit on a
// candidate's blue.600 band, where ≠ is pink.50 (6.1:1) for a text glyph's
// 4.5:1, and the dot blue.200 (3.3:1), the 3:1 a graphic needs.
const agreementStyle: Record<
  Agreement,
  { glyph: string; label: string; color: string; bg?: string; border?: string }
> = {
  same: { glyph: '=', label: 'identical', color: 'green.600', bg: 'green.100' },
  different: { glyph: '≠', label: 'not identical', color: 'pink.50', border: 'pink.50' },
  unknown: { glyph: '·', label: 'nothing to compare', color: 'blue.200' },
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

export const studentName = (details: StudentInputDetailsJson) =>
  [valueText(details.first_name), valueText(details.last_name)].filter(Boolean).join(' ') ||
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
 * the reviewer is reading and correcting, stands out. Autocomplete is off,
 * so the student details typed here stay out of the browser's form history,
 * and `FormControl` pairs the label with the input by an id it generates.
 */
export const SearchField = ({
  label,
  value,
  placeholder,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) => (
  <FormControl>
    <FormLabel
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
      size="sm"
      autoComplete="off"
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
  suggestionCount,
  onBack,
  onExclude,
  search,
  children,
}: {
  suggestionCount: number;
  search: ReactNode;
  /** Back to the suggestions, when the reviewer came from them. */
  onBack?: () => void;
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

/**
 * The suggestions from the latest search IDRS ran for this student, the last
 * result, from the highest run: the one a match to a suggestion must pick
 * from. Earlier ones are history. The read orders results by run, and each
 * result's suggestions by ordinal.
 */
export const suggestionsOf = ({ results }: GetStudentInputDetailsDto): Candidate[] => {
  const latest = results[results.length - 1];
  if (!latest) return [];
  return latest.suggestions.map((s) => ({
    studentUniqueId: s.studentUniqueId,
    rosterDetails: s.rosterDetails,
    score: s.score,
    source: 'suggestion' as const,
    // A match to a suggestion names it by its result and position.
    resultId: latest.id,
    ordinal: s.ordinal,
  }));
};

/** The candidate a student's match rests on: its suggestion, or its search. Null unless matched. */
export const matchedCandidate = ({
  decision,
  results,
}: GetStudentInputDetailsDto): Candidate | null => {
  if (decision?.kind !== 'match') return null;
  const { studentUniqueId, search, resultId, ordinal } = decision;
  // A guard: every match has its answer and exactly one basis. The DTO's
  // fields are nullable for an exclude, and for the basis a match doesn't use.
  if (studentUniqueId === null) return null;
  if (search) {
    return {
      studentUniqueId,
      rosterDetails: search.rosterDetails,
      score: null,
      source: 'search',
      searchDetails: search.searchDetails as StudentSearchDetailsDto,
    };
  }
  if (resultId === null || ordinal === null) return null;
  const suggestion = results
    .find((r) => r.id === resultId)
    ?.suggestions.find((s) => s.ordinal === ordinal);
  return {
    studentUniqueId,
    rosterDetails: suggestion?.rosterDetails ?? {},
    score: suggestion?.score ?? null,
    source: 'suggestion',
    resultId,
    ordinal,
  };
};

/** Whether the current user saved this decision. */
export const isOwnDecision = (decision: GetStudentMatchDecisionDto, meId: number | undefined) =>
  !!decision.decidedBy && decision.decidedBy.id === meId;

/** Who saved a decision, as the page names them. */
export const deciderName = (decision: GetStudentMatchDecisionDto, meId: number | undefined) =>
  isOwnDecision(decision, meId) ? 'you' : decision.decidedBy?.displayName ?? 'someone';

/** A second identifier beside the name, so similarly named records stay distinguishable. */
export const secondId = (student: GetStudentInputDetailsDto) => {
  const d = student.inputDetails;
  return [
    valueText(d.birth_date) && `b. ${valueText(d.birth_date)}`,
    valueText(d.student_ids) && `ID ${valueText(d.student_ids)}`,
  ]
    .filter(Boolean)
    .join(' · ');
};

const copy = (value: string) => {
  navigator.clipboard?.writeText(value).catch(() => undefined);
};

export const CopyButton = ({ value, label }: { value: string; label?: string }) => {
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

/** A date and time, short: a job's review can span days. */
export const dateTime = (at: Date | number) =>
  new Date(at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

/**
 * A warning on a roster student outside the job's school year, who'd be sent
 * as a cross-year match, or with no school years to tell, whom submit
 * refuses. Nothing for a student in the job's year. It doesn't block saving
 * the match. Its own background keeps its text readable on any surface.
 */
export const CrossYearCue = ({
  rosterDetails,
}: {
  rosterDetails: StudentRosterDetailsJson | null | undefined;
}) => {
  const { job } = useReviewSession();
  const crossYear = crossYearOf(rosterDetails, job.schoolYear.endYear);
  if (crossYear === 'in-year') return null;
  return (
    <Tooltip
      hasArrow
      label={
        crossYear === 'cross-year'
          ? `Their school years don't include ${job.schoolYear.displayName}. A cross-year match is loaded outside the ODS.`
          : "Their roster record has no valid school years, so this match can't be submitted."
      }
    >
      <Box
        as="span"
        tabIndex={0}
        display="inline-block"
        paddingX="200"
        borderRadius="999px"
        bg="pink.400"
        color="pink.50"
        fontSize="0.75rem"
        fontWeight="600"
        whiteSpace="nowrap"
      >
        {crossYear === 'cross-year'
          ? `Not enrolled in ${job.schoolYear.displayName}`
          : 'School years unknown'}
      </Box>
    </Tooltip>
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

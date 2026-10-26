import { Box, HStack, VStack } from '@chakra-ui/react';
import { GetStudentInputDetailsDto, JsonValue } from '@edanalytics/models';
import { useEffect, useRef } from 'react';
import { studentName, secondId, valueText, suggestionsOf } from './components';
import { Decision, StudentStatus } from './reviewSession';

// Queue ----------------------------------------------------------------------

export type CountFilter = 'none' | 'one' | 'several';

export const countFilters: { key: CountFilter; label: string; test: (n: number) => boolean }[] = [
  { key: 'none', label: 'No suggestions', test: (n) => n === 0 },
  { key: 'one', label: 'One', test: (n) => n === 1 },
  { key: 'several', label: 'Several', test: (n) => n > 1 },
];

export type SortKey = 'file' | 'name' | 'birth' | 'score';
export type Sort = { key: SortKey; descending: boolean };

/** Each sort's natural first direction: best scores first. */
export const sorts: { key: SortKey; label: string; descending: boolean }[] = [
  { key: 'file', label: 'File order', descending: false },
  { key: 'name', label: 'Last name', descending: false },
  { key: 'birth', label: 'Date of birth', descending: false },
  { key: 'score', label: 'Top match score', descending: true },
];

const lastNameOf = (student: GetStudentInputDetailsDto) =>
  `${valueText(student.inputDetails.last_name) ?? ''} ${
    valueText(student.inputDetails.first_name) ?? ''
  }`.toLowerCase();

const topScore = (student: GetStudentInputDetailsDto) =>
  Math.max(-1, ...suggestionsOf(student).map((c) => c.score ?? -1));

/** The list's groups, one per status, in the order work moves through them. */
export const sections: { status: StudentStatus; finished?: boolean }[] = [
  { status: 'to-review' },
  { status: 'run-failed' },
  { status: 'ready' },
  { status: 'reprocessing' },
  // Finished work starts collapsed, out of the way of what's left to do.
  { status: 'reprocessed', finished: true },
  { status: 'excluded', finished: true },
];

/**
 * For a group that scrolls: a faint, flat glow (blue.50) inside each edge
 * with more beyond it, and a rule beneath, so the group ends visibly before
 * the next one starts.
 * The covers scroll with the content and hide each glow at its end.
 */
export const scrollEdges = {
  borderBottomWidth: '1px',
  borderColor: 'blue.50-40',
  background: `
    linear-gradient(var(--chakra-colors-blue-700) 30%, transparent) top,
    linear-gradient(transparent, var(--chakra-colors-blue-700) 70%) bottom,
    linear-gradient(rgba(236, 251, 255, 0.18), transparent) top,
    linear-gradient(transparent, rgba(236, 251, 255, 0.18)) bottom`,
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 2rem, 100% 2rem, 100% 0.25rem, 100% 0.25rem',
  backgroundAttachment: 'local, local, scroll, scroll',
};

export const sectionIndex = (status: StudentStatus) =>
  sections.findIndex((section) => section.status === status);

export const sortBy =
  ({ key, descending }: Sort) =>
  (a: GetStudentInputDetailsDto, b: GetStudentInputDetailsDto) => {
    const text = (v: JsonValue | undefined) => valueText(v) ?? '';
    const order =
      key === 'name'
        ? lastNameOf(a).localeCompare(lastNameOf(b))
        : key === 'birth'
        ? text(a.inputDetails.birth_date).localeCompare(text(b.inputDetails.birth_date))
        : key === 'score'
        ? topScore(a) - topScore(b)
        : 0;
    return descending ? -order : order;
  };

/** What the list's search box matches against: name, birth date and IDs. */
export const searchText = (student: GetStudentInputDetailsDto) =>
  [studentName(student.inputDetails), secondId(student)].join(' ').toLowerCase();

export const QueueRow = ({
  student,
  decision,
  status,
  isSelected,
  onSelect,
}: {
  student: GetStudentInputDetailsDto;
  decision: Decision | undefined;
  status: StudentStatus;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const count = suggestionsOf(student).length;
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
      <Box fontWeight="600">{studentName(student.inputDetails)}</Box>
      <HStack justifyContent="space-between" gap="200" fontSize="0.75rem" opacity="0.75">
        <Box>{secondId(student)}</Box>
        <Box whiteSpace="nowrap">
          {status === 'ready' && decision?.kind === 'match'
            ? decision.candidate.studentUniqueId
            : `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`}
        </Box>
      </HStack>
    </VStack>
  );
};

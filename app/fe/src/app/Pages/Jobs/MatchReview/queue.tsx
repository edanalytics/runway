import {
  Box,
  Button,
  HStack,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItemOption,
  MenuList,
  MenuOptionGroup,
  VStack,
} from '@chakra-ui/react';
import { GetStudentInputDetailsDto, JsonValue, StudentMatchStatus } from '@edanalytics/models';
import { useEffect, useRef, useState } from 'react';
import { PrimaryButton, QuietButton, studentName, secondId, suggestionsOf } from './components';
import { statusLabel } from './reviewSession';
import { valueText } from './values';

export type CountFilter = 'none' | 'one' | 'several';

export const countFilters: { key: CountFilter; label: string; test: (n: number) => boolean }[] = [
  { key: 'none', label: 'No suggestions', test: (n) => n === 0 },
  { key: 'one', label: 'One', test: (n) => n === 1 },
  { key: 'several', label: 'Several', test: (n) => n > 1 },
];

export type SortKey = 'name' | 'birth' | 'score';
export type Sort = { key: SortKey; descending: boolean };

/**
 * Each sort's natural first direction: best scores first. Last name comes
 * first, as the default: the API's order is by correlation id, a hash, so
 * the page has no file order to offer.
 */
export const sorts: { key: SortKey; label: string; descending: boolean }[] = [
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
export const sections: { status: StudentMatchStatus; finished?: boolean }[] = [
  { status: 'to-review' },
  { status: 'ready' },
  { status: 'reprocessing' },
  { status: 'run-failed' },
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

export const sectionIndex = (status: StudentMatchStatus) =>
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
        : topScore(a) - topScore(b);
    return descending ? -order : order;
  };

/** What the list's search box matches against: name, birth date and IDs. */
export const searchText = (student: GetStudentInputDetailsDto) =>
  [studentName(student.inputDetails), secondId(student)].join(' ').toLowerCase();

export const QueueRow = ({
  student,
  isSelected,
  onSelect,
}: {
  student: GetStudentInputDetailsDto;
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
      {/* Full strength: dimmed, it falls below AA on the selected row's blue.500. */}
      <HStack justifyContent="space-between" gap="200" fontSize="0.75rem">
        <Box>{secondId(student)}</Box>
        <Box whiteSpace="nowrap">
          {student.status === 'ready' && student.decision?.kind === 'match'
            ? student.decision.studentUniqueId
            : `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`}
        </Box>
      </HStack>
    </VStack>
  );
};

/**
 * The list's search, sort and suggestion filter, and the students they leave,
 * in the list's order, which previous, next and advancing follow too.
 */
export const useQueue = (students: GetStudentInputDetailsDto[]) => {
  // null means that filter is off.
  const [countFilter, setCountFilter] = useState<CountFilter | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'name', descending: false });

  const countTest = countFilters.find((f) => f.key === countFilter)?.test ?? (() => true);
  const terms = query.trim().toLowerCase();
  const queue = students
    .filter(
      (student) =>
        countTest(suggestionsOf(student).length) && (!terms || searchText(student).includes(terms))
    )
    .sort(sortBy(sort))
    // The list reads section by section, so previous and next do too.
    .sort((a, b) => sectionIndex(a.status) - sectionIndex(b.status));
  const filtered = countFilter !== null || !!terms;
  const clearFilters = () => {
    setCountFilter(null);
    setQuery('');
  };
  return {
    queue,
    query,
    setQuery,
    sort,
    setSort,
    countFilter,
    setCountFilter,
    filtered,
    clearFilters,
  };
};

/**
 * The list beside the student pane, grouped by status: the students, and the
 * one submit button among those ready to submit.
 */
export const Queue = ({
  list,
  total,
  ready,
  shownId,
  submitBlocked,
  onSelect,
  onReview,
}: {
  list: ReturnType<typeof useQueue>;
  total: number;
  ready: GetStudentInputDetailsDto[];
  /** The student the pane shows, if any. */
  shownId: string | null;
  submitBlocked: string | null;
  onSelect: (correlationId: string) => void;
  onReview: () => void;
}) => {
  const {
    queue,
    query,
    setQuery,
    sort,
    setSort,
    countFilter,
    setCountFilter,
    filtered,
    clearFilters,
  } = list;
  const [openFinished, setOpenFinished] = useState<Set<StudentMatchStatus>>(() => new Set());
  const toggleFinished = (status: StudentMatchStatus) =>
    setOpenFinished((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });

  const searchBox = (
    <Input
      id="match-review-queue-search"
      size="sm"
      autoComplete="off"
      placeholder="Search"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      aria-label="Search the list"
    />
  );
  // The side list's sort and filters, folded into one menu. The button counts
  // what's changed from the default, so a narrowed list is never a mystery.
  const changedOptions = [countFilter !== null, sort.key !== 'name'].filter(Boolean).length;
  const optionStyle = { bg: 'blue.700', _hover: { bg: 'blue.600' }, _focus: { bg: 'blue.600' } };
  const listOptions = (
    <Menu closeOnSelect={false} placement="bottom-end">
      <MenuButton
        as={Button}
        size="sm"
        variant="outline"
        flexShrink={0}
        fontWeight="400"
        color="blue.50"
        borderColor={changedOptions ? 'blue.50' : 'blue.50-40'}
        bg={changedOptions ? 'blue.600' : undefined}
        _hover={{ bg: 'blue.600' }}
        _active={{ bg: 'blue.600' }}
      >
        Sort & filter{changedOptions ? ` · ${changedOptions}` : ''}
      </MenuButton>
      <MenuList
        bg="blue.700"
        borderColor="blue.50-40"
        color="blue.50"
        fontSize="0.85rem"
        zIndex={2}
      >
        <MenuOptionGroup
          title="Sort"
          type="radio"
          value={sort.key}
          onChange={(key) =>
            setSort({
              key: key as SortKey,
              descending: sorts.find((s) => s.key === key)?.descending ?? false,
            })
          }
        >
          {sorts.map((s) => (
            <MenuItemOption key={s.key} value={s.key} {...optionStyle}>
              {s.label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
        <MenuDivider borderColor="blue.50-40" />
        <MenuOptionGroup
          title="Suggestions"
          type="radio"
          value={countFilter ?? 'any'}
          onChange={(key) => setCountFilter(key === 'any' ? null : (key as CountFilter))}
        >
          <MenuItemOption value="any" {...optionStyle}>
            Any number
          </MenuItemOption>
          {countFilters.map(({ key, label }) => (
            <MenuItemOption key={key} value={key} {...optionStyle}>
              {label}
            </MenuItemOption>
          ))}
        </MenuOptionGroup>
      </MenuList>
    </Menu>
  );
  const countLine = (
    <HStack fontSize="0.8rem" gap="200" minHeight="1.5rem">
      <Box opacity="0.8" whiteSpace="nowrap">
        {queue.length} of {total} students
      </Box>
      {filtered && (
        <QuietButton size="xs" onClick={clearFilters}>
          Clear filters
        </QuietButton>
      )}
    </HStack>
  );

  return (
    <VStack
      width="20rem"
      flexShrink={0}
      alignItems="stretch"
      layerStyle="contentBox"
      padding="300"
      gap="300"
      position="sticky"
      top="0"
      maxHeight="100vh"
    >
      {/* One row of controls, so the list's groups lead. The count
            line shows only while something is filtered out. */}
      <HStack gap="200">
        <Box flex="1" minWidth="0">
          {searchBox}
        </Box>
        {listOptions}
      </HStack>
      {filtered && countLine}
      <VStack alignItems="stretch" gap="0" flex="1" minHeight="0" overflowY="auto" marginX="-200">
        {queue.length === 0 && (
          <Box padding="200" opacity="0.8" fontSize="0.9rem">
            Nothing matches.{' '}
            <QuietButton size="xs" onClick={clearFilters}>
              Clear filters
            </QuietButton>
          </Box>
        )}
        {sections.map(({ status, finished }) => {
          const title = statusLabel[status];
          const members = queue.filter((student) => student.status === status);
          // A folded group opens while its student is the one shown,
          // e.g. after stepping to it with previous and next.
          const holdsSelected = members.some((student) => student.correlationId === shownId);
          const isOpen = !finished || openFinished.has(status) || holdsSelected;
          // Saved matches and the button that submits them sit
          // together, in one place, even when empty.
          const isReadyBox = status === 'ready';
          if (!members.length && !isReadyBox) return null;
          const list = (
            <VStack
              key={status}
              alignItems="stretch"
              gap="0"
              marginBottom={isReadyBox ? '0' : '200'}
            >
              {!finished && (
                <Box fontSize="0.8rem" fontWeight="600" opacity="0.8" paddingX="200" paddingY="100">
                  {title} ({members.length})
                </Box>
              )}
              {finished && (
                <HStack
                  as="button"
                  onClick={holdsSelected ? undefined : () => toggleFinished(status)}
                  aria-expanded={isOpen}
                  gap="100"
                  fontSize="0.8rem"
                  fontWeight="600"
                  opacity="0.8"
                  paddingX="200"
                  paddingY="100"
                  textAlign="left"
                  _hover={{ opacity: 1 }}
                >
                  <Box width="0.8rem">{isOpen ? '▾' : '▸'}</Box>
                  <Box>
                    {title} ({members.length})
                  </Box>
                </HStack>
              )}
              {isOpen && (
                // A long group scrolls within its own height (about
                // ten students), so the groups below stay in view.
                <VStack
                  alignItems="stretch"
                  gap="0"
                  maxHeight="32rem"
                  overflowY="auto"
                  {...(members.length > 10 ? scrollEdges : {})}
                >
                  {members.map((student) => (
                    <QueueRow
                      key={student.correlationId}
                      student={student}
                      isSelected={student.correlationId === shownId}
                      onSelect={() => onSelect(student.correlationId)}
                    />
                  ))}
                </VStack>
              )}
            </VStack>
          );
          if (!isReadyBox) return list;
          return (
            <VStack
              key={status}
              alignItems="stretch"
              gap="200"
              padding="200"
              marginX="100"
              marginBottom="200"
              borderRadius="6px"
              borderWidth="1px"
              borderColor="blue.50-40"
            >
              {list}
              {!members.length && (
                <Box fontSize="0.8rem" opacity="0.7" paddingX="200">
                  Students you match land here until you submit them.
                </Box>
              )}
              <PrimaryButton
                width="100%"
                isDisabled={!ready.length || !!submitBlocked}
                onClick={onReview}
              >
                Review and submit {ready.length || ''} {ready.length === 1 ? 'match' : 'matches'}
              </PrimaryButton>
              {submitBlocked && (
                <Box fontSize="0.8rem" opacity="0.8" paddingX="200">
                  {submitBlocked}
                </Box>
              )}
            </VStack>
          );
        })}
      </VStack>
    </VStack>
  );
};

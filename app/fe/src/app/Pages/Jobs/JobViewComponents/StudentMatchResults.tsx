import {
  Box,
  IconButton,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { GetJobDto, GetStudentInputDetailsDto, JsonValue } from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { runwayTableSx } from '../../../components/Table/RunwayStdTable';
import { IconMinus, IconPlus } from '../../../../assets/icons';

/** Known fields first, in this order; anything else IDRS sends follows. */
const FIELDS: Record<string, string> = {
  first_name: 'First name',
  middle_name: 'Middle name',
  last_name: 'Last name',
  birth_date: 'Date of birth',
  student_ids: 'Student IDs',
  school_ids: 'School IDs',
  school_years: 'School years',
};

/** A stored detail as text, or null when it's missing or empty. */
const format = (value: JsonValue | undefined): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (Array.isArray(value)) {
    const items = value.map(format).filter((item) => item !== null);
    return items.length ? items.join(', ') : null;
  }
  if (typeof value === 'object') {
    // Roster student ids arrive as { id_type, id_value }.
    if ('id_value' in value) {
      return value.id_type ? `${value.id_type}: ${value.id_value}` : String(value.id_value);
    }
    return JSON.stringify(value);
  }
  return String(value);
};

const Missing = () => (
  <Box as="span" opacity="0.5">
    —
  </Box>
);

// The shared table highlights rows on hover. An expanded row, and the
// comparison table inside it, aren't rows to pick, so they don't.
const tableSx = {
  ...runwayTableSx,
  'tbody tr[data-expanded-row]:hover, tbody tr[data-expanded-row] tr:hover': {
    bg: 'transparent',
  },
};

/** Every student IDRS could not resolve, one expandable row each. */
export const StudentMatchResults = ({ job }: { job: GetJobDto }) => {
  const { data: groups, isLoading, isError } = useQuery(getJobStudentMatchResults(String(job.id)));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (correlationId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(correlationId)) {
        next.add(correlationId);
      }
      return next;
    });

  if (isLoading) {
    return <Spinner size="md" color="blue.50" speed="0.75s" />;
  }
  if (isError) {
    return <Box textStyle="body">Couldn't load unmatched students.</Box>;
  }
  if (!groups?.length) {
    return (
      <Box textStyle="body">No unmatched students have been reported for this assessment.</Box>
    );
  }

  return (
    <VStack width="100%" alignItems="flex-start" gap="300">
      <Box textStyle="body">
        {groups.length} unmatched {groups.length === 1 ? 'student' : 'students'}
      </Box>
      <Box width="100%" layerStyle="contentBox" padding="300">
        <Table size="sm" sx={tableSx}>
          <Thead>
            <Tr>
              <Th width="1%" />
              <Th>Student</Th>
              <Th>Student IDs</Th>
              <Th isNumeric>Suggestions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {groups.map((group) => {
              const isOpen = expanded.has(group.correlationId);
              return (
                <Fragment key={group.correlationId}>
                  <Tr cursor="pointer" onClick={() => toggle(group.correlationId)}>
                    <Td>
                      <IconButton
                        aria-label={isOpen ? 'Hide suggestions' : 'Show suggestions'}
                        aria-expanded={isOpen}
                        icon={isOpen ? <IconMinus /> : <IconPlus />}
                        size="xs"
                        variant="ghost"
                        color="blue.50"
                      />
                    </Td>
                    <Td>{summarize(group)}</Td>
                    <Td>{format(group.inputDetails.student_ids) ?? <Missing />}</Td>
                    <Td isNumeric>{suggestionsOf(group).length}</Td>
                  </Tr>
                  {isOpen && (
                    <Tr data-expanded-row>
                      <Td colSpan={4} paddingTop="0">
                        <Comparison group={group} />
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
};

const suggestionsOf = (group: GetStudentInputDetailsDto) =>
  group.results.flatMap((result) =>
    result.suggestions.map((suggestion) => ({
      ...suggestion,
      key: `${result.id}-${suggestion.ordinal}`,
    }))
  );

/** "First Last (date of birth)", from whichever of those were sent. */
const summarize = (group: GetStudentInputDetailsDto) => {
  const { first_name, last_name, birth_date } = group.inputDetails;
  const name = [format(first_name), format(last_name)].filter(Boolean).join(' ');
  const dob = format(birth_date);
  return (
    <>
      {name || <Missing />}
      {dob && ` (${dob})`}
    </>
  );
};

/**
 * The student's details on the left, one row per field, with each suggestion
 * as a column to the right. The student's columns stay put while the
 * suggestions scroll sideways.
 */
const Comparison = ({ group }: { group: GetStudentInputDetailsDto }) => {
  const suggestions = suggestionsOf(group);
  const sent = new Set([
    ...Object.keys(group.inputDetails),
    ...suggestions.flatMap((suggestion) => Object.keys(suggestion.rosterDetails)),
  ]);
  const fields = [
    ...Object.keys(FIELDS).filter((field) => sent.has(field)),
    ...[...sent].filter((field) => !(field in FIELDS)).sort(),
  ];

  // Opaque, so scrolled columns pass underneath the pinned ones. The student
  // column pins just past the label column, so that one has a fixed width.
  const pinned = { position: 'sticky', bg: 'blue.700', zIndex: 1 } as const;
  const labelWidth = '9rem';

  return (
    <Box
      overflowX="auto"
      width="100%"
      borderRadius="4px"
      borderWidth="1px"
      borderColor="blue.50-40"
    >
      <Table size="sm" sx={runwayTableSx}>
        <Thead>
          <Tr>
            <Th
              {...pinned}
              left="0"
              width={labelWidth}
              minWidth={labelWidth}
              maxWidth={labelWidth}
            />
            <Th {...pinned} left={labelWidth} minWidth="13rem">
              Student
            </Th>
            {suggestions.map((suggestion) => (
              <Th key={suggestion.key} minWidth="13rem">
                <Box>
                  #{suggestion.ordinal + 1} · {suggestion.studentUniqueId}
                </Box>
                <Box fontWeight="400">score {suggestion.score}</Box>
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {fields.map((field) => (
            <Tr key={field}>
              <Td {...pinned} left="0" fontWeight="600">
                {FIELDS[field] ?? field}
              </Td>
              <Td {...pinned} left={labelWidth}>
                {format(group.inputDetails[field as keyof typeof group.inputDetails]) ?? (
                  <Missing />
                )}
              </Td>
              {suggestions.map((suggestion) => (
                <Td key={suggestion.key}>
                  {format(
                    suggestion.rosterDetails[field as keyof typeof suggestion.rosterDetails]
                  ) ?? <Missing />}
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </Table>
      {!suggestions.length && (
        <Box textStyle="body" padding="300">
          IDRS found no suggestions for this student.
        </Box>
      )}
    </Box>
  );
};

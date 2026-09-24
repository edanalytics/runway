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
import { GetJobDto, GetStudentInputDetailsDto } from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { runwayTableSx } from '../../../components/Table/RunwayStdTable';
import { IconMinus, IconPlus } from '../../../../assets/icons';
import {
  Detail,
  FIELDS,
  fieldsIn,
  format,
  Missing,
  suggestionsOf,
  tableSx,
} from './studentMatchDisplay';

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
                    <Td>
                      <Detail details={group.inputDetails} field="student_ids" />
                    </Td>
                    <Td isNumeric>{suggestionsOf(group).length}</Td>
                  </Tr>
                  {isOpen && (
                    <Tr data-no-hover>
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
  const fields = fieldsIn([
    group.inputDetails,
    ...suggestions.map((suggestion) => suggestion.rosterDetails),
  ]);

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
                <Detail details={group.inputDetails} field={field} />
              </Td>
              {suggestions.map((suggestion) => (
                <Td key={suggestion.key}>
                  <Detail details={suggestion.rosterDetails} field={field} />
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

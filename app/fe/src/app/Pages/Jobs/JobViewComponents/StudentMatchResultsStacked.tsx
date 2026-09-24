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
import { GetJobDto } from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';
import { IconMinus, IconPlus } from '../../../../assets/icons';
import { Detail, FIELDS, fieldsIn, suggestionsOf, tableSx } from './studentMatchDisplay';

/**
 * Every student IDRS could not resolve, one row each, with a column per field.
 * Expanding a row lists its suggestions beneath it in the same columns, so each
 * field compares down the column.
 */
export const StudentMatchResultsStacked = ({ job }: { job: GetJobDto }) => {
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

  // One column set for the whole table, so every row lines up.
  const fields = fieldsIn(
    groups.flatMap((group) => [
      group.inputDetails,
      ...suggestionsOf(group).map((suggestion) => suggestion.rosterDetails),
    ])
  );

  return (
    <VStack width="100%" alignItems="flex-start" gap="300">
      <Box textStyle="body">
        {groups.length} unmatched {groups.length === 1 ? 'student' : 'students'}
      </Box>
      <Box width="100%" overflowX="auto" layerStyle="contentBox" padding="300">
        <Table size="sm" sx={tableSx}>
          <Thead>
            <Tr>
              <Th width="1%" />
              <Th>Suggestion</Th>
              <Th isNumeric>Score</Th>
              {fields.map((field) => (
                <Th key={field} whiteSpace="nowrap">
                  {FIELDS[field] ?? field}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {groups.map((group) => {
              const isOpen = expanded.has(group.correlationId);
              const suggestions = suggestionsOf(group);
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
                    <Td whiteSpace="nowrap" fontWeight="600">
                      {suggestions.length} {suggestions.length === 1 ? 'suggestion' : 'suggestions'}
                    </Td>
                    <Td />
                    {fields.map((field) => (
                      <Td key={field} fontWeight="600">
                        <Detail details={group.inputDetails} field={field} />
                      </Td>
                    ))}
                  </Tr>
                  {isOpen &&
                    (suggestions.length ? (
                      suggestions.map((suggestion) => (
                        <Tr key={suggestion.key} data-no-hover bg="blue.600">
                          <Td />
                          <Td whiteSpace="nowrap">
                            #{suggestion.ordinal + 1} · {suggestion.studentUniqueId}
                          </Td>
                          <Td isNumeric>{suggestion.score}</Td>
                          {fields.map((field) => (
                            <Td key={field}>
                              <Detail details={suggestion.rosterDetails} field={field} />
                            </Td>
                          ))}
                        </Tr>
                      ))
                    ) : (
                      <Tr data-no-hover bg="blue.600">
                        <Td />
                        <Td colSpan={fields.length + 2}>
                          IDRS found no suggestions for this student.
                        </Td>
                      </Tr>
                    ))}
                </Fragment>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    </VStack>
  );
};

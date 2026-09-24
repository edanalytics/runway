import {
  Box,
  Button,
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
import { IconCheckmark, IconMinus, IconPlus } from '../../../../assets/icons';
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
  // Each student's chosen suggestion, by key. In memory only, for trying out
  // the interaction: nothing is saved, and a reload clears it.
  const [matches, setMatches] = useState<Map<string, string>>(new Map());
  const choose = (correlationId: string, suggestionKey: string) =>
    setMatches((current) => {
      const next = new Map(current);
      if (next.get(correlationId) === suggestionKey) {
        next.delete(correlationId);
      } else {
        next.set(correlationId, suggestionKey);
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

  // One column set for the whole table, so every row lines up. Middle name is
  // left out: only suggestions carry it, so it would be empty on every
  // student's row.
  const fields = fieldsIn(
    groups.flatMap((group) => [
      group.inputDetails,
      ...suggestionsOf(group).map((suggestion) => suggestion.rosterDetails),
    ])
  ).filter((field) => field !== 'middle_name');

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
              {fields.map((field) => (
                <Th key={field} whiteSpace="nowrap">
                  {FIELDS[field] ?? field}
                </Th>
              ))}
              <Th isNumeric>Score</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {groups.map((group) => {
              const isOpen = expanded.has(group.correlationId);
              const suggestions = suggestionsOf(group);
              const matched = suggestions.find(
                (suggestion) => suggestion.key === matches.get(group.correlationId)
              );
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
                      {matched ? (
                        <Box as="span" color="green.100">
                          Matched {matched.studentUniqueId}
                        </Box>
                      ) : (
                        `${suggestions.length} ${
                          suggestions.length === 1 ? 'suggestion' : 'suggestions'
                        }`
                      )}
                    </Td>
                    {fields.map((field) => (
                      <Td key={field} fontWeight="600">
                        <Detail details={group.inputDetails} field={field} />
                      </Td>
                    ))}
                    <Td />
                    <Td />
                  </Tr>
                  {isOpen &&
                    (suggestions.length ? (
                      suggestions.map((suggestion) => (
                        <Tr key={suggestion.key} data-no-hover bg="blue.600">
                          <Td />
                          <Td whiteSpace="nowrap">{suggestion.studentUniqueId}</Td>
                          {fields.map((field) => (
                            <Td key={field}>
                              <Detail details={suggestion.rosterDetails} field={field} />
                            </Td>
                          ))}
                          <Td isNumeric>{suggestion.score}</Td>
                          <Td>
                            {matched?.key === suggestion.key ? (
                              <Button
                                size="sm"
                                textStyle="button"
                                bg="green.100"
                                color="green.600"
                                _hover={{ bg: 'green.50' }}
                                leftIcon={<IconCheckmark />}
                                onClick={() => choose(group.correlationId, suggestion.key)}
                              >
                                Matched
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                textStyle="button"
                                variant="outline"
                                borderColor="green.100"
                                color="green.100"
                                _hover={{
                                  bg: 'transparent',
                                  borderColor: 'green.50',
                                  color: 'green.50',
                                }}
                                onClick={() => choose(group.correlationId, suggestion.key)}
                              >
                                Match
                              </Button>
                            )}
                          </Td>
                        </Tr>
                      ))
                    ) : (
                      <Tr data-no-hover bg="blue.600">
                        <Td />
                        <Td colSpan={fields.length + 3}>
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

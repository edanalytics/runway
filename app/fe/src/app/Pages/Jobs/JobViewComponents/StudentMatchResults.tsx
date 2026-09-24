import { Box, HStack, Spinner, Table, Tbody, Td, Th, Thead, Tr, VStack } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { GetJobDto, GetStudentInputDetailsDto, JsonValue } from '@edanalytics/models';
import { getJobStudentMatchResults } from '../../../api/queries/job.queries';

/** Every student IDRS could not resolve, with each run's suggestions. */
export const StudentMatchResults = ({ job }: { job: GetJobDto }) => {
  const { data: groups, isLoading, isError } = useQuery(getJobStudentMatchResults(String(job.id)));

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
    <VStack width="100%" alignItems="flex-start" gap="400">
      <Box textStyle="body">
        {groups.length} unmatched {groups.length === 1 ? 'student' : 'students'}
      </Box>
      {groups.map((group) => (
        <InputGroup key={group.correlationId} group={group} />
      ))}
    </VStack>
  );
};

const InputGroup = ({ group }: { group: GetStudentInputDetailsDto }) => (
  <VStack width="100%" alignItems="flex-start" layerStyle="contentBox" padding="400" gap="300">
    <Box textStyle="h5">Input details</Box>
    <Details details={group.inputDetails} />
    <Box textStyle="h6">
      correlation id {group.correlationId} · reported by run {group.sourceRunId} on{' '}
      {group.createdOn.toLocaleString()}
    </Box>

    {group.results.map((result) => (
      <VStack key={result.id} width="100%" alignItems="flex-start" gap="200" marginTop="300">
        <Box textStyle="h5">
          Run {result.runId} · {result.suggestions.length}{' '}
          {result.suggestions.length === 1 ? 'suggestion' : 'suggestions'}
        </Box>
        {result.suggestions.length > 0 && (
          <Table size="sm">
            <Thead>
              <Tr>
                <Th>#</Th>
                <Th>Student unique id</Th>
                <Th>Score</Th>
                <Th>Roster details</Th>
              </Tr>
            </Thead>
            <Tbody>
              {result.suggestions.map((suggestion) => (
                <Tr key={suggestion.ordinal}>
                  <Td>{suggestion.ordinal + 1}</Td>
                  <Td>{suggestion.studentUniqueId}</Td>
                  <Td>{suggestion.score}</Td>
                  <Td>
                    <Details details={suggestion.rosterDetails} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </VStack>
    ))}
  </VStack>
);

/** Key-value pairs from stored JSON, shown as sent. */
const Details = ({ details }: { details: Record<string, JsonValue | undefined> }) => (
  <VStack alignItems="flex-start" gap="100">
    {Object.entries(details).map(([key, value]) => (
      <HStack key={key} gap="200" alignItems="baseline">
        <Box textStyle="bodyBold">{key}</Box>
        <Box textStyle="body">{typeof value === 'string' ? value : JSON.stringify(value)}</Box>
      </HStack>
    ))}
  </VStack>
);

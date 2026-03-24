import { useState } from 'react';
import { Box, Button, HStack, Table, Tbody, Td, Th, Thead, Tr, VStack, Badge } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { schoolYearConfigQueries } from '../../api/queries/school-year-config.queries';
import { SchoolYearConfigEditForm } from './SchoolYearConfigEditForm';

export const SchoolYearConfigSection = () => {
  const { data, isLoading } = useQuery(schoolYearConfigQueries);
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !data) {
    return <Box textStyle="body">Loading...</Box>;
  }

  return (
    <VStack align="stretch" gap="300">
      <HStack justify="space-between" align="center">
        <Box as="h2" textStyle="h2">
          school year config
        </Box>
        {!isEditing && (
          <Button
            size="sm"
            layerStyle="buttonPrimary"
            onClick={() => setIsEditing(true)}
          >
            edit
          </Button>
        )}
      </HStack>
      <Box textStyle="body" color="blue.100">
        {data.partnerName}
      </Box>

      {isEditing ? (
        <SchoolYearConfigEditForm
          data={data}
          onCancel={() => setIsEditing(false)}
          onSaved={() => setIsEditing(false)}
        />
      ) : (
        <Table variant="simple" size="sm">
          <Thead>
            <Tr>
              <Th>School Year</Th>
              <Th>Enabled</Th>
              <Th>Send to ODS</Th>
              <Th>ODS Count</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.rows.map((row) => (
              <Tr key={row.schoolYearId}>
                <Td>{row.startYear} - {row.endYear}</Td>
                <Td>
                  <Badge colorScheme={row.isEnabled ? 'green' : 'gray'}>
                    {row.isEnabled ? 'yes' : 'no'}
                  </Badge>
                </Td>
                <Td>
                  <Badge colorScheme={row.sendToOds ? 'green' : 'gray'}>
                    {row.sendToOds ? 'yes' : 'no'}
                  </Badge>
                </Td>
                <Td>{row.odsCount}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </VStack>
  );
};

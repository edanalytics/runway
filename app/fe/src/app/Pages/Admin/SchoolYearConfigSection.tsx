import { useState } from 'react';
import { Box, Button, HStack, Table, Tbody, Td, Th, Thead, Tr, VStack, Badge } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { schoolYearConfigQueries } from '../../api/queries/school-year-config.queries';
import { SchoolYearConfigEditForm } from './SchoolYearConfigEditForm';

export const SchoolYearConfigSection = () => {
  const { data: config, isLoading } = useQuery(schoolYearConfigQueries);
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !config) {
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

      {isEditing ? (
        <SchoolYearConfigEditForm
          data={config.rows}
          lastModifiedOn={config.lastModifiedOn}
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
              <Th>ODS</Th>
            </Tr>
          </Thead>
          <Tbody>
            {config.rows.map((row) => (
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
                <Td>
                  <Badge colorScheme={row.hasOds ? 'green' : 'gray'}>
                    {row.hasOds ? 'yes' : 'no'}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </VStack>
  );
};

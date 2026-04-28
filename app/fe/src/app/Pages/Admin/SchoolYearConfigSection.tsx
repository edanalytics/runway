import { useState } from 'react';
import {
  Box,
  Button,
  HStack,
  TableContainer,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  Badge,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { schoolYearConfigQuery } from '../../api/queries/school-year-config.queries';
import { SchoolYearConfigEditForm } from './SchoolYearConfigEditForm';
import { runwayTableSx } from '../../components/Table/RunwayStdTable';

export const SchoolYearConfigSection = () => {
  const { data: config, isLoading } = useQuery(schoolYearConfigQuery);
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !config) {
    return <Box textStyle="body">loading...</Box>;
  }

  return (
    <VStack align="stretch" gap="200">
      <HStack justify="space-between" align="baseline">
        <Box as="h3" textStyle="h3">
          school year configuration
        </Box>
        {!isEditing && (
          <Button
            variant="ghost"
            textStyle="button"
            textColor="green.100"
            px="200"
            py="200"
            _hover={{ bg: 'transparent' }}
            onClick={() => setIsEditing(true)}
          >
            edit
          </Button>
        )}
      </HStack>

      {isEditing ? (
        <SchoolYearConfigEditForm
          data={config.rows}
          modifiedAt={config.modifiedAt}
          tableSx={runwayTableSx}
          onCancel={() => setIsEditing(false)}
          onSaved={() => setIsEditing(false)}
        />
      ) : (
        <TableContainer
          overflow="auto"
          maxWidth="calc(100vw - 320px)"
          layerStyle="contentBox"
          padding="300"
        >
          <Table variant="simple" size="sm" sx={runwayTableSx}>
            <Thead>
              <Tr>
                <Th>School Year</Th>
                <Th>Enabled?</Th>
                <Th>Send to ODS?</Th>
                <Th>ODS Count</Th>
              </Tr>
            </Thead>
            <Tbody>
              {config.rows.map((row) => (
                <Tr key={row.schoolYearId}>
                  <Td>
                    {row.startYear} - {row.endYear}
                  </Td>
                  <Td>
                    <Badge
                      borderRadius="999px"
                      bg={row.isEnabled ? 'green.100' : 'blue.800'}
                      color={row.isEnabled ? 'green.600' : 'green.50'}
                      px="200"
                      py="100"
                      textTransform="none"
                    >
                      {row.isEnabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge
                      borderRadius="999px"
                      bg={row.sendToOds ? 'green.100' : 'blue.800'}
                      color={row.sendToOds ? 'green.600' : 'green.50'}
                      px="200"
                      py="100"
                      textTransform="none"
                    >
                      {row.sendToOds ? 'sending' : 'not sending'}
                    </Badge>
                  </Td>
                  <Td>{row.odsCount}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      )}
    </VStack>
  );
};

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
import { schoolYearConfigQueries } from '../../api/queries/school-year-config.queries';
import { SchoolYearConfigEditForm } from './SchoolYearConfigEditForm';

const tableShellSx = {
  borderCollapse: 'separate',
  borderSpacing: '0px',
  th: {
    borderBottom: '1px solid',
    borderColor: 'blue.50-40',
    padding: '300',
    color: 'blue.50',
    fontSize: '0.875rem',
    fontWeight: '600',
    letterSpacing: '0.02em',
    textTransform: 'none',
  },
  td: {
    padding: '300',
    color: 'blue.50',
    borderTop: '1px solid',
    borderColor: 'transparent',
  },
  thead: {
    '&::after': {
      content: '""',
      display: 'block',
      width: '100%',
      height: '8px',
      backgroundColor: 'transparent',
    },
  },
  tbody: {
    tr: {
      transition: 'background-color 120ms ease',
      _hover: {
        bg: 'blue.600',
        '& td:first-of-type': {
          borderLeftRadius: '4px',
        },
        '& td:last-of-type': {
          borderRightRadius: '4px',
        },
      },
    },
  },
} as const;

export const SchoolYearConfigSection = () => {
  const { data: config, isLoading } = useQuery(schoolYearConfigQueries);
  const [isEditing, setIsEditing] = useState(false);

  if (isLoading || !config) {
    return <Box textStyle="body">loading...</Box>;
  }

  return (
    <VStack align="stretch" gap="300">
      <HStack justify="space-between" align="center">
        <Box as="h3" textStyle="h3">
          school years
        </Box>
        {!isEditing && (
          <Button
            layerStyle="buttonPrimary"
            textStyle="button"
            px="300"
            py="300"
            onClick={() => setIsEditing(true)}
          >
            edit
          </Button>
        )}
      </HStack>

      {isEditing ? (
        <SchoolYearConfigEditForm
          data={config.rows}
          etag={config.etag}
          tableSx={tableShellSx}
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
          <Table variant="simple" size="sm" sx={tableShellSx}>
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
                  <Td>{row.startYear} - {row.endYear}</Td>
                  <Td>
                    <Badge
                      borderRadius="999px"
                      bg={row.isEnabled ? 'green.100' : 'blue.800'}
                      color={row.isEnabled ? 'green.600' : 'blue.100'}
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
                      bg={row.sendToOds ? 'green.100' : 'pink.100'}
                      color={row.sendToOds ? 'green.600' : 'pink.400'}
                      px="200"
                      py="100"
                      textTransform="none"
                    >
                      {row.sendToOds ? 'sending' : 'sideload only'}
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

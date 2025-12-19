import { Box, HStack } from '@chakra-ui/react';
import { StdTable } from './StdTable';
import { StdTableFilters } from './StdTableFilters';
import { StdTablePagination } from './StdTablePagination';
import { StdTableProvider } from './StdTableProvider';
import { StdTableSearch, StdTableAdvancedButton } from './StdTableSearch';

export const StdTableAllInOne: typeof StdTableProvider = (props) => (
  <StdTableProvider {...props}>
    <Box mb={4}>
      <HStack align="end">
        <StdTableSearch />
        <StdTableAdvancedButton />
      </HStack>
      <StdTableFilters mb={4} />
    </Box>
    <StdTable />
    <StdTablePagination />
  </StdTableProvider>
);

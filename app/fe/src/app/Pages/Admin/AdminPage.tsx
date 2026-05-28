import { Box, VStack } from '@chakra-ui/react';
import { useMe } from '../../api/queries/me.queries';
import { SchoolYearConfigSection } from './SchoolYearConfigSection';
import { CrossYearMatchingSection } from './CrossYearMatchingSection';

export const AdminPage = () => {
  const { data: me } = useMe();
  const partnerId = me?.tenant?.partnerId;

  return (
    <VStack paddingBottom="800" align="stretch" gap="300">
      <Box as="h1" textStyle="h1">
        admin settings ({partnerId})
      </Box>
      <SchoolYearConfigSection />
      <CrossYearMatchingSection />
    </VStack>
  );
};

import { Box, VStack } from '@chakra-ui/react';
import { useMe } from '../../api/queries/me.queries';
import { SchoolYearConfigSection } from './SchoolYearConfigSection';

export const AdminPage = () => {
  const { data: me } = useMe();
  const isPartnerAdmin = me?.roles?.includes('PartnerAdmin') ?? false;
  const partnerId = me?.tenant?.partnerId;

  if (!isPartnerAdmin) {
    return (
      <VStack paddingBottom="800" align="stretch">
        <Box as="h1" textStyle="h1">
          admin
        </Box>
        {partnerId && (
          <Box textStyle="body" color="green.600">
            partner: {partnerId}
          </Box>
        )}
        <Box textStyle="body" color="pink.100">
          You do not have permission to view this page.
        </Box>
      </VStack>
    );
  }

  return (
    <VStack paddingBottom="800" align="stretch" gap="300">
      <Box as="h1" textStyle="h1">
        admin settings
      </Box>
      {partnerId && (
        <Box as="h2" textStyle="h2">
          partner configuration: {partnerId}
        </Box>
      )}
      <SchoolYearConfigSection />
    </VStack>
  );
};

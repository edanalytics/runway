import { Box, VStack } from '@chakra-ui/react';
import { CrossYearMatching } from './CrossYearMatching';
import { PartnerMatchingMode } from './PartnerMatchingMode';

export const PartnerConfig = () => (
  <VStack as="section" aria-labelledby="partner-config-heading" align="stretch" gap="200" mt="500">
    <Box as="h3" id="partner-config-heading" textStyle="h3">
      partner-wide configuration
    </Box>
    <VStack align="stretch" gap="300">
      <CrossYearMatching />
      <PartnerMatchingMode />
    </VStack>
  </VStack>
);

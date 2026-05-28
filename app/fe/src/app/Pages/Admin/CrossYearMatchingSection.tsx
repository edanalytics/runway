import { Badge, Box, HStack, Switch, Text, VStack } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import {
  partnerConfigQuery,
  useUpdatePartnerConfig,
} from '../../api/queries/partner-config.queries';

const switchSx = {
  '.chakra-switch__track': {
    bg: 'blue.800',
    _checked: { bg: 'green.300' },
  },
  '.chakra-switch__thumb': { bg: 'blue.50' },
} as const;

export const CrossYearMatchingSection = () => {
  const { data: config, isLoading } = useQuery(partnerConfigQuery);
  const update = useUpdatePartnerConfig();

  if (isLoading || !config) {
    return <Box textStyle="body">loading...</Box>;
  }

  // FE-side gate: spec disables the enable action when EDU creds are missing.
  // The backend tolerates the enabled-without-creds state; this is UX guidance.
  const toggleDisabled = !config.eduCredsExist && !config.crossYearMatchingEnabled;

  return (
    <VStack align="stretch" gap="200">
      <Box as="h3" textStyle="h3">
        cross-year ID matching
      </Box>
      <Box layerStyle="contentBox" padding="300">
        <VStack align="stretch" gap="300">
          <HStack justify="space-between">
            <VStack align="start" gap="100">
              <Text textStyle="body">enable cross-year ID matching</Text>
              <Text textStyle="caption" color="green.600">
                when on, jobs match student IDs against prior-year rosters via EDU.
              </Text>
            </VStack>
            <Switch
              sx={switchSx}
              isChecked={config.crossYearMatchingEnabled}
              isDisabled={toggleDisabled || update.isPending}
              onChange={(e) =>
                update.mutate({ crossYearMatchingEnabled: e.target.checked })
              }
            />
          </HStack>

          <HStack justify="space-between">
            <Text textStyle="body">EDU connection</Text>
            <Badge
              borderRadius="999px"
              bg={config.eduCredsExist ? 'green.100' : 'pink.100'}
              color={config.eduCredsExist ? 'green.600' : 'blue.50'}
              px="200"
              py="100"
              textTransform="none"
            >
              {config.eduCredsExist ? 'connected' : 'not connected'}
            </Badge>
          </HStack>

          {!config.eduCredsExist && (
            <Text textStyle="caption" color="green.600">
              EDU credentials are provisioned in AWS Secrets Manager. Cred rotation
              currently requires an app restart to take effect.
            </Text>
          )}
        </VStack>
      </Box>
    </VStack>
  );
};

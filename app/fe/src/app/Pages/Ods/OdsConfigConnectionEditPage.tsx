import { useParams } from '@tanstack/react-router';
import { odsConfigQueries } from '../../api';
import { OdsConfigConnectionEditForm } from './ConnectionForm/OdsConfigConnectionEditForm';
import { useSuspenseQuery, useQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../../api/queries/school-year-config.queries';
import { Box, HStack } from '@chakra-ui/react';
import { IconExclamation } from '../../../assets/icons';

export const OdsConfigConnectionEditPage = () => {
  const { odsConfigId } = useParams({ from: '/ods-configs/$odsConfigId/connection' });
  const { data: odsConfig } = useSuspenseQuery(odsConfigQueries.getOne({ id: odsConfigId }));
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);

  const yearConfig = yearConfigs?.find((y) => y.schoolYearId === odsConfig.schoolYearId);
  const isNonOdsYear = !yearConfig || !yearConfig.sendToOds;

  return (
    <>
      {isNonOdsYear && yearConfigs && (
        <Box
          layerStyle="blueOutline"
          padding="300"
          marginBottom="400"
          bg="pink.400"
          borderColor="pink.300"
        >
          <HStack gap="200">
            <IconExclamation />
            <Box textStyle="bodyLarge">
              This school year is not configured to send data to an ODS. This configuration will not
              be used for job processing.
            </Box>
          </HStack>
        </Box>
      )}
      <OdsConfigConnectionEditForm odsConfig={odsConfig} />
    </>
  );
};

import { Box, HStack, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from '@tanstack/react-router';
import { IconPlus } from '../../../assets/icons';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { useSuspenseQuery } from '@tanstack/react-query';
import { jobQueries } from '../../api/queries/job.queries';
import { JobsTable } from './JobsTable';

export const JobsPage = () => {
  const { data: jobs } = useSuspenseQuery(jobQueries.getAll({}));
  jobs.sort(
    (a, b) =>
      (b.lastRun?.createdOn ? b.lastRun.createdOn.getTime() : 0) - // TODO: separate DTO for configured job where run is required
      (a.lastRun?.createdOn ? a.lastRun.createdOn?.getTime() : 0)
  );

  return (
    <VStack paddingBottom="800" align="stretch">
      <HStack justify="space-between" marginBottom="300">
        <Box as="h1" textStyle="h1">
          assessments
        </Box>
        <HStack
          as={RouterLink}
          to="/assessments/new"
          maxWidth="16.5rem"
          width="100%"
          h="min-content"
          justify="center"
          padding="300"
          gap="200"
          layerStyle="buttonPrimary"
          textStyle="button"
        >
          <Box padding="100">
            <IconPlus />
          </Box>
          <Box textStyle="button" as="span">
            add assessment
          </Box>
        </HStack>
      </HStack>
      {jobs.length === 0 ? (
        <RunwayErrorBox
          message="You haven’t added any assessments. Click the “add assessment” button above to upload your first assessment set."
          showButton={false}
          iconBgColor="green.600"
          marginBottom="500"
        />
      ) : (
        <JobsTable jobs={jobs} />
      )}
    </VStack>
  );
};

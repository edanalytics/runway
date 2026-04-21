import { Box, Flex, HStack, VStack } from '@chakra-ui/react';
import { Link } from '@tanstack/react-router';
import { IconArrowRight } from '../../../assets/icons';
import { ContactSupport } from '../../components/SupportButton';
import { useSuspenseQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../../api/queries/school-year-config.queries';

// Reachable only when no enabled year is ready to receive jobs (see the home
// route loader in routes/index.tsx). The goal of this page is to direct the
// user at whatever will unblock them:
//   - If any year is configured to send to an ODS, guide them to configure
//     one — that's the only step they can take themselves.
//   - Otherwise, they need an admin to either load a roster file or enable
//     school years, so point them at support.
export const SetupRequiredPage = () => {
  const { data: yearConfigs } = useSuspenseQuery(tenantSchoolYearConfigQuery);

  if (yearConfigs.length === 0) {
    return (
      <SetupMessage title="No School Years Enabled">
        <Box textStyle="bodyLarge">
          No school years have been enabled for your district. Please contact support for
          assistance.
        </Box>
        <ContactSupport message="No school years are enabled for my district." />
      </SetupMessage>
    );
  }

  const doesAnyYearSendToOds = yearConfigs.some((y) => y.sendToOds);
  if (!doesAnyYearSendToOds) {
    return (
      <SetupMessage title="Roster File Required">
        <Box textStyle="bodyLarge">
          Before you can start uploading assessments, a roster file must be loaded for your
          district. Please contact support for assistance.
        </Box>
        <ContactSupport message="Roster file needs to be loaded for my district." />
      </SetupMessage>
    );
  }

  return (
    <SetupMessage title="No ODS Configured">
      <Box textStyle="bodyLarge">
        Before you can start uploading assessments you will need to set up an ODS connection.
      </Box>
      <HStack
        as={Link}
        to="/ods-configs/new/connection"
        layerStyle="buttonPrimary"
        textStyle="button"
        padding="300"
        gap="200"
        width="100%"
        maxW="17rem"
        justifyContent="center"
      >
        <Box>setup your ODS</Box>
        <Box padding="100">
          <IconArrowRight />
        </Box>
      </HStack>
    </SetupMessage>
  );
};

const SetupMessage = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Flex justifyContent="center" alignItems="center" width="100%" height="100%">
    <VStack
      justifyContent="flex-start"
      alignItems="flex-start"
      width="100%"
      maxW="30rem"
      layerStyle="blueOutline"
      padding="400"
      gap="400"
    >
      <Box textStyle="h4" as="h4">
        {title}
      </Box>
      {children}
    </VStack>
  </Flex>
);

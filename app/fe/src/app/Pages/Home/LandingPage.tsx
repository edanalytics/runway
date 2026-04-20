import { Box, Flex, HStack, VStack } from '@chakra-ui/react';
import { Link } from '@tanstack/react-router';
import { IconArrowRight } from '../../../assets/icons';
import { ContactSupport } from '../../components/SupportButton';
import { useQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../../api/queries/school-year-config.queries';

// Reachable only when the home route loader's canProceed check returned false
// (see routes/index.tsx). Branches below assume at least one year cannot proceed.
//
// Messaging centers on ODS as the primary processing path. We only mention
// roster files when sideloading is the only way data can be processed (i.e.
// every enabled year is sendToOds=false). In any mixed case, point the user at
// ODS setup — the sideloading years are handled out-of-band with support.
export const LandingPage = () => {
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);

  if (!yearConfigs) return null;

  if (yearConfigs.length === 0) {
    return <LandingMessage title="No School Years Enabled" body={<NoEnabledYearsBody />} />;
  }

  const noneSendToOds = yearConfigs.every((y) => !y.sendToOds);
  if (noneSendToOds) {
    return <LandingMessage title="Roster File Required" body={<NoRosterBody />} />;
  }

  return <LandingMessage title="No ODS Configured" body={<NoOdsBody />} />;
};

const LandingMessage = ({ title, body }: { title: string; body: React.ReactNode }) => (
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
      {body}
    </VStack>
  </Flex>
);

const NoOdsBody = () => (
  <>
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
  </>
);

const NoRosterBody = () => (
  <>
    <Box textStyle="bodyLarge">
      Before you can start uploading assessments, a roster file must be loaded for your district.
      Please contact support for assistance.
    </Box>
    <ContactSupport message="Roster file needs to be loaded for my district." />
  </>
);

const NoEnabledYearsBody = () => (
  <>
    <Box textStyle="bodyLarge">
      No school years have been enabled for your district. Please contact your administrator.
    </Box>
    <ContactSupport message="No school years are enabled for my district." />
  </>
);

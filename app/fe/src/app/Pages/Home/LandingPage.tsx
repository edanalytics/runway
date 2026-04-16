import { Box, Flex, HStack, VStack } from '@chakra-ui/react';
import { Link } from '@tanstack/react-router';
import { IconArrowRight } from '../../../assets/icons';
import { ContactSupport } from '../../components/SupportButton';
import { useQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../../api/queries/school-year-config.queries';

export const LandingPage = () => {
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);

  if (!yearConfigs) return null;

  if (yearConfigs.length === 0) {
    return <LandingMessage title="No School Years Enabled" body={<NoEnabledYearsBody />} />;
  }

  const hasOdsYearWithoutOds = yearConfigs.some((y) => y.sendToOds && !y.hasOds);
  const hasNoOdsYearWithoutRoster = yearConfigs.some(
    (y) => !y.sendToOds && y.hasRoster !== true
  );
  const allSendToOds = yearConfigs.every((y) => y.sendToOds);
  const noneSendToOds = yearConfigs.every((y) => !y.sendToOds);

  if (allSendToOds && hasOdsYearWithoutOds) {
    return <LandingMessage title="No ODS Configured" body={<NoOdsBody />} />;
  }

  if (noneSendToOds && hasNoOdsYearWithoutRoster) {
    return <LandingMessage title="Roster File Required" body={<NoRosterBody />} />;
  }

  // Mixed: some years send to ODS (but none configured), some don't (but no roster)
  return <LandingMessage title="Setup Required" body={<MixedBody />} />;
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
      Before you can start uploading assessments, a roster file must be loaded for your account.
      Please contact support for assistance.
    </Box>
    <ContactSupport message="Roster file needs to be loaded for my account." />
  </>
);

const MixedBody = () => (
  <>
    <Box textStyle="bodyLarge">
      Before you can start uploading assessments, you will need to set up an ODS connection or
      contact your administrator about loading roster files.
    </Box>
    <ContactSupport message="I need help setting up my account to upload assessments." />
  </>
);

const NoEnabledYearsBody = () => (
  <>
    <Box textStyle="bodyLarge">
      No school years have been enabled for your account. Please contact your administrator.
    </Box>
    <ContactSupport message="No school years are enabled for my account." />
  </>
);

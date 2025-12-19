import { Box, Flex, HStack, VStack } from '@chakra-ui/react';
import { Link } from '@tanstack/react-router';
import { IconArrowRight } from '../../../assets/icons';

export const NoOdsMessagePage = () => {
  return (
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
          No ODS Configured
        </Box>
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
      </VStack>
    </Flex>
  );
};

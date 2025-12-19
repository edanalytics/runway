import { Box, HStack, VStack } from '@chakra-ui/react';
import { Link, useParams } from '@tanstack/react-router';
import { IconArrowRight } from '../../../assets/icons';

export const JobConfirmSubmit = () => {
  const { assessmentId } = useParams({ from: '/assessments/$assessmentId/submitted' });

  return (
    <VStack justifyContent="center" alignItems="center" height="100%">
      <Box as="h1" textStyle="h1">
        we’re working on it
      </Box>
      <Box as="h2" textStyle="h2" mb="500">
        your assessment is being processed
      </Box>
      <Box as="h6" textStyle="h6" mb="300">
        click continue to view status
      </Box>
      <HStack // TODO: fix up button components
        as={Link}
        to={`/assessments/${assessmentId}`}
        maxWidth="16.5rem"
        width="100%"
        h="min-content"
        padding="300"
        gap="200"
        layerStyle="buttonPrimary"
        textStyle="button"
        justifyContent={'center'}
      >
        <Box as="span">continue</Box>
        <IconArrowRight />
      </HStack>
    </VStack>
  );
};

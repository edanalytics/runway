import { Box, Button, Collapse, HStack, VStack } from '@chakra-ui/react';
import { TJobErrorDto } from '@edanalytics/models';
import { useState } from 'react';
import { ContactSupport } from '../../../../components/SupportButton';

export const JobError = ({ err }: { err: TJobErrorDto }) => {
  const { details, message, stacktrace } = err;
  const [showStacktrace, setShowStacktrace] = useState(false);

  return (
    <VStack alignItems="flex-start" gap="0" width="100%">
      <HStack
        width="100%"
        justifyContent="space-between"
        bg="blue.600"
        padding="400"
        borderRadius="8px"
        gap="400"
      >
        <VStack alignItems="flex-start" textColor="blue.50">
          <Box textStyle="bodyBold">{message}</Box>
          {details && <Box textStyle="body">{details}</Box>}
        </VStack>
        <ContactSupport message={message} />
      </HStack>

      {stacktrace && (
        <Button
          marginLeft="200"
          onClick={() => setShowStacktrace(!showStacktrace)}
          variant="unstyled"
          textStyle="button"
          textColor="green.100"
          _hover={{ textColor: 'green.50' }}
        >
          {showStacktrace ? 'hide stacktrace' : 'view stacktrace'}
        </Button>
      )}
      <Box as={Collapse} in={showStacktrace} width="100%">
        <Box
          as="pre"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          maxH="50vh"
          bg="blue.800"
          padding="300"
          borderRadius="8px"
          overflow="auto"
        >
          {stacktrace}
        </Box>
      </Box>
    </VStack>
  );
};

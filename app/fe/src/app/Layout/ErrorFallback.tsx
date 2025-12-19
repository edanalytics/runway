import { Box, Link, Text } from '@chakra-ui/react';
export const ErrorFallback = ({ message }: { message: string }) => (
  <Box pt="30vh" textAlign="center">
    <Box display="inline-block" textAlign="left">
      <Link
        as="span"
        onClick={() => {
          window.history.back();
        }}
      >
        &larr; Back
      </Link>
      <Text w="auto" textAlign="center" fontWeight="bold" fontSize="5xl" color="gray.300">
        {message}
      </Text>
    </Box>
  </Box>
);

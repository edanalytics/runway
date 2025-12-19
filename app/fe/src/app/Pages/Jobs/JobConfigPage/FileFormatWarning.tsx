import { Box, HStack } from '@chakra-ui/react';
import { IconPaper } from '../../../../assets/icons';

export const FileFormatWarning = () => {
  return (
    <HStack
      borderColor="blue.500"
      borderRadius="8px"
      borderWidth="4px"
      padding="400"
      gap="400"
      width="100%"
    >
      <Box padding="200" bg="blue.500" borderRadius="20px">
        <IconPaper />
      </Box>
      <Box textStyle="bodyLargeBold">
        To avoid losing any data, it’s best not to change the file format from your assessment
        vendor’s export tool.
      </Box>
    </HStack>
  );
};

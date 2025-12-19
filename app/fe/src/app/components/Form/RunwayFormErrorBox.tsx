import { Box, HStack, StackProps } from '@chakra-ui/react';
import { IconExclamation } from '../../../assets/icons';
import { ContactSupport } from '../SupportButton';

export const RunwayErrorBox = ({
  message,
  iconBgColor = 'pink.400',
  showButton = true,
  ...chakraProps
}: { message: string; iconBgColor?: string; showButton?: boolean } & StackProps) => {
  return (
    <HStack
      bg="blue.600"
      borderColor="blue.500"
      textColor="blue.50"
      textStyle="bodyLargeBold"
      padding="400"
      borderRadius="8px"
      borderWidth="4px"
      width="100%"
      justifyContent="space-between"
      {...chakraProps}
    >
      <HStack gap="400">
        <Box bg={iconBgColor} padding="100" borderRadius="21px">
          <IconExclamation height={24} width={24} />
        </Box>
        <Box>{message}</Box>
      </HStack>
      {showButton && <ContactSupport message={message} />}
    </HStack>
  );
};

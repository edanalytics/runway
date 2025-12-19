import { Box, ComponentWithAs, StackProps, VStack } from '@chakra-ui/react';
import React, { ReactNode } from 'react';

export const FormSection = ({
  heading,
  children,
  ...chakraProps
}: { heading?: string; children: ReactNode } & StackProps) => {
  if (!children || React.Children.count(children) === 0) {
    return null;
  }
  return (
    <VStack alignItems="flex-start" gap="300" w="100%" {...chakraProps}>
      {heading && (
        <Box as="h4" textStyle="h4">
          {heading}
        </Box>
      )}
      {children}
    </VStack>
  );
};

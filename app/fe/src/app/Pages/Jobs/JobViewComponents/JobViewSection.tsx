import { Box, Collapse, VStack } from '@chakra-ui/react';
import { ReactNode } from 'react';

export const JobViewSection = ({
  title,
  children,
}: {
  title: string;
  show?: boolean;
  children: ReactNode;
}) => (
  // Use collapse since sections get added dynamically as data becomes available
  <Box as={Collapse} animateOpacity in={true} width="100%">
    <VStack width="100%" gap="400" alignItems="flex-start">
      <Box textStyle="h4">{title}</Box>
      {children}
    </VStack>
  </Box>
);

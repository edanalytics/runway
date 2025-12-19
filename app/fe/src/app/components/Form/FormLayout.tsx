import { Box, VStack } from '@chakra-ui/react';
import { CancelLink } from '../links';
import React from 'react';
import { ToOptions } from '@tanstack/react-router';
import { router } from '../../app';

export const FormLayout = ({
  children,
  title,
  backLink,
  subtitle,
  secondaryText,
}: {
  children: React.ReactNode;
  title: string;
  backLink: ToOptions<typeof router>['to'];
  subtitle?: string;
  secondaryText?: string;
}) => {
  return (
    <VStack
      alignItems="flex-start"
      width="100%"
      height="100%"
      paddingBottom="500"
      paddingLeft="500"
    >
      <CancelLink to={backLink} />
      <Box marginBottom="500">
        {subtitle && <Box textStyle="h5">{subtitle}</Box>}
        <Box as="h1" textStyle="h1">
          {title}
        </Box>
        {secondaryText && <Box textStyle="bodyLarge">{secondaryText}</Box>}
      </Box>

      {children}
    </VStack>
  );
};

import { Box, Button, ButtonProps } from '@chakra-ui/react';

export const RunwaySubmit = ({ label, ...buttonProps }: { label: string } & ButtonProps) => {
  return (
    <Box
      as={Button}
      type="submit"
      maxWidth="16.5rem"
      width="100%"
      h="min-content"
      justify="center"
      padding="300"
      gap="100"
      layerStyle="buttonPrimary"
      textStyle="button"
      {...buttonProps}
    >
      {label}
    </Box>
  );
};

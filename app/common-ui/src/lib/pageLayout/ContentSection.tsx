import { Box, ChakraComponent, Heading } from '@chakra-ui/react';

type ContentSectionComponent = ChakraComponent<'div', { heading?: string }>;

export const ContentSection: ContentSectionComponent = (props) => {
  const { heading, children, className, ...rest } = props;
  const mergedClassName = className ? `${className} content-section` : 'content-section';
  return (
    <Box className={mergedClassName} {...rest}>
      {heading ? (
        <Heading mb={4} fontSize="md" fontWeight="medium">
          {heading}
        </Heading>
      ) : null}
      {children}
    </Box>
  );
};

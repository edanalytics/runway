import { Button, Link } from '@chakra-ui/react';
import { SUPPORT_LINK } from '../helpers/constants';

export const getSupportLink = (message: string) => {
  return `${SUPPORT_LINK}?summary=${encodeURIComponent(message)}&description=${encodeURIComponent(
    [
      '',
      '--------------------------------',
      'Please add any additional information about your support request above the line.',
      '',
      'Troubleshooting information:',
      `- Error message: ${message}`,
      `- Location: ${window.location.href}`,
    ].join('\n') // multi-line template string can lead to odd indentation in the ticket so join with newlines instead
  )}`;
};

export const ContactSupport = ({ message }: { message: string }) => {
  return (
    <Button
      as={Link}
      href={getSupportLink(message)}
      target="_blank"
      rel="noopener noreferrer"
      flexShrink={0}
      height="fit-content"
      backgroundColor="green.100"
      textColor="green.600"
      borderRadius="8px"
      paddingY="200"
      paddingX="400"
      textStyle="button"
      _hover={{ backgroundColor: 'green.50', textDecoration: 'none' }}
    >
      contact support
    </Button>
  );
};

import { Box, Icon } from '@chakra-ui/react';
import { NavigateOptions, Link as RouterLink } from '@tanstack/react-router';
export interface INavButtonProps {
  route: NavigateOptions['to'] & string;
  icon: React.ElementType;
  text: string;
  params?: object;
  onClick?: () => void;
  isActive?: boolean;
}

/**
 * Component which renders a navigation link, possibly with an
 * expandable nested list of indented sub-items.
 */
export const NavButton = (props: INavButtonProps) => {
  return (
    <Box
      as={RouterLink}
      role="navigation"
      to={props.route}
      w="100%"
      minH="7rem"
      borderRadius="8px"
      px="200"
      py="400"
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap="100"
      title={props.text}
      textColor="blue.100"
      _activeLink={{
        background: 'blue.800',
      }}
    >
      <Icon as={props.icon} />
      <Box textStyle="button" as="span">
        {props.text}
      </Box>
    </Box>
  );
};

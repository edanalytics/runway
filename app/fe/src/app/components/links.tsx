import { Box, HStack } from '@chakra-ui/react';
import React from 'react';
import { createLink, LinkComponent } from '@tanstack/react-router';
import { Link as ChakraLink } from '@chakra-ui/react';
import { IconArrowLeft, IconX } from '../../assets/icons';

/**
 * The idea with these is to have some reusable links that take advantage of the router's
 * type safety. Following the example in the docs:
 * https://tanstack.com/router/latest/docs/framework/react/guide/custom-link#chakra-ui-example
 */

interface LinkProps extends Omit<React.ComponentPropsWithoutRef<typeof ChakraLink>, 'href'> {
  text?: string;
  color?: string;
  icon?: React.FC;
}

const BaseLinkComponent = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  const { text, color = 'green.100', icon: Icon, ...rest } = props;
  return (
    <ChakraLink ref={ref} textColor={color} {...rest}>
      <HStack
        display="inline-flex" // don't interfere with parent's width
        textStyle="button"
        padding="200"
        gap="200"
      >
        {Icon && <Icon />}
        <Box as="span">{text}</Box>
      </HStack>
    </ChakraLink>
  );
});

const RunwayLinkComponent = createLink(BaseLinkComponent);

export const SecondaryNavLink: LinkComponent<typeof BaseLinkComponent> = (props) => {
  return <RunwayLinkComponent {...props}></RunwayLinkComponent>;
};

export const GoBackLink = (props: any) => {
  return <RunwayLinkComponent text="go back" icon={IconArrowLeft} {...props} />;
};

export const CancelLink: LinkComponent<typeof BaseLinkComponent> = (props) => {
  return <RunwayLinkComponent text="cancel" icon={IconX} {...props} />;
};

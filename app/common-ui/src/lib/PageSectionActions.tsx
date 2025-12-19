import { ChevronDownIcon } from '@chakra-ui/icons';
import { Box, Button, Menu, MenuButton, MenuList, Portal } from '@chakra-ui/react';
import { ActionsType } from './ActionsType';
import { ActionBarButton, ActionMenuButton } from './getStandardActions';
import { ActionGroup, splitActions } from '.';

export const PageSectionActions = (props: {
  actions: ActionsType;
  show?: number | undefined | true;
}) => {
  const { show, actions } = props;
  const { hidden, visible } = splitActions(actions, show);
  return (
    <Box position="relative">
      <ActionGroup
        pos="absolute"
        top="-1.5em"
        right="-1.5em"
        zIndex={0}
        css={{
          '& > a': {
            borderRadius: 0,
          },
          '& > button': {
            borderRadius: 0,
          },
          // Using first-child causes an error so this and the sibling selector are used instead
          // [class] is needed for precedence purposes
          '& > *[class]': {
            borderBottomLeftRadius: 'var(--chakra-radii-md)',
          },
          '& > *:last-child': {
            borderTopRightRadius: 'var(--chakra-radii-md)',
          },
          '& > * + *[class]': {
            borderLeftWidth: '1px',
            borderBottomLeftRadius: 0,
          },
        }}
        isAttached
        p={0}
        m={0}
      >
        {visible.map(([key, actionProps]) => (
          <ActionBarButton key={key} {...actionProps} />
        ))}
        {hidden.length > 0 && (
          <Menu>
            <MenuButton as={Button} rightIcon={<ChevronDownIcon />}>
              More
            </MenuButton>
            <Portal>
              <MenuList>
                {hidden.map(([key, actionProps]) => (
                  <ActionMenuButton key={key} {...actionProps} />
                ))}
              </MenuList>
            </Portal>
          </Menu>
        )}
      </ActionGroup>
    </Box>
  );
};

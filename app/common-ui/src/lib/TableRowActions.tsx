import { ButtonGroup, Icon, IconButton, Menu, MenuButton, MenuList } from '@chakra-ui/react';
import { BiDotsVerticalRounded } from 'react-icons/bi';
import { ActionsType } from './ActionsType';
import { ActionMenuButton, TdIconButton } from './getStandardActions';

/**
 * Split actions into some to be visible and some to be buried in menu, based on config for target number to show.
 *
 * - Actions marked as "irrelevant" are pushed to the end so that if any are buried it's those ones.
 * - Actions marked as "pending" are guaranteed to be visible, but with the least possible disturbance to the sorting that would otherwise be used.
 *   - If they're already among the visible bunch, then no change.
 *   - If they're among the hidden bunch, then they're moved to the end of the visible bunch, resulting in more than the target being temporarily shown.
 */
export const splitActions = (actions: ActionsType, show?: number | undefined | true) => {
  const hidden = Object.entries(actions).sort(([ak, a], [bk, b]) =>
    a.isIrrelevant ? 1 : b.isIrrelevant ? -1 : 0
  );
  const visible = hidden.splice(
    0,
    // show all
    show === true
      ? hidden.length
      : // show default, which is 4 buttons
      show === undefined
      ? hidden.length === 4
        ? // ...all of them being actions if no overflow necessary
          4
        : // or only 3 actions if 1 button is overflow
          3
      : // show custom number
        show
  );
  hidden.forEach(([_, a], i) => {
    if (a.isPending) {
      visible.push(...hidden.splice(i, 1));
    }
  });
  return { hidden, visible };
};

export const TableRowActions = (props: {
  actions: ActionsType;
  show?: number | undefined | true;
}) => {
  const { show, actions } = props;
  const { hidden, visible } = splitActions(actions, show);

  return (
    <ButtonGroup
      className="row-hover"
      size="table-row"
      m="-0.5rem 0 -0.5rem 0"
      variant="ghost-dark"
      spacing={0}
      colorScheme="gray"
    >
      {visible.map(([key, actionProps]) => (
        <TdIconButton key={key} {...actionProps} />
      ))}
      {hidden.length > 0 && (
        <Menu>
          <MenuButton
            as={IconButton}
            aria-label="more"
            px="0.3rem"
            icon={<Icon as={BiDotsVerticalRounded} />}
          />
          <MenuList>
            {hidden.map(([key, actionProps]) => (
              <ActionMenuButton key={key} {...actionProps} />
            ))}
          </MenuList>
        </Menu>
      )}
    </ButtonGroup>
  );
};

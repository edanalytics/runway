import { NavigateOptions, UseNavigateResult, useMatches } from '@tanstack/react-router';
import { BiEdit, BiPlus, BiTrash } from 'react-icons/bi';
import { IconType } from 'react-icons/lib';

export type ActionsType = Record<string, ActionPropsConfirm | ActionProps | LinkActionProps>;

export type ActionProps = {
  onClick: () => void;
  icon: IconType;
  text: string;
  title: string;
  isDisabled?: boolean;
  isPending?: boolean;
  /** Flag that an action should be available but at the bottom of the list. For example connect SB meta when there's already a connection. */
  isIrrelevant?: boolean;
};
export type ActionPropsConfirm = ActionProps & {
  confirmBody: string;
  confirm: true;
};

export type LinkActionProps = ActionProps & {
  to: NavigateOptions;
};

export const linkAction = (
  params: Omit<LinkActionProps, 'onClick' | 'isPending'> & { navigate: UseNavigateResult<string> }
): LinkActionProps => {
  const { navigate, ...others } = params;
  return {
    ...others,
    onClick: () => navigate({ ...others.to }),
  };
};

/** Base for standard edit actions
```
{
  icon: BiEdit,
  text: 'Edit',
  title: 'Open the edit form'
}
```
 */
export const baseEditParams = {
  icon: BiEdit,
  text: 'Edit',
  title: 'Open the edit form',
};
export const baseCreateParams = {
  icon: BiPlus,
  text: 'Create',
  title: 'Open the creation form',
};
export const baseDeleteParams = {
  icon: BiTrash,
  text: 'Delete',
  title: 'Delete the record',
};

/**
 * Get a suggested redirect for when deleting a record whose single-item page
 * you may currently be on. For example if the current path is
 * `/things/87/settings/advanced`, the path stem being deleted is `/things/87`
 * and the nearest safe redirect is `/things/`.
 *
 * Takes advantage of the fact that the router sorts matches by increasing
 * specificity, so this just finds the last one that doesn't begin with the
 * unsafe stem.
 *
 * @param pathDeleted e.g. `/things/87`.
 *
 * @returns null if the current location remains safe and otherwise the
 *   suggested redirect as a string.
 */
export const getDeletionRedirect = ({
  pathDeleted,
}: {
  /** e.g. `/things/87` if you are deleting Thing 87. */
  pathDeleted: string;
}) => {
  const matches = useMatches();
  let lastSafeRoute = '/';
  let isCurrentRouteUnsafe = false;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.id.startsWith(pathDeleted)) {
      isCurrentRouteUnsafe = true;
    } else {
      lastSafeRoute = match.id;
    }
  }
  return isCurrentRouteUnsafe ? lastSafeRoute : null;
};

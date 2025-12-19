import { Button, Icon, IconButton, MenuItem } from '@chakra-ui/react';
import { Link } from '@tanstack/react-router';
import { ActionProps, ActionPropsConfirm, LinkActionProps } from './ActionsType';
import { ConfirmAction } from './confirmAction';

export const ActionBarButton = (props: ActionProps | ActionPropsConfirm | LinkActionProps) =>
  'to' in props ? (
    <ActionBarButtons.Link {...props} />
  ) : 'confirm' in props ? (
    <ActionBarButtons.Confirm {...props} />
  ) : (
    <ActionBarButtons.Standard {...props} />
  );

export const ActionBarButtons = {
  Standard: (props: ActionProps) => (
    <Button
      isDisabled={props.isDisabled}
      isLoading={props.isPending}
      leftIcon={props.icon({})}
      onClick={props.onClick}
      title={props.title}
    >
      {props.text}
    </Button>
  ),
  Confirm: (props: ActionPropsConfirm) => (
    <ConfirmAction headerText={props.text} bodyText={props.confirmBody} action={props.onClick}>
      {(confirmProps) => (
        <Button
          isDisabled={props.isDisabled}
          isLoading={props.isPending}
          leftIcon={props.icon({})}
          onClick={(e) => {
            e.stopPropagation();
            confirmProps.onClick && confirmProps.onClick(e);
          }}
          title={props.title}
        >
          {props.text}
        </Button>
      )}
    </ConfirmAction>
  ),
  Link: (props: LinkActionProps) => (
    <Button
      as={Link}
      {...props.to}
      isDisabled={props.isDisabled}
      isLoading={props.isPending}
      leftIcon={props.icon({})}
      title={props.title}
    >
      {props.text}
    </Button>
  ),
};
export const ActionMenuButton = (props: ActionProps | ActionPropsConfirm | LinkActionProps) =>
  'to' in props ? (
    <ActionMenuButtons.Link {...props} />
  ) : 'confirm' in props ? (
    <ActionMenuButtons.Confirm {...props} />
  ) : (
    <ActionMenuButtons.Standard {...props} />
  );

export const ActionMenuButtons = {
  Standard: (props: ActionProps) => (
    <MenuItem
      gap={2}
      isDisabled={props.isDisabled || props.isPending}
      onClick={props.onClick}
      title={props.title}
    >
      <Icon as={props.icon} />
      {props.text}
    </MenuItem>
  ),
  Confirm: (props: ActionPropsConfirm) => (
    <ConfirmAction headerText={props.text} bodyText={props.confirmBody} action={props.onClick}>
      {(confirmProps) => (
        <MenuItem
          gap={2}
          isDisabled={props.isDisabled || props.isPending}
          onClick={(e) => {
            e.stopPropagation();
            confirmProps.onClick && confirmProps.onClick(e);
          }}
          title={props.title}
        >
          <Icon as={props.icon} />
          {props.text}
        </MenuItem>
      )}
    </ConfirmAction>
  ),
  Link: (props: LinkActionProps) => (
    <MenuItem
      gap={2}
      as={Link}
      {...props.to}
      isDisabled={props.isDisabled || props.isPending}
      title={props.title}
    >
      <Icon as={props.icon} />
      {props.text}
    </MenuItem>
  ),
};

export const TdIconButton = (props: ActionProps | ActionPropsConfirm | LinkActionProps) =>
  'to' in props ? (
    <TdIconButtons.Link {...props} />
  ) : 'confirm' in props ? (
    <TdIconButtons.Confirm {...props} />
  ) : (
    <TdIconButtons.Standard {...props} />
  );

export const TdIconButtons = {
  Link: (props: LinkActionProps) => (
    <IconButton
      as={Link}
      {...props.to}
      isDisabled={props.isDisabled}
      isLoading={props.isPending}
      aria-label={props.text}
      title={props.title}
      px="0.3rem"
      icon={<Icon as={props.icon} />}
    />
  ),
  Standard: (props: ActionProps) => (
    <IconButton
      aria-label={props.text}
      title={props.title}
      px="0.3rem"
      icon={<Icon as={props.icon} />}
      onClick={props.onClick}
      isDisabled={props.isDisabled}
      isLoading={props.isPending}
    />
  ),
  Confirm: (props: ActionPropsConfirm) => (
    <ConfirmAction headerText={props.text} bodyText={props.confirmBody} action={props.onClick}>
      {(confirmProps) => (
        <IconButton
          px="0.3rem"
          aria-label={props.text}
          title={props.title}
          icon={<Icon as={props.icon} />}
          onClick={(e) => {
            e.stopPropagation();
            confirmProps.onClick && confirmProps.onClick(e);
          }}
          isDisabled={props.isDisabled}
          isLoading={props.isPending}
        />
      )}
    </ConfirmAction>
  ),
};

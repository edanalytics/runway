import { Button } from '@chakra-ui/react';
import { ConfirmAction, ConfirmActionProps } from '.';

export default {
  title: 'ConfirmAction',
  component: ConfirmAction,
};

export const Standard = (props: ConfirmActionProps) => (
  <ConfirmAction
    headerText="Eat a bagel?"
    bodyText="Do you actually want to eat a bagel?"
    yesButtonText="Yes, eat."
    {...(props as Partial<ConfirmActionProps>)}
    action={() => {
      console.log('Eating');
    }}
  >
    {(props) => <Button {...props}>Eat</Button>}
  </ConfirmAction>
);

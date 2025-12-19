import { HStack } from '@chakra-ui/react';
import { GoBackLink } from '../links';
import { RunwaySubmit } from './RunwaySubmit';
import { IconArrowRight } from '../../../assets/icons';
import { ToOptions } from '@tanstack/react-router';
import { router } from '../../app';

export const RunwayBottomButtonRow = ({
  backPath,
  isLoading = false,
  isDisabled = false,
  rightText = 'next step',
}: {
  backPath?: ToOptions<typeof router>['to'];
  isLoading?: boolean;
  isDisabled?: boolean;
  rightText?: string;
}) => {
  return (
    <HStack justifyContent={backPath ? 'space-between' : 'flex-end'} width="100%">
      {backPath && <GoBackLink to={backPath} />}
      <RunwaySubmit
        label={rightText}
        rightIcon={<IconArrowRight />}
        isLoading={isLoading}
        isDisabled={isDisabled}
      />
    </HStack>
  );
};

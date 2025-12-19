import { Badge } from '@chakra-ui/react';

export const SuccessFailureBadge = ({
  bool,
  pastTense,
}: {
  bool: boolean;
  pastTense?: boolean;
}) => (
  <Badge colorScheme={bool ? 'green' : 'red'}>
    {bool ? (pastTense ? 'Succeeded' : 'Success') : pastTense ? 'Failed' : 'Failure'}
  </Badge>
);

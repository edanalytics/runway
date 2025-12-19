import { Box } from '@chakra-ui/react';
import { INavButtonProps, NavButton } from './NavButton';
import { AssessmentIcon } from '../../assets/AssessmentsIcon';
import { ODSConfigIcon } from '../../assets/ODSConfigIcon';

export const Nav = () => {
  const items: INavButtonProps[] = [
    {
      route: '/assessments',
      icon: AssessmentIcon,
      text: 'assessments',
    },
    {
      route: '/ods-configs',
      icon: ODSConfigIcon,
      text: 'ODS configuration',
    },
  ];

  return (
    // TODO: figure out why this width isn't being respected
    <Box width="12rem" display="flex" flexDir="column" gap="300">
      {items.map((item) => (
        <NavButton key={item.text + item.route} {...item} />
      ))}
    </Box>
  );
};

import { Box } from '@chakra-ui/react';
import { LuSettings2 } from 'react-icons/lu';
import { NavButton } from './NavButton';
import { AssessmentIcon } from '../../assets/AssessmentsIcon';
import { ODSConfigIcon } from '../../assets/ODSConfigIcon';
import { useMe } from '../api/queries/me.queries';
import { useQuery } from '@tanstack/react-query';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';

const AdminSettingsIcon = (props: React.ComponentProps<typeof LuSettings2>) => (
  <LuSettings2 {...props} strokeWidth={1} />
);

export const Nav = () => {
  const { data: me } = useMe();
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);

  const doesAnyYearSendToOds = yearConfigs?.some((y) => y.sendToOds) ?? false;
  const isPartnerAdmin = me?.roles?.includes('PartnerAdmin') ?? false;

  return (
    // TODO: figure out why this width isn't being respected
    <Box width="12rem" display="flex" flexDir="column" gap="300">
      <NavButton route="/assessments" icon={AssessmentIcon} text="assessments" />
      {doesAnyYearSendToOds && (
        <NavButton route="/ods-configs" icon={ODSConfigIcon} text="ODS configuration" />
      )}
      {isPartnerAdmin && (
        <NavButton route="/admin" icon={AdminSettingsIcon} text="admin settings" />
      )}
    </Box>
  );
};

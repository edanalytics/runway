import { useNavigate } from '@tanstack/react-router';
import { odsConfigQueries, tenantSchoolYearConfigQuery } from '../../../api';
import { GetOdsConfigWithSecretDto, PutOdsConfigDto } from '@edanalytics/models';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { FormLayout } from '../../../components/Form/FormLayout';
import { OdsConnectionForm } from './OdsConnectionForm';
import { useForm } from 'react-hook-form';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Box } from '@chakra-ui/react';

const resolver = classValidatorResolver(PutOdsConfigDto);

export const OdsConfigConnectionEditForm = ({
  odsConfig,
}: {
  odsConfig: GetOdsConfigWithSecretDto;
}) => {
  const navigate = useNavigate();
  const putOdsConfig = odsConfigQueries.put();
  const form = useForm<PutOdsConfigDto>({
    resolver,
    defaultValues: { ...odsConfig }, // spread needed or isDirty will not work, needs a plain object
  });
  const submit = form.handleSubmit((data) => {
    putOdsConfig.mutate(
      { id: odsConfig.id, entity: data },
      {
        onSuccess: (result) => navigate({ to: '/ods-configs' }),
      }
    );
  });

  const { data: yearConfigs } = useSuspenseQuery(tenantSchoolYearConfigQuery);
  const yearConfig = yearConfigs.find((y) => y.schoolYearId === odsConfig.schoolYearId);

  return (
    <FormLayout title="edit ODS" backLink="/ods-configs">
      <OdsConnectionForm
        form={form}
        submit={submit}
        mutation={putOdsConfig}
        yearField={
          yearConfig && (
            <Box textStyle="h5" alignSelf="flex-start">
              {yearConfig.startYear} - {yearConfig.endYear} school year
            </Box>
          )
        }
      />
    </FormLayout>
  );
};

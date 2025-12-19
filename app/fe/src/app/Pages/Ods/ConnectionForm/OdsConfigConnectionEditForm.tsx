import { useNavigate } from '@tanstack/react-router';
import { odsConfigQueries } from '../../../api';
import { GetOdsConfigDto, GetOdsConfigWithSecretDto, PutOdsConfigDto } from '@edanalytics/models';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { FormLayout } from '../../../components/Form/FormLayout';
import { OdsConnectionForm } from './OdsConnectionForm';
import { useForm } from 'react-hook-form';
import { useSchoolYears } from '../../../helpers/useSchoolYears';

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

  const { allYears, isYearSelectableForConfig } = useSchoolYears();
  const isYearAvailable = isYearSelectableForConfig(odsConfig.id);

  return (
    <FormLayout title="edit ODS" backLink="/ods-configs">
      <OdsConnectionForm
        form={form}
        submit={submit}
        mutation={putOdsConfig}
        yearOptions={
          allYears?.map(({ year }) => ({
            label: `${year.startYear} - ${year.endYear} school year`,
            value: year.id,
          })) ?? []
        }
        isOptionDisabled={(option) => !isYearAvailable(option.value)}
      />
    </FormLayout>
  );
};

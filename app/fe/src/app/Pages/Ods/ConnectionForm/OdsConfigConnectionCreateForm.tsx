import { useNavigate } from '@tanstack/react-router';
import { odsConfigQueries, tenantSchoolYearConfigQuery } from '../../../api';
import { useStandardForm } from '@edanalytics/common-ui';
import { PostOdsConfigDto } from '@edanalytics/models';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { FormLayout } from '../../../components/Form/FormLayout';
import { OdsConnectionForm } from './OdsConnectionForm';
import { RunwaySelect } from '../../../components/Form/RunwaySelect';
import { useController } from 'react-hook-form';
import { useSuspenseQuery } from '@tanstack/react-query';

const resolver = classValidatorResolver(PostOdsConfigDto);

export const OdsConfigConnectionCreateForm = () => {
  const navigate = useNavigate();
  const postOdsConfig = odsConfigQueries.post();
  const { submit, form } = useStandardForm<PostOdsConfigDto>({
    formProps: { resolver },
    mutation: postOdsConfig,
    successCallback: (result) => navigate({ to: '/ods-configs' }),
  });

  const { data: yearConfigs } = useSuspenseQuery(tenantSchoolYearConfigQuery);
  const odsYears = yearConfigs.filter((y) => y.sendToOds);
  const takenYearIds = new Set(odsYears.filter((y) => y.hasOds).map((y) => y.schoolYearId));
  const yearOptions = odsYears.map((y) => ({
    label: `${y.startYear} - ${y.endYear} school year`,
    value: y.schoolYearId,
  }));

  return (
    <FormLayout title="setup ODS" backLink="/ods-configs">
      <OdsConnectionForm
        form={form}
        submit={submit}
        mutation={postOdsConfig}
        yearField={
          <RunwaySelect
            label="year"
            controller={useController({ name: 'schoolYearId', control: form.control })}
            options={yearOptions}
            isOptionDisabled={(option) => takenYearIds.has(option.value)}
          />
        }
      />
    </FormLayout>
  );
};

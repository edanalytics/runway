import { useNavigate } from '@tanstack/react-router';
import { odsConfigQueries } from '../../../api';
import { useStandardForm } from '@edanalytics/common-ui';
import { PostOdsConfigDto } from '@edanalytics/models';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { FormLayout } from '../../../components/Form/FormLayout';
import { OdsConnectionForm } from './OdsConnectionForm';
import { useSchoolYears } from '../../../helpers/useSchoolYears';

const resolver = classValidatorResolver(PostOdsConfigDto);

export const OdsConfigConnectionCreateForm = () => {
  const navigate = useNavigate();
  const postOdsConfig = odsConfigQueries.post();
  const { submit, form } = useStandardForm<PostOdsConfigDto>({
    formProps: { resolver },
    mutation: postOdsConfig,
    successCallback: (result) => navigate({ to: '/ods-configs' }),
  });

  const { years, doesYearHaveOds } = useSchoolYears();

  return (
    <FormLayout title="setup ODS" backLink="/ods-configs">
      <OdsConnectionForm
        form={form}
        submit={submit}
        mutation={postOdsConfig}
        yearOptions={
          years?.map((y) => ({
            label: `${y.startYear} - ${y.endYear} school year`,
            value: y.schoolYearId,
          })) ?? []
        }
        isOptionDisabled={(option) => doesYearHaveOds(option.value)}
      />
    </FormLayout>
  );
};

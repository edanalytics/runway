import { useNavigate } from '@tanstack/react-router';
import { odsConfigQueries } from '../../../api';
import { useStandardForm } from '@edanalytics/common-ui';
import { PostOdsConfigDto } from '@edanalytics/models';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { FormLayout } from '../../../components/Form/FormLayout';
import { OdsConnectionForm } from './OdsConnectionForm';
import { useOdsYearOptions } from './useOdsYearOptions';

const resolver = classValidatorResolver(PostOdsConfigDto);

export const OdsConfigConnectionCreateForm = () => {
  const navigate = useNavigate();
  const postOdsConfig = odsConfigQueries.post();
  const { submit, form } = useStandardForm<PostOdsConfigDto>({
    formProps: { resolver },
    mutation: postOdsConfig,
    successCallback: (result) => navigate({ to: '/ods-configs' }),
  });

  const { yearOptions, isYearAvailable } = useOdsYearOptions();

  return (
    <FormLayout title="setup ODS" backLink="/ods-configs">
      <OdsConnectionForm
        form={form}
        submit={submit}
        mutation={postOdsConfig}
        yearOptions={yearOptions}
        isOptionDisabled={(option) => !isYearAvailable(option.value)}
      />
    </FormLayout>
  );
};

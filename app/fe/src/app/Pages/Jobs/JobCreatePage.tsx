import { Box, chakra, Collapse, Fade, Flex, HStack, VStack } from '@chakra-ui/react';
import { FormLayout } from '../../components/Form/FormLayout';
import { RunwayBottomButtonRow } from '../../components/Form/RunwayFormButtonRow';
import { RunwaySelect } from '../../components/Form/RunwaySelect';
import { Controller, useController, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';
import { GetJobTemplateDto, GetSchoolYearDto, PostFileDto, PostJobDto } from '@edanalytics/models';
import { jobQueries } from '../../api/queries/job.queries';
import { useSchoolYears } from '../../helpers/useSchoolYears';
import { jobTemplateQueries } from '../../api/queries/job-template.queries';
import { RunwayFileInput } from '../../components/Form/RunwayFileInput';
import { useEffect, useState } from 'react';
import { uploadToS3 } from '../../helpers/uploadToS3';
import { FormSection } from '../../components/Form/FormSection';
import { FileFormatWarning } from './JobConfigPage/FileFormatWarning';
import { RunwayErrorBox } from '../../components/Form/RunwayFormErrorBox';
import { useSuspenseQuery } from '@tanstack/react-query';

/**
 * This interface defines ths shape of the form. For most other
 * forms we define the structure with the DTO that the form gets
 * saved as and then use a resolver powered by class-validator.
 * Perhaps that could work here, too, but getting that setup to work with
 * file inputs is finicky, the form doesn't quite match the DTO
 * even setting aside the file inputs, and using inline validation
 * and a tranformation step on submit is simple enough.
 */
interface IJobForm {
  name: string;
  year: GetSchoolYearDto['id'];
  requiredFiles: IJobFile[];
  supplementaryFiles: IJobFile[];
  jobParams: Array<GetJobTemplateDto['params'][0] & { value: string | null }>; // TODO: simplify
}

interface IJobFile {
  name: string;
  templateKey: string;
  isRequired: boolean;
  fileType: string | string[];
  fileInput: FileList | null;
}

const makeGetFile = (fileInputs: IJobFile[]) => {
  return (key: string) => {
    const fileFromInput = fileInputs.find((file) => file.templateKey === key)?.fileInput?.[0];
    if (!fileFromInput) {
      throw new Error(`file for ${key} not found in form data`);
    }
    return fileFromInput;
  };
};

export const JobCreatePage = () => {
  const navigate = useNavigate();
  const postJob = jobQueries.post();
  const startJob = jobQueries.start();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    control,
    watch,
    handleSubmit,
    register,
    setValue,
    reset,
    formState: { errors },
  } = useForm<IJobForm>();

  const requiredFileFields = useFieldArray({ control, name: 'requiredFiles' });
  const supplementaryFileFields = useFieldArray({ control, name: 'supplementaryFiles' });
  const inputParamFields = useFieldArray({ control, name: 'jobParams' });

  const yearController = useController({
    name: 'year',
    control,
    rules: { required: 'year is required' },
  });

  const nameController = useController({
    name: 'name',
    control,
    rules: { required: 'assessment is required' },
  });

  const handleError = (msg: string) => {
    setIsSaving(false);
    setError(msg);
    reset(undefined, { keepValues: true });
  };

  const submit = handleSubmit((data, e) => {
    setIsSaving(true);
    setError(null);
    postJob.mutate(
      { entity: formDataToDto(data) },
      {
        onSuccess: async (result) => {
          // save files to s3
          const getFile = makeGetFile([...data.requiredFiles, ...data.supplementaryFiles]);
          const uploadResults = await Promise.all(
            result.uploadLocations.map(({ templateKey, url }) =>
              uploadToS3(getFile(templateKey), url)
            )
          );

          if (uploadResults.some((result) => !result.ok)) {
            const msg = uploadResults
              .filter((result) => !result.ok)
              .map((result) => `${result.status} - ${result.statusText}`)
              .join(', ');
            return handleError(`Error uploading files to S3: ${msg}`);
          }

          // let's start the job
          startJob.mutate(
            { id: result.id, entity: { inputParams: data.jobParams } },
            {
              onSuccess: () => {
                navigate({
                  from: '/assessments/new',
                  to: '/assessments/$assessmentId/submitted',
                  params: { assessmentId: result.id.toString() },
                });
              },
              onError: (error) =>
                handleError(`Error starting assessment processing: ${error.message}`),
            }
          );
        },
        onError: (error) =>
          handleError(`Error saving assessment job configuration: ${error.message}`),
      }
    );
  });

  // When user selects an assessment job template, update the form fields to match the data required from the template
  const { data: jobTemplates } = useSuspenseQuery(jobTemplateQueries.get('assessments'));

  const selectedAssessment = watch('name');
  useEffect(() => {
    if (selectedAssessment) {
      const template = jobTemplates?.find((t) => t.name === selectedAssessment); // templates keyed by name, would like to change this
      if (template) {
        const filesWithInput = template.files.map((file) => ({ ...file, fileInput: null }));
        requiredFileFields.replace(filesWithInput.filter((file) => file.isRequired));
        supplementaryFileFields.replace(filesWithInput.filter((file) => !file.isRequired));
        inputParamFields.replace(
          template.params
            .filter((p) => p.templateKey !== 'API_YEAR') // TODO: find a more sensible place to filter this
            .map((param) => ({ ...param, value: null }))
        );
      } else {
        requiredFileFields.remove();
        supplementaryFileFields.remove();
        inputParamFields.remove();
      }
    }
  }, [selectedAssessment, jobTemplates]);

  const { allYears, doesYearHaveOds, odsConfigForYear } = useSchoolYears();
  const formDataToDto = (data: IJobForm): PostJobDto => {
    const template = jobTemplates?.find((t) => t.name === data.name);
    if (!template) {
      throw new Error('No template found');
    }

    // TODO: refactor this payload to better match the slimmed-down payload the external API uses
    return {
      name: data.name,
      odsId: odsConfigForYear(data.year).id,
      schoolYearId: data.year,
      files: [...data.requiredFiles, ...data.supplementaryFiles]
        .map((fileFields) => {
          const fileInput = fileFields.fileInput?.[0];
          return {
            type: fileInput?.type,
            nameFromUser: fileInput?.name,
            templateKey: fileFields.templateKey,
          };
        })
        .filter((file): file is PostFileDto => !!file.nameFromUser && !!file.templateKey), // file.type can legitimately be an empty string
      inputParams: data.jobParams,
      template: template,
      previousJobId: null,
    };
  };

  if (!allYears) {
    // TODO: add suspense query in useSchoolYears
    return null;
  }

  if (allYears.length === 0 || jobTemplates.length === 0) {
    const missingRequirement =
      allYears.length === 0 && jobTemplates.length === 0
        ? 'school years or assessment types'
        : allYears.length === 0
        ? 'school years'
        : 'assessment types';
    return (
      // TODO: see if pulling layout and data fetching into a parent and then having separate form and error components
      // simplifies things
      <FormLayout title="load a new assessment" backLink="/assessments">
        <RunwayErrorBox
          message={`Unable to load assessments. No ${missingRequirement} have been enabled for your account. Please contact Runway support.`}
        />
      </FormLayout>
    );
  }

  return (
    <FormLayout title="load a new assessment" backLink="/assessments">
      <chakra.form width="100%" height="100%" onSubmit={submit}>
        <VStack height="100%" width="100%" gap={error ? '500' : '800'}>
          <VStack width="100%" gap="500" alignItems="flex-start" flexGrow={1}>
            <FormSection maxW="24rem">
              <RunwaySelect
                label="year"
                controller={yearController}
                options={allYears.map(({ year, odsConfig }) => ({
                  label: `${year.startYear} - ${year.endYear} school year${
                    !odsConfig ? ' (no ODS configured)' : ''
                  }`,
                  value: year.id,
                }))}
                isOptionDisabled={(option) => !doesYearHaveOds(option.value)}
              ></RunwaySelect>
              <RunwaySelect
                label="assessment name"
                controller={nameController}
                options={jobTemplates
                  .map((template, ix) => ({
                    label: template.name,
                    value: template.name,
                  }))
                  .sort((a, b) => a.label.localeCompare(b.label))}
              ></RunwaySelect>
            </FormSection>
            <Box as={Collapse} in={!!selectedAssessment} animateOpacity width="100%">
              <VStack width="100%" gap="500" alignItems="flex-start">
                <FormSection heading="additional information" maxW="24rem">
                  {inputParamFields.fields.map((jobParamField, ix) => (
                    <Controller
                      key={jobParamField.id}
                      control={control}
                      rules={{
                        required: jobParamField.isRequired
                          ? `${jobParamField.name} is required`
                          : false,
                      }}
                      name={`jobParams.${ix}.value`}
                      render={({ field, fieldState }) => (
                        <RunwaySelect
                          label={jobParamField.name}
                          field={field}
                          fieldState={fieldState}
                          options={jobParamField.allowedValues?.map((v) => ({
                            label: v,
                            value: v,
                          }))}
                        />
                      )}
                    />
                  ))}
                </FormSection>
                <HStack
                  justifyContent="space-between"
                  alignItems="flex-start"
                  width="100%"
                  gap="800"
                >
                  <FormSection heading="required files" width="max-content">
                    {requiredFileFields.fields.map((field, ix) => (
                      <RunwayFileInput
                        key={field.id}
                        label={field.name}
                        accept={field.fileType}
                        register={register(`requiredFiles.${ix}.fileInput`, {
                          required: `${field.name} is required`,
                        })}
                        onClear={() => setValue(`requiredFiles.${ix}.fileInput`, null)}
                        error={errors.requiredFiles?.[ix]?.fileInput}
                      />
                    ))}
                  </FormSection>
                  {!!requiredFileFields.fields.length && (
                    <Flex maxW="45%" justifyContent="flex-end">
                      <Fade in>
                        <FileFormatWarning />
                      </Fade>
                    </Flex>
                  )}
                </HStack>

                <FormSection heading="supplementary files" width="max-content">
                  {supplementaryFileFields.fields.map((field, ix) => (
                    <RunwayFileInput
                      key={field.id}
                      label={field.name}
                      register={register(`supplementaryFiles.${ix}.fileInput`)}
                      onClear={() => setValue(`supplementaryFiles.${ix}.fileInput`, null)}
                      accept={field.fileType}
                    />
                  ))}
                </FormSection>
              </VStack>
            </Box>
          </VStack>
          <VStack alignItems={'flex-end'} width="100%" gap="300">
            {error && <RunwayErrorBox message={error} />}
            <RunwayBottomButtonRow
              backPath="/assessments"
              rightText="submit"
              isLoading={isSaving}
            />
          </VStack>
        </VStack>
      </chakra.form>
    </FormLayout>
  );
};

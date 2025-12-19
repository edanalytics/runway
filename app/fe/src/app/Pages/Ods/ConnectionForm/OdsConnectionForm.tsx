import { chakra, HStack, VStack } from '@chakra-ui/react';
import { RunwaySelect } from '../../../components/Form/RunwaySelect';
import { useController, UseFormReturn } from 'react-hook-form';
import { RunwayInput } from '../../../components/Form/RunwayInput';
import { RunwayErrorBox } from '../../../components/Form/RunwayFormErrorBox';
import { GoBackLink } from '../../../components/links';
import { RunwaySubmit } from '../../../components/Form/RunwaySubmit';
import { GetOdsConfigDto, Id, PostOdsConfigDto, PutOdsConfigDto } from '@edanalytics/models';
import React from 'react';
import { UseMutationResult } from '@tanstack/react-query';

export const OdsConnectionForm = ({
  form,
  submit,
  mutation,
  yearOptions,
  isOptionDisabled,
}: {
  form: UseFormReturn<PutOdsConfigDto | PostOdsConfigDto>;
  submit: React.FormEventHandler;
  yearOptions: Array<{ label: string; value: string }>;
  isOptionDisabled: (option: { value: string }) => boolean;
  mutation:
    | UseMutationResult<GetOdsConfigDto, Error, { entity: PutOdsConfigDto } & Id>
    | UseMutationResult<GetOdsConfigDto, Error, { entity: PostOdsConfigDto }>;
}) => {
  const {
    register,
    control,
    formState: { errors, isLoading, isDirty, defaultValues },
  } = form;

  return (
    <chakra.form width="100%" height="100%" onSubmit={submit}>
      <VStack justifyContent="space-between" alignItems="flex-start" width="100%" height="100%">
        <VStack width="100%" maxW="32rem" flexGrow="1" gap="300">
          <RunwaySelect
            label="year"
            defaultValue={defaultValues?.schoolYearId}
            controller={useController({
              name: 'schoolYearId',
              control,
            })}
            options={yearOptions}
            isOptionDisabled={isOptionDisabled}
          />
          <RunwayInput label="Edfi API base URL" error={errors.host} register={register('host')} />
          <RunwayInput label="key" error={errors.clientId} register={register('clientId')} />
          <RunwayInput
            label="secret"
            error={errors.clientSecret}
            register={register('clientSecret')}
            type="password"
          />
        </VStack>
        <VStack width="100%">
          {mutation.isError ? (
            <RunwayErrorBox message={mutation.error.message} marginBottom="500" />
          ) : null}
          <HStack justifyContent="space-between" width="100%">
            <GoBackLink to="/ods-configs" />
            <RunwaySubmit
              label="save"
              // rightIcon={<IconArrowRight />}
              isLoading={isLoading || mutation.isPending}
              isDisabled={!isDirty}
            />
          </HStack>
        </VStack>
      </VStack>
    </chakra.form>
  );
};

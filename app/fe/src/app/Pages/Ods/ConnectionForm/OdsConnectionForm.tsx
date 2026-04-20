import { chakra, HStack, VStack } from '@chakra-ui/react';
import { FieldError, FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { RunwayInput } from '../../../components/Form/RunwayInput';
import { RunwayErrorBox } from '../../../components/Form/RunwayFormErrorBox';
import { GoBackLink } from '../../../components/links';
import { RunwaySubmit } from '../../../components/Form/RunwaySubmit';
import { GetOdsConfigDto, Id, PostOdsConfigDto, PutOdsConfigDto } from '@edanalytics/models';
import React from 'react';
import { UseMutationResult } from '@tanstack/react-query';

// Minimal shape shared by both create (POST) and edit (PUT) forms.
type OdsConnectionFormFields = { host: string; clientId: string; clientSecret: string };

export const OdsConnectionForm = <T extends FieldValues & OdsConnectionFormFields>({
  form,
  submit,
  mutation,
  yearField,
}: {
  form: UseFormReturn<T>;
  submit: React.FormEventHandler;
  yearField?: React.ReactNode;
  mutation:
    | UseMutationResult<GetOdsConfigDto, Error, { entity: PutOdsConfigDto } & Id>
    | UseMutationResult<GetOdsConfigDto, Error, { entity: PostOdsConfigDto }>;
}) => {
  const {
    register,
    formState: { errors, isLoading, isDirty },
  } = form;
  const e = errors as Partial<Record<keyof OdsConnectionFormFields, FieldError>>;

  return (
    <chakra.form width="100%" height="100%" onSubmit={submit}>
      <VStack alignItems="flex-start" width="100%" height="100%" gap="500" maxW="32rem">
        <VStack width="100%" gap="300">
          {yearField}
          <RunwayInput
            label="Edfi API base URL"
            error={e.host}
            register={register('host' as Path<T>)}
          />
          <RunwayInput
            label="key"
            error={e.clientId}
            register={register('clientId' as Path<T>)}
          />
          <RunwayInput
            label="secret"
            error={e.clientSecret}
            register={register('clientSecret' as Path<T>)}
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
              isLoading={isLoading || mutation.isPending}
              isDisabled={!isDirty}
            />
          </HStack>
        </VStack>
      </VStack>
    </chakra.form>
  );
};

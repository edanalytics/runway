import { handleFormError, usePopBanner } from '@edanalytics/common-ui';
import { Id } from '@edanalytics/models';
import { MutateOptions, UseMutationResult } from '@tanstack/react-query';
import { FieldValues, UseFormProps, useForm } from 'react-hook-form';

/**
 * Standard form helper.
 * - Pass through react-hook-form props and result
 * - Create standard handler
 *
 * To eject from it use code resembling this:
 * ```
 * const search = useSearch({ from: "/big-thingies/$bigThingyId/edit" });
 * const popBanner = usePopBanner()
 * const navigate = useNavigate();
 * const goToView = () => navigate({ to: '..', });
 * const putBigThingy = bigThingyQueries.put();
 * const {
 *   register,
 *   handleSubmit,
 *   setError,
 *   formState: { errors, isLoading },
 * } = useForm<PutBigThingyDto>({ resolver, defaultValues: { ...bigThingy, ...search.defaults } });
 *
 * return <chakra.form
 *   w="form-width"
 *   onSubmit={handleSubmit((data) => putBigThingy.mutateAsync(
 *     { entity: data },
 *     {
 *       onError: handleFormError({ popBanner, setError }),
 *       onSuccess: goToView,
 *     }
 *   ))}>
 * ```
 * Which, using this helper, looks like:
 * ```
 * const { register, errors, submit, isLoading } = useStandardForm<PutBigThingyDto>({
 *   formProps: { resolver, defaultValues: { ...bigThingy, ...search.defaults } },
 *   mutation: putBigThingy,
 *   successCallback: goToView
 * });
 * ```
 */
export const useStandardForm = <
  TFieldValues extends FieldValues = FieldValues,
  TContext = any,
  TTransformedValues extends FieldValues | undefined = undefined
>(props: {
  formProps: UseFormProps<TFieldValues, TContext>;
  mutation: UseMutationResult<Id, unknown, { entity: TFieldValues }, unknown>;
  successCallback: MutateOptions<Id, unknown, { entity: TFieldValues }, unknown>['onSuccess'];
}) => {
  const popBanner = usePopBanner();
  const form = useForm(props.formProps);
  const submit = form.handleSubmit((data) =>
    props.mutation.mutateAsync(
      { entity: data },
      {
        onError: handleFormError({ popBanner, setError: form.setError }),
        onSuccess: props.successCallback,
      }
    )
  );

  return {
    /** original react-hook-form return value */
    form,
    /** easier access to `form.formState.errors` */
    errors: form.formState.errors,
    /** easier access to `form.formState.isLoading` */
    isLoading: form.formState.isLoading,
    /** easier access to `form.register` */
    register: form.register,
    /** standard submission handler &mdash; use like `onSubmit={submit}` */
    submit,
  };
};

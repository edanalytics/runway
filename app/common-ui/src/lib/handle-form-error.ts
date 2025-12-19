import { StatusResponse, isFormValidationError } from '@edanalytics/utils';
import { UseFormSetError } from 'react-hook-form';

/**
 * Populate react-hook-form state or pop a global alert banner, depending on whether it's a form validation error.
 * */
export const handleFormError =
  ({
    setError,
    popBanner,
  }: {
    setError: UseFormSetError<any>;
    popBanner: (banner: StatusResponse) => void;
  }) =>
  (err: any) => {
    if (isFormValidationError(err)) {
      Object.entries(err.data.errors).forEach(([field, error]) => {
        setError(field, error as any);
      });
    } else {
      popBanner(err);
    }
  };

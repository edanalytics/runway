import { ValidationError } from 'class-validator';
import get from 'lodash/get';
import { FieldError, FieldErrors } from 'react-hook-form';

/**
 * Turn class-validator errors into hook-form errors.
 *
 * Stolen from class-validator's [hook form resolver](../../../../node_modules/@hookform/resolvers/class-validator/src/class-validator.ts),
 * which for some reason doesn't export this perfectly useful utility.
 */
export const formErrFromValidator = (
  errors: ValidationError[],
  parsedErrors: FieldErrors = {},
  path = ''
) => {
  return errors.reduce((acc, error) => {
    const _path = path ? `${path}.${error.property}` : error.property;

    if (error.constraints) {
      const key = Object.keys(error.constraints)[0];
      acc[_path] = {
        type: key,
        message: error.constraints[key],
      };

      const _e = acc[_path];
      if (_e) {
        Object.assign(_e, { types: error.constraints });
      }
    }

    if (error.children && error.children.length) {
      formErrFromValidator(error.children, acc, _path);
    }

    return acc;
  }, parsedErrors);
};

export function formValidationResult(...errors: { field: string; message: string }[]): FieldErrors;
export function formValidationResult(error: string): FieldErrors;
export function formValidationResult(
  ...errors: [string] | { field: string; message: string }[]
): FieldErrors {
  if (errors.length === 1 && typeof errors[0] === 'string') {
    return {
      'root.serverError': {
        type: '',
        message: errors[0],
      },
    };
  } else {
    const errs = errors.map((error) => validationErrorFromConfig(error as any));
    return formErrFromValidator(errs);
  }
}

const validationErrorFromConfig = (config: { field: string; message: string }): ValidationError => {
  const err = new ValidationError();
  err.property = config.field;
  err.constraints = {
    server: config.message,
  };
  err.value = false;
  return err;
};

export const statusResponseTypes = [
  'Success' as const,
  'Info' as const,
  'Warning' as const,
  'Error' as const,
  'RequiresForceDelete' as const,
  'ValidationError' as const,
];
/**
 * Display deep-nested validation errors on a higher-level input (e.g. a JSON box).
 *
 * "Plan A" is the standard pattern on most forms. Each input's value is validated
 * individually, and the error is displayed right on that input. This function is a
 * helper for "Plan B", which is displaying errors somewhere up the hierarchy from
 * where they originated. If you have a single coarse input containing many items that
 * might be validated, this helper will allow you to display all the various messages
 * in one place on that higher-level input. The launch customer was a JSON input.
 * */
export const flattenFieldErrors = (
  /** error state from react-hook-form */
  errors: FieldErrors,
  /** name of desired field, or property path (e.g. `'field.nestedField.nestedNestedField'`) */
  fieldPath?: string | undefined
) => {
  const fieldErrors = fieldPath ? get(errors, fieldPath) : errors;
  return fieldErrors ? _flattenFieldErrors(fieldErrors) : undefined;
};

/** FieldError (singular) is the actual error value type. FieldErrors (plural) is the object of property names, possibly more nested property names, and eventually the singular FieldError. */
const isFieldError = (obj: any): obj is FieldError =>
  typeof obj === 'object' && 'message' in obj && 'type' in obj;

const _flattenFieldErrors = (
  errors: (FieldErrors | FieldError) | FieldErrors[],
  propertyName?: string | undefined
): string =>
  Array.isArray(errors)
    ? errors
        .map((error: FieldErrors, i) =>
          error
            ? [
                _flattenFieldErrors(
                  error as (FieldErrors | FieldError) | FieldErrors[],
                  `${propertyName ?? ''}#${i + 1}`
                ),
              ]
            : []
        )
        .flat(2)
        .join('.\n')
    : isFieldError(errors)
    ? propertyName
      ? `${propertyName}: ${errors.message}`
      : errors.message ?? ''
    : Object.entries(errors)
        .map(([field, obj]) =>
          _flattenFieldErrors(
            obj as FieldError | FieldErrors,
            propertyName ? `${propertyName}.${field}` : field
          )
        )
        .join('.\n');

export type StatusResponseForceDelete = {
  title: string;
  message?: string;
  regarding?: string;
} & {
  type: 'RequiresForceDelete';
  data?: object;
};
export type StatusResponseFormValidation = {
  title: 'Invalid submission.';
  message?: string;
  regarding?: string;
} & {
  type: 'ValidationError';
  data: { errors: FieldErrors };
};

export type StatusResponseGeneral = {
  title: string;
  message?: string;
  regarding?: string;
} & {
  type: 'Success' | 'Info' | 'Warning' | 'Error' | 'RequiresForceDelete' | 'ValidationError';
  data?: object;
};

export type StatusResponse =
  | StatusResponseGeneral
  | StatusResponseFormValidation
  | StatusResponseForceDelete;

export const isFormValidationError = (obj: StatusResponse): obj is StatusResponseFormValidation =>
  obj?.type === 'ValidationError';

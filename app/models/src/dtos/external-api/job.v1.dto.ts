import { Expose } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { makeSerializer } from '../../utils';

function HasNoEmptyValues(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'hasNoEmptyValues',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'object' || value === null) return false;
          return Object.values(value).every((v) => typeof v === 'string' && v.trim().length > 0); // false if null or empty string
        },
        defaultMessage() {
          return `${propertyName} must not contain empty values`;
        },
      },
    });
  };
}

export class InitJobPayloadV1Dto {
  /**
   * @example 'ea'
   */
  @IsString()
  @IsNotEmpty()
  partner: string;

  /**
   * @example 'tenant1'
   */
  @IsString()
  @IsNotEmpty()
  tenant: string;

  /**
   * @example 'assessments/MAP_Growth'
   */
  @IsString()
  @IsNotEmpty()
  bundle: string;

  /**
   * The school year in the format Y1Y2, e.g. "2526" for 2025-2026
   * @example '2526'
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, {
    message: 'School year must be 4 characters long and in the format Y1Y2, e.g. "2526"',
  })
  schoolYear: string;

  /**
   * Files based on the bundle metadata. Keys correspond to the `env_var` value defined in the bundle metadata. The value is the file name Runway will use. This file name will appear to users in the Runway UI and does not need to match the original file name. The file must be uploaded to the URL provided in the `uploadUrls` field of the response.
   * @example { INPUT_FILE: 'input-file.csv' }
   */
  @IsObject()
  @IsNotEmpty()
  @HasNoEmptyValues({ message: 'File names must not be empty' })
  files: Record<string, string>;

  /**
   * Parameters based on the bundle metadata. Keys correspond to the `env_var` value defined in the bundle metadata, and the value is the value to be assigned to that parameter. The API_YEAR parameter does not need to be provided. If the bundle metadata requires no other parameters, this field can be omitted.
   * @example { FORMAT: 'Standard' }
   */
  @IsObject()
  @IsOptional()
  params?: Record<string, string> | null;
}

export class InitJobResponseV1Dto {
  /**
   * @example '123e4567-e89b-12d3-a456-426614174000'
   */
  @Expose()
  uid: string;

  /**
   * Presigned upload URLs for the files. Keys correspond to the `env_var` value defined in the bundle metadata, and the values are the presigned upload URLs for each file. All files must be uploaded to the URLs provided here before the job can be submitted for processing.
   * @example { INPUT_FILE: 'https://s3.amazonaws.com/bucket/path?signature=...' }
   */
  @Expose()
  uploadUrls: Record<string, string>; // env_var: url
}
export const toInitJobResponseV1Dto = makeSerializer(InitJobResponseV1Dto);

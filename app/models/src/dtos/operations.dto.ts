import { StatusResponse, statusResponseTypes } from '@edanalytics/utils';
import { Expose } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { makeSerializer } from '../utils';
// should implement StatusResponse even though there's no TS mechanism to ensure that here. It _is_ ensured on the mapper below.
export class StatusResponseDto {
  @Expose()
  @IsOptional()
  @IsString()
  title: StatusResponse['title'];

  @Expose()
  @IsIn(statusResponseTypes)
  type: StatusResponse['type'];

  @Expose()
  @IsOptional()
  @IsString()
  message?: StatusResponse['message'];

  @Expose()
  @IsOptional()
  @IsString()
  regarding?: StatusResponse['regarding'];

  @Expose()
  data?: StatusResponse['data'];
}

export const toStatusResponseDto = makeSerializer(StatusResponseDto);

export type GenericHttpError = {
  message: string;
  statusCode: number;
};

// TODO standardize errors across the app
/** Transform various errors into standard `OperationResultDto` */
export const standardizeError = (
  error: GenericHttpError | StatusResponseDto | Error
): StatusResponseDto => {
  return 'name' in error
    ? // Base JS error
      { title: error.name, type: 'Error' }
    : 'statusCode' in error
    ? // Generic HTTP error
      { title: error.message, type: 'Error' }
    : // Already OperationResultDto
      error;
};

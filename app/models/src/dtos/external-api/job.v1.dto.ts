import { Expose } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { makeSerializer } from 'models/src/utils';

export class InitJobPayloadV1Dto {
  @IsString()
  @IsNotEmpty()
  bundle: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, {
    message: 'School year must be 4 characters long and in the format Y1Y2, e.g. "2526"',
  })
  schoolYear: string;

  @IsObject()
  @IsNotEmpty()
  files: Record<string, string>;

  @IsObject()
  @IsOptional()
  params?: Record<string, string> | null;
}

export class InitJobResponseV1Dto {
  @Expose()
  id: number;

  @Expose()
  uploadUrls: Record<string, string>; // env_var: url
}
export const toInitJobResponseV1Dto = makeSerializer(InitJobResponseV1Dto);

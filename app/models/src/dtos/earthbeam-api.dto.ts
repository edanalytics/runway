import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EarthbeamApiInitResponseDto {
  @Expose()
  token: string;

  @Expose()
  jobUrl: string;
}
export const toEarthbeamApiInitResponseDto = makeSerializer(EarthbeamApiInitResponseDto);

export class EarthbeamApiJobResponseDto {
  @Expose()
  appDataBasePath: string;

  @Expose()
  inputFiles: Record<string, string>;

  @Expose()
  inputParams: Record<string, string>;

  @Expose()
  customDescriptorMappings: Record<
    string,
    Array<{
      v_other_columns: Record<string, string>;
      edfi_descriptor: string;
      local_descriptor: string | null;
    }>
  > | null;

  @Expose()
  bundle: {
    path: string;
    branch: string;
  };

  @Expose()
  appUrls: {
    status: string;
    error: string;
    summary: string;
    unmatchedIds: string;
  };

  @Expose()
  assessmentDatastore: {
    apiYear: string;
    url: string;
    clientId: string;
    clientSecret: string;
  };
}
export const toEarthbeamApiJobResponseDto = makeSerializer(EarthbeamApiJobResponseDto);

export class EarthbeamApiStatusPayloadDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @IsString()
  @IsNotEmpty()
  status: string;
}

export class EarthbeamApiErrorPayloadDto {
  error: string;
}

export class EarthbeamApiUnmatchedIdsPayloadDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsOptional()
  count?: number;
}

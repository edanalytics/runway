import { Expose } from 'class-transformer';
import { $Enums } from '@prisma/client';
import { JsonValue, makeSerializer } from '../utils';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
    outputFiles: string;
    roster?: string;
    // Present only in the fuzzy modes. The executor calls this immediately
    // before using IDRS to get a partner-scoped token; the payload itself
    // never carries one.
    identityService?: string;
    // Present only in the fuzzy modes, where IDRS may leave students
    // unresolved. The executor posts those records here for later review.
    unmatchedStudentRecords?: string;
  };

  @Expose()
  sendToOds: boolean;

  @Expose()
  crossYearMatchAvailable: boolean;

  @Expose()
  idMatchingMode: $Enums.IdMatchingMode;

  @Expose()
  rosterFilePath?: string;

  @Expose()
  assessmentDatastore?: {
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

export class EarthbeamApiOutputFilesPayloadDto {
  @IsString()
  @IsNotEmpty()
  path: string;

  @IsBoolean()
  sentToOds: boolean;
}

/** Response from the just-in-time identity-service callback. */
export class EarthbeamApiIdentityServiceResponseDto {
  @Expose()
  token: string;

  @Expose()
  url: string;
}
export const toEarthbeamApiIdentityServiceResponseDto = makeSerializer(
  EarthbeamApiIdentityServiceResponseDto
);

/*
 * Stored JSON for the unmatched-student-records callback, kept exactly as the
 * Executor sent it: snake_case, as IDRS uses, so it can be sent back out
 * verbatim (e.g. to re-query IDRS), and including any keys not named here, so
 * fields IDRS adds later are already stored when the app starts reading them.
 * Every named field is optional JsonValue: nothing is validated or normalized,
 * since malformed input may be exactly why a record needs review.
 */

/** student_input_details.input_details: the callback's `candidate`. */
export type StudentInputDetailsJson = {
  first_name?: JsonValue;
  last_name?: JsonValue;
  birth_date?: JsonValue;
  school_ids?: JsonValue;
  student_ids?: JsonValue;
};

/**
 * student_match_suggestion.roster_details: one of the callback's `matches`,
 * minus student_unique_id and score, which are columns.
 */
export type StudentRosterDetailsJson = {
  first_name?: JsonValue;
  middle_name?: JsonValue;
  last_name?: JsonValue;
  birth_date?: JsonValue;
  student_ids?: JsonValue;
  school_years?: JsonValue;
};

import { Expose, Type } from 'class-transformer';
import { $Enums } from '@prisma/client';
import { JsonValue, makeSerializer } from '../utils';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

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
 * Stored JSON for the unmatched-student-records callback, kept in the
 * snake_case the Executor and IDRS use so it can be sent back out verbatim
 * (e.g. to re-query IDRS). Every field is JsonValue on purpose: details are
 * preserved rather than validated, since malformed input may be exactly why a
 * record needs review.
 */

/** student_input_details.input_details. Fields absent from the input stay absent. */
export type StudentInputDetailsJson = {
  first_name?: JsonValue;
  last_name?: JsonValue;
  birth_date?: JsonValue;
  school_ids?: JsonValue;
  student_ids?: JsonValue;
};

/** student_match_suggestion.roster_details. Fields absent from IDRS are null. */
export type StudentRosterDetailsJson = {
  first_name: JsonValue;
  middle_name: JsonValue;
  last_name: JsonValue;
  birth_date: JsonValue;
  student_ids: JsonValue;
  school_years: JsonValue;
};

/*
 * Request body of the unmatched-student-records callback: an array of
 * UnmatchedStudentRecordDto. Only the structural fields are validated. Student
 * details are accepted as sent, since malformed input may be exactly why a
 * record needs review.
 *
 * Unknown keys are dropped rather than rejected: the callback's pipe transforms
 * with `excludeExtraneousValues`, so only `@Expose()`d fields survive, and with
 * `exposeDefaultValues`, so a field's default applies when it is missing.
 */

/** A roster student id. Missing fields become null. */
export class UnmatchedStudentRosterIdDto {
  @Expose()
  id_type: JsonValue = null;

  @Expose()
  id_value: JsonValue = null;
}

/** Input details, stored as student_input_details.input_details. Absent fields stay absent. */
export class UnmatchedStudentCandidateDto implements StudentInputDetailsJson {
  @Expose()
  first_name?: JsonValue;

  @Expose()
  last_name?: JsonValue;

  @Expose()
  birth_date?: JsonValue;

  @Expose()
  school_ids?: JsonValue;

  @Expose()
  student_ids?: JsonValue;
}

/**
 * A possible match from IDRS. Everything but student_unique_id and score is
 * stored as student_match_suggestion.roster_details, with IDRS's missing fields
 * as null.
 */
export class UnmatchedStudentMatchDto implements StudentRosterDetailsJson {
  @Expose()
  @IsString()
  @IsNotEmpty()
  student_unique_id: string;

  @Expose()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  score: number;

  @Expose()
  first_name: JsonValue = null;

  @Expose()
  middle_name: JsonValue = null;

  @Expose()
  last_name: JsonValue = null;

  @Expose()
  birth_date: JsonValue = null;

  // Not @ValidateNested: object entries are reduced to id_type and id_value,
  // but anything else is kept verbatim as evidence rather than rejected.
  @Expose()
  @Type(() => UnmatchedStudentRosterIdDto)
  student_ids: JsonValue = null;

  @Expose()
  school_years: JsonValue = null;
}

export class UnmatchedStudentRecordDto {
  // Mirrors the SQL CHECK. The u flag makes each character a code point, as
  // PostgreSQL's length() counts; @Length would count a character plus a
  // variation selector as one and let a too-long id reach the database.
  @Expose()
  @IsString()
  @Matches(/^[\s\S]{1,128}$/u, { message: 'correlation_id must be 1 to 128 characters' })
  correlation_id: string;

  // Not @ValidateNested: the candidate has no validated fields, only the
  // projection its @Type applies.
  @Expose()
  @IsObject()
  @Type(() => UnmatchedStudentCandidateDto)
  candidate: UnmatchedStudentCandidateDto;

  @Expose()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnmatchedStudentMatchDto)
  matches: UnmatchedStudentMatchDto[];
}

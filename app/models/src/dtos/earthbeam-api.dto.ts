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
  Length,
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
  /** Which steps the run does: a full run does them all, a send run only delivers `send`. */
  @Expose()
  runType: $Enums.RunKind;

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
    // Present only in the fuzzy modes, where the executor posts its IDRS
    // match results.
    studentMatchResults?: string;
  };

  @Expose()
  sendToOds: boolean;

  @Expose()
  crossYearMatchAvailable: boolean;

  @Expose()
  idMatchingMode: $Enums.IdMatchingMode;

  /**
   * Present only on a send run: the run's id, and the answers of the
   * decisions it delivers, sorted by correlation id. `isCrossYear` is
   * whether the answer's school years exclude the job's, whatever the
   * partner's cross-year setting; the Executor doesn't send those to the ODS.
   */
  @Expose()
  send?: {
    runId: number;
    students: Array<{ correlationId: string; studentUniqueId: string; isCrossYear: boolean }>;
  };

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
 * Stored JSON for the student-match-results callback, exactly as the Executor
 * sent it: snake_case, as IDRS uses, so it can be sent back out verbatim, and
 * including keys not named here. Fields are optional JsonValue because nothing
 * is validated or normalized; malformed input may be why a record needs review.
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

/**
 * A student's school years, by end year (2025 for 2024–25), or null when there
 * are no roster details or they don't hold them as an array of integers.
 * Without them, a send can't tell whether a match is in the job's year, so
 * submitting refuses such a match.
 */
export const schoolYearsOf = (
  rosterDetails: StudentRosterDetailsJson | null | undefined
): number[] | null => {
  const schoolYears = rosterDetails?.school_years;
  return Array.isArray(schoolYears) && schoolYears.every(Number.isInteger)
    ? (schoolYears as number[])
    : null;
};

/*
 * Request body of the student-match-results callback: an array of
 * EarthbeamApiStudentMatchResultDto, one per group of input details. The DTOs
 * validate shape only; student details are accepted as sent. Property names are
 * the Executor's (`candidate` holds the input details, `matches` the
 * suggestions) because the payload is stored as sent.
 */

/**
 * One suggestion: a possible match IDRS returned. Everything but
 * student_unique_id and score is stored as student_match_suggestion.roster_details.
 */
export class EarthbeamApiStudentMatchSuggestionDto implements StudentRosterDetailsJson {
  @IsString()
  @IsNotEmpty()
  student_unique_id: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  score: number;

  // Roster details: accepted as sent.
  first_name?: JsonValue;
  middle_name?: JsonValue;
  last_name?: JsonValue;
  birth_date?: JsonValue;
  student_ids?: JsonValue;
  school_years?: JsonValue;
}

/**
 * The result of one search for one group of input details: the details
 * themselves and the suggestions the search produced.
 */
export class EarthbeamApiStudentMatchResultDto {
  // The database CHECK is authoritative: @Length counts a character plus a
  // variation selector as one, PostgreSQL as two, so a rare id passing here
  // can still fail there, as a 500 rather than a 400.
  @IsString()
  @Length(1, 128)
  correlation_id: string;

  /** Input details, stored as student_input_details.input_details. */
  @IsObject()
  candidate: StudentInputDetailsJson;

  /** The suggestions. Possibly empty: IDRS searched and suggested nothing. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EarthbeamApiStudentMatchSuggestionDto)
  matches: EarthbeamApiStudentMatchSuggestionDto[];
}

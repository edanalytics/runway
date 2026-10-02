import { Expose, Type } from 'class-transformer';
import { StudentInputDetails, StudentMatchResult, StudentMatchSuggestion } from '@prisma/client';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { StudentInputDetailsJson, StudentRosterDetailsJson } from './earthbeam-api.dto';

/*
 * The details and roster JSON are returned as stored, in the Executor's
 * snake_case.
 */

export class GetStudentMatchSuggestionDto {
  @Expose()
  ordinal: number;

  @Expose()
  studentUniqueId: string;

  // A Prisma Decimal, converted to a number: precise enough for display.
  // @Type rather than @Transform, which would run only after class-transformer
  // tried, and failed, to copy the Decimal.
  @Expose()
  @Type(() => Number)
  score: number;

  @Expose()
  rosterDetails: StudentRosterDetailsJson;
}

export class GetStudentMatchResultDto {
  // BIGINT in the database, which Prisma returns as a BigInt and
  // JSON.stringify refuses, so it travels as a string.
  @Expose()
  @Type(() => String)
  id: string;

  @Expose()
  runId: number;

  @Expose()
  @Type(() => Date)
  createdOn: Date;

  @Expose()
  @Type(() => GetStudentMatchSuggestionDto)
  suggestions: GetStudentMatchSuggestionDto[];
}

export class GetStudentInputDetailsDto {
  @Expose()
  correlationId: string;

  @Expose()
  sourceRunId: number;

  @Expose()
  @Type(() => Date)
  createdOn: Date;

  @Expose()
  inputDetails: StudentInputDetailsJson;

  @Expose()
  @Type(() => GetStudentMatchResultDto)
  results: GetStudentMatchResultDto[];
}

type StudentInputDetailsWithResults = StudentInputDetails & {
  results: (StudentMatchResult & { suggestions: StudentMatchSuggestion[] })[];
};

/** A job's students to match. Past the review limit, `students` is null. */
export class GetStudentMatchResultsDto {
  @Expose()
  count: number;

  @Expose()
  @Type(() => GetStudentInputDetailsDto)
  students: GetStudentInputDetailsDto[] | null;
}

export const toGetStudentMatchResultsDto = makeSerializerCustomType<
  GetStudentMatchResultsDto,
  { count: number; students: StudentInputDetailsWithResults[] | null }
>(GetStudentMatchResultsDto);

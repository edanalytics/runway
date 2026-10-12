import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import {
  StudentInputDetails,
  StudentMatchDecision,
  StudentMatchDecisionKind,
  StudentMatchResult,
  StudentMatchSuggestion,
  User,
} from '@prisma/client';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { StudentInputDetailsJson, StudentRosterDetailsJson } from './earthbeam-api.dto';
import { GetUserDto } from './user.dto';

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

const STUDENT_MATCH_DECISION_KINDS: StudentMatchDecisionKind[] = ['match', 'exclude', 'clear'];

/** The largest PostgreSQL INTEGER (int4). Past it, a cast to int fails with a 500. */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** Save a match, exclude the student, or clear the student's current decision. */
export class PostStudentMatchDecisionDto {
  /**
   * The `version` of the decision this one replaces, as the caller last saw
   * it, or null if they saw none. Required: a caller that sends nothing can't
   * have seen whether the student is undecided.
   */
  @ValidateIf((o: PostStudentMatchDecisionDto) => o.replacesVersion !== null)
  @IsInt()
  @Min(1)
  @Max(POSTGRES_INTEGER_MAX)
  replacesVersion: number | null;

  @IsIn(STUDENT_MATCH_DECISION_KINDS)
  kind: StudentMatchDecisionKind;

  /**
   * The picked suggestion's result, for a match; ignored otherwise. A BIGINT,
   * so a string. Not validated here: the service checks it against the
   * student's own results.
   */
  resultId?: string;

  /** The picked suggestion's position in its result, for a match; ignored otherwise. */
  // Checked here because the database would round a fraction to the nearest
  // suggestion and save it.
  @ValidateIf((o: PostStudentMatchDecisionDto) => o.kind === 'match')
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  ordinal?: number;
}

/** A student's current decision. A clear leaves none, so it never appears here. */
export class GetStudentMatchDecisionDto {
  /** The concurrency token: send it back with the student's next decision. */
  @Expose()
  version: number;

  @Expose()
  kind: Exclude<StudentMatchDecisionKind, 'clear'>;

  /** The picked suggestion's result, for a match. A BIGINT, so a string. */
  @Expose()
  @Type(() => String)
  resultId: string | null;

  @Expose()
  ordinal: number | null;

  /** Null if the user has since been deleted. */
  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true }))
  decidedBy: GetUserDto | null;

  @Expose()
  @Type(() => Date)
  decidedOn: Date;
}

export type StudentMatchDecisionWithUser = StudentMatchDecision & {
  version: number;
  decidedBy: User | null;
};

export class PostStudentMatchDecisionResponseDto {
  /** Null after a clear. */
  @Expose()
  @Type(() => GetStudentMatchDecisionDto)
  decision: GetStudentMatchDecisionDto | null;
}

export const toPostStudentMatchDecisionResponseDto = makeSerializerCustomType<
  PostStudentMatchDecisionResponseDto,
  { decision: StudentMatchDecisionWithUser | null }
>(PostStudentMatchDecisionResponseDto);

/** A student's place in review, derived from their latest decision. */
export type StudentMatchStatus = 'to-review' | 'ready' | 'excluded';

export const studentMatchStatus = (
  latestDecision: StudentMatchDecisionKind | undefined
): StudentMatchStatus => {
  switch (latestDecision) {
    case 'match':
      return 'ready';
    case 'exclude':
      return 'excluded';
    // A clear leaves the student with no decision.
    case 'clear':
    case undefined:
      return 'to-review';
  }
};

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
  status: StudentMatchStatus;

  /** Null when nothing is decided, including after a clear. */
  @Expose()
  @Type(() => GetStudentMatchDecisionDto)
  decision: GetStudentMatchDecisionDto | null;

  /**
   * Every run's result, ordered by run. Reviewers pick from the last one, but
   * a match made earlier can point into an earlier one.
   */
  @Expose()
  @Type(() => GetStudentMatchResultDto)
  results: GetStudentMatchResultDto[];
}

type StudentInputDetailsWithResults = StudentInputDetails & {
  status: StudentMatchStatus;
  decision: StudentMatchDecisionWithUser | null;
  results: (StudentMatchResult & { suggestions: StudentMatchSuggestion[] })[];
};

/**
 * A job's students to match: the total, and how many have each status. Every
 * student has exactly one status, so the statuses add up to the total.
 */
export class GetStudentMatchCountsDto {
  /** Every student the Executor sent for review. Never goes down. */
  @Expose()
  total: number;

  @Expose()
  toReview: number;

  @Expose()
  ready: number;

  @Expose()
  excluded: number;
}

/**
 * A job's students to match. Past the review limit, `students` is null, but
 * `counts` is still there.
 */
export class GetStudentMatchResultsDto {
  @Expose()
  @Type(() => GetStudentMatchCountsDto)
  counts: GetStudentMatchCountsDto;

  @Expose()
  @Type(() => GetStudentInputDetailsDto)
  students: GetStudentInputDetailsDto[] | null;
}

export const toGetStudentMatchResultsDto = makeSerializerCustomType<
  GetStudentMatchResultsDto,
  {
    counts: GetStudentMatchCountsDto;
    students: StudentInputDetailsWithResults[] | null;
  }
>(GetStudentMatchResultsDto);

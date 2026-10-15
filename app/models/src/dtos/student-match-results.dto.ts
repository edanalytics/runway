import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  StudentInputDetails,
  StudentMatchDecision,
  StudentMatchDecisionKind,
  StudentMatchResult,
  StudentMatchSuggestion,
  User,
} from '@prisma/client';
import { makeSerializer, makeSerializerCustomType } from '../utils/make-serializer';
import { StudentInputDetailsJson, StudentRosterDetailsJson } from './earthbeam-api.dto';
import { GetUserDto } from './user.dto';

/*
 * The details and roster JSON are returned as stored, in the Executor's
 * snake_case.
 */

/** A student IDRS found, as a reviewer may match to them. */
export class GetStudentSearchHitDto {
  @Expose()
  studentUniqueId: string;

  // A Prisma Decimal for a suggestion, converted to a number: precise enough
  // for display. @Type rather than @Transform, which would run only after
  // class-transformer tried, and failed, to copy the Decimal.
  @Expose()
  @Type(() => Number)
  score: number;

  /** The match as IDRS returned it, minus student_unique_id and score. */
  @Expose()
  rosterDetails: StudentRosterDetailsJson;
}

/** One of a run's suggestions: a hit at its position in the result. */
export class GetStudentMatchSuggestionDto extends GetStudentSearchHitDto {
  @Expose()
  ordinal: number;
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

/**
 * Details to search IDRS with: IDRS's own input fields, in its snake_case,
 * the shape of the stored input details. Validated against IDRS's input
 * schema. IDRS treats null and absent alike.
 */
export class StudentSearchDetailsDto implements StudentInputDetailsJson {
  @IsOptional()
  @IsString()
  first_name?: string | null;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  // The pattern alone would let through an impossible date, and the ISO
  // check alone a date with a time.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  birth_date?: string | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  school_ids?: number[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  student_ids?: string[] | null;
}

/**
 * Only IDRS's own fields. Validation keeps unknown keys, and IDRS rejects
 * them, so whatever goes to IDRS, or is stored as what was searched, is built
 * from this.
 */
export const pickStudentSearchDetails = ({
  first_name,
  last_name,
  birth_date,
  school_ids,
  student_ids,
}: StudentSearchDetailsDto): StudentSearchDetailsDto => ({
  first_name,
  last_name,
  birth_date,
  school_ids,
  student_ids,
});

/** IDRS's matches the job could load, in IDRS's order: highest score first. */
export class GetStudentSearchResultsDto {
  @Expose()
  @Type(() => GetStudentSearchHitDto)
  hits: GetStudentSearchHitDto[];
}

export const toGetStudentSearchResultsDto = makeSerializer(GetStudentSearchResultsDto);

/** The search a match rests on, when the reviewer found the student by searching. */
export class PostStudentMatchSearchDto {
  /** What the reviewer searched with. Stored as search would send it. */
  @IsObject()
  @ValidateNested()
  @Type(() => StudentSearchDetailsDto)
  searchDetails: StudentSearchDetailsDto;

  /** The student as the reviewer saw them, a hit's `rosterDetails`. Stored as sent. */
  @IsObject()
  rosterDetails: StudentRosterDetailsJson;
}

export class GetStudentMatchSearchDto {
  @Expose()
  searchDetails: StudentInputDetailsJson;

  @Expose()
  rosterDetails: StudentRosterDetailsJson;
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
   * The reviewer's search, for a match to a student they found by searching;
   * ignored otherwise. A match rests on either this or a suggestion: when it's
   * present, `resultId` and `ordinal` are ignored. Null is the same as absent,
   * as the responses show a suggestion pick's.
   */
  @ValidateIf((o: PostStudentMatchDecisionDto) => o.kind === 'match' && o.search != null)
  @IsObject()
  @ValidateNested()
  @Type(() => PostStudentMatchSearchDto)
  search?: PostStudentMatchSearchDto | null;

  /**
   * The answer, the student found, for a match to a search; ignored otherwise.
   * A suggestion pick's answer is the suggestion's student.
   */
  @ValidateIf((o: PostStudentMatchDecisionDto) => o.kind === 'match' && o.search != null)
  @IsString()
  @IsNotEmpty()
  studentUniqueId?: string;

  /**
   * The picked suggestion's result, for a match without a search; ignored
   * otherwise. A BIGINT, so a string. Not validated here: the service checks
   * it against the student's own results.
   */
  resultId?: string;

  /** The picked suggestion's position in its result, for a match without a search; ignored otherwise. */
  // Checked here because the database would round a fraction to the nearest
  // suggestion and save it.
  @ValidateIf((o: PostStudentMatchDecisionDto) => o.kind === 'match' && o.search == null)
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  ordinal?: number;
}

/** A student's current decision. A clear leaves none, so it never appears here. */
export class GetStudentMatchDecisionDto {
  /** The concurrency token: send it as `replacesVersion` with the student's next decision. */
  @Expose()
  version: number;

  @Expose()
  kind: Exclude<StudentMatchDecisionKind, 'clear'>;

  /** The answer, for a match: the student this record is. */
  @Expose()
  studentUniqueId: string | null;

  // A match's basis, what its answer rests on: either the suggestion it
  // picked, `resultId` and `ordinal`, or the reviewer's `search`. The other
  // is null.

  /** The picked suggestion's result. A BIGINT, so a string. */
  @Expose()
  @Type(() => String)
  resultId: string | null;

  @Expose()
  ordinal: number | null;

  @Expose()
  @Type(() => GetStudentMatchSearchDto)
  search: GetStudentMatchSearchDto | null;

  /** Null if the user has since been deleted. */
  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true }))
  decidedBy: GetUserDto | null;

  @Expose()
  @Type(() => Date)
  decidedOn: Date;
}

/** A decision row, with its search's columns only in `search`. */
export type StudentMatchDecisionWithUser = Omit<
  StudentMatchDecision,
  'searchDetails' | 'rosterDetails'
> & {
  version: number;
  decidedBy: User | null;
  search: {
    searchDetails: StudentInputDetailsJson;
    rosterDetails: StudentRosterDetailsJson;
  } | null;
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

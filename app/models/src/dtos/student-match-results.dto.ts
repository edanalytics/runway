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
  Length,
  Matches,
  Max,
  Min,
  NotContains,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  Run,
  RunStatus,
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
import { GetRunDto } from './run.dto';
import { POSTGRES_INTEGER_MAX } from '../constants';

/*
 * The details and roster JSON are returned as stored, in the Executor's
 * snake_case.
 */

/** One of a job's students to match: a route's parameters, or a submitted student. */
export class StudentCorrelationIdDto {
  // PostgreSQL text can't hold a NUL, so no student has one, and a query
  // would fail on it with a 500.
  @IsString()
  @Length(1, 128)
  @NotContains('\0')
  correlationId: string;
}

/** A student record from IDRS, with IDRS's score, as a reviewer may match to them. */
export class GetIdrsStudentDto {
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

/** One of a run's suggestions: an IDRS student at its position in the result. */
export class GetStudentMatchSuggestionDto extends GetIdrsStudentDto {
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
 *
 * A global `ValidationPipe` with `whitelist: true` would make this unnecessary,
 * but would change every request DTO in the app, each needing to be checked.
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

/** Search returns an array of these: the students the job could load, highest score first. */
export const toGetIdrsStudentDto = makeSerializer(GetIdrsStudentDto);

/** The search a match rests on, when the reviewer found the student by searching. */
export class PostStudentMatchSearchDto {
  /** What the reviewer searched with. Stored as the search route sends it to IDRS. */
  @IsObject()
  @ValidateNested()
  @Type(() => StudentSearchDetailsDto)
  searchDetails: StudentSearchDetailsDto;

  /** The student as the reviewer saw them, a search's `rosterDetails`. Stored as sent. */
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

/**
 * Whether a decision is a match resting on the reviewer's search, rather than
 * on a suggestion. Validation requires `search` and `studentUniqueId` exactly
 * when this holds, and refuses them otherwise.
 */
export const restsOnSearch = (
  o: PostStudentMatchDecisionDto
): o is PostStudentMatchDecisionDto & {
  search: PostStudentMatchSearchDto;
  studentUniqueId: string;
} => o.kind === 'match' && o.search != null;

/**
 * Whether a decision is a match resting on a suggestion. Validation requires
 * `ordinal` exactly when this holds, and refuses it and `resultId` otherwise.
 */
export const restsOnSuggestion = (
  o: PostStudentMatchDecisionDto
): o is PostStudentMatchDecisionDto & { ordinal: number } =>
  o.kind === 'match' && !restsOnSearch(o);

/** A decision's shape, and the fields it sent that the shape doesn't have. Null is absent. */
const strayFields = (o: PostStudentMatchDecisionDto) => {
  const [shape, allowed]: [string, string[]] = restsOnSearch(o)
    ? ['a match to a search', ['studentUniqueId', 'search']]
    : restsOnSuggestion(o)
    ? ['a match to a suggestion', ['resultId', 'ordinal']]
    : [o.kind === 'exclude' ? 'an exclude' : 'a clear', []];
  const stray = (['resultId', 'ordinal', 'studentUniqueId', 'search'] as const).filter(
    (field) => !allowed.includes(field) && o[field] != null
  );
  return { shape, stray };
};

/** Refuses a decision with stray fields, naming them but never their values, which are student data. */
@ValidatorConstraint({ name: 'decisionShape' })
class DecisionShape implements ValidatorConstraintInterface {
  validate(_: unknown, { object }: ValidationArguments) {
    const o = object as PostStudentMatchDecisionDto;
    // An unknown kind has no shape, and is refused by its own check.
    return !STUDENT_MATCH_DECISION_KINDS.includes(o.kind) || strayFields(o).stray.length === 0;
  }

  defaultMessage({ object }: ValidationArguments) {
    const { shape, stray } = strayFields(object as PostStudentMatchDecisionDto);
    return `${stray.join(', ')} must be absent from ${shape}`;
  }
}

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

  /**
   * Each kind has its own fields, and any other is refused: a match to a
   * suggestion has `resultId` and `ordinal`, a match to a search
   * `studentUniqueId` and `search`, and an exclude or a clear none. Null is the
   * same as absent, as the responses show a suggestion pick's `search`.
   */
  @IsIn(STUDENT_MATCH_DECISION_KINDS)
  @Validate(DecisionShape)
  kind: StudentMatchDecisionKind;

  /**
   * The reviewer's search, for a match to a student they found by searching.
   * A match rests on either this or a suggestion.
   */
  @ValidateIf(restsOnSearch)
  @IsObject()
  @ValidateNested()
  @Type(() => PostStudentMatchSearchDto)
  search?: PostStudentMatchSearchDto | null;

  /**
   * The answer, the student found, for a match to a search. A suggestion
   * pick's answer is the suggestion's student.
   */
  @ValidateIf(restsOnSearch)
  @IsString()
  @IsNotEmpty()
  studentUniqueId?: string;

  /**
   * The picked suggestion's result, for a match without a search. A BIGINT,
   * so a string. Validation only refuses it outside that shape: the service
   * checks it against the student's own results, so a missing one is
   * `invalid_target`.
   */
  resultId?: string;

  /** The picked suggestion's position in its result, for a match without a search. */
  // Checked here because the database would round a fraction to the nearest
  // suggestion and save it.
  @ValidateIf(restsOnSuggestion)
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

/**
 * A student's place in review, derived from their latest decision and, for a
 * match in a send run, that send run's status.
 */
export type StudentMatchStatus =
  | 'to-review'
  | 'ready'
  | 'excluded'
  | 'reprocessing'
  | 'reprocessed'
  | 'run-failed';

/**
 * `sendRunStatus` is the status of the latest send run that delivers the
 * latest decision, if any does. No decision can follow a send, so the latest
 * decision is the only one in any send run, and this agrees with the guards,
 * which refuse a student any of whose decision rows is in one.
 */
export const studentMatchStatus = (
  latestDecision: StudentMatchDecisionKind | undefined,
  sendRunStatus: RunStatus | undefined
): StudentMatchStatus => {
  switch (latestDecision) {
    case 'exclude':
      return 'excluded';
    case 'clear':
    case undefined:
      return 'to-review';
    case 'match':
      // Only a match is ever submitted.
      switch (sendRunStatus) {
        case undefined:
          return 'ready';
        case 'new':
        case 'running':
          return 'reprocessing';
        // Whatever its resource errors: the run was attempted.
        case 'success':
          return 'reprocessed';
        // Including a send run that failed to start.
        case 'error':
          return 'run-failed';
      }
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

  /**
   * The latest send run that delivers the current decision, which decides the
   * status. Null when none does. Once a failed send run's student is resent,
   * this is the resend, not the failed run.
   */
  @Expose()
  sendRunId: number | null;

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
  sendRunId: number | null;
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

  /** Matches not yet in any send run. */
  @Expose()
  ready: number;

  @Expose()
  excluded: number;

  /** Matches whose send run is new or running. */
  @Expose()
  reprocessing: number;

  /** Matches whose send run succeeded. */
  @Expose()
  reprocessed: number;

  /** Matches whose send run ended in error. */
  @Expose()
  runFailed: number;
}

/** One of the job's send runs, as the review read lists them. */
export class GetSendRunDto extends GetRunDto {
  /** The submitter. Null once their user is deleted. */
  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true }))
  createdBy: GetUserDto | null;

  /**
   * How many students it delivers, from its own rows. Students it delivered
   * and that were later resent still count here, though their `sendRunId` is
   * the resend's.
   */
  @Expose()
  studentCount: number;
}

/**
 * A job's students to match, and its send runs. Past the review limit,
 * `students` is null, but `counts` and `sendRuns` are still there.
 */
export class GetStudentMatchResultsDto {
  @Expose()
  @Type(() => GetStudentMatchCountsDto)
  counts: GetStudentMatchCountsDto;

  @Expose()
  @Type(() => GetStudentInputDetailsDto)
  students: GetStudentInputDetailsDto[] | null;

  /** Newest first. */
  @Expose()
  @Type(() => GetSendRunDto)
  sendRuns: GetSendRunDto[];
}

export const toGetStudentMatchResultsDto = makeSerializerCustomType<
  GetStudentMatchResultsDto,
  {
    counts: GetStudentMatchCountsDto;
    students: StudentInputDetailsWithResults[] | null;
    sendRuns: (Run & { createdBy: User | null; studentCount: number })[];
  }
>(GetStudentMatchResultsDto);

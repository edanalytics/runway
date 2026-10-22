import { Expose, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MATCH_REVIEW_STUDENT_LIMIT, POSTGRES_INTEGER_MAX } from '../constants';
import { makeSerializer } from '../utils/make-serializer';
import { StudentCorrelationIdDto } from './student-match-results.dto';

/** A student to submit: their match, at the version the page showed. */
export class PostStudentMatchSubmitStudentDto extends StudentCorrelationIdDto {
  /** The match's `version`. Never null: only a match can be submitted, and every match has one. */
  @IsInt()
  @Min(1)
  @Max(POSTGRES_INTEGER_MAX)
  version: number;
}

/** Submit saved matches for sending. One new send run delivers them all, or nothing is submitted. */
export class PostStudentMatchSubmitDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MATCH_REVIEW_STUDENT_LIMIT)
  @ArrayUnique((student?: PostStudentMatchSubmitStudentDto) => student?.correlationId)
  @ValidateNested({ each: true })
  @Type(() => PostStudentMatchSubmitStudentDto)
  students: PostStudentMatchSubmitStudentDto[];
}

export class PostStudentMatchSubmitResponseDto {
  /** The send run that delivers the submitted students. */
  @Expose()
  runId: number;

  /** Whether the send run's Executor started. When it didn't, the run is in `error` and the submit still stands. */
  @Expose()
  launched: boolean;
}

export const toPostStudentMatchSubmitResponseDto = makeSerializer(
  PostStudentMatchSubmitResponseDto
);

import { Expose, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  NotContains,
  ValidateNested,
} from 'class-validator';
import { MATCH_REVIEW_STUDENT_LIMIT, POSTGRES_INTEGER_MAX } from '../constants';
import { makeSerializer } from '../utils/make-serializer';

/** A student to submit: their match, at the version the page showed. */
export class PostStudentMatchSubmitStudentDto {
  // PostgreSQL text can't hold a NUL, so no student has one, and a query
  // would fail on it with a 500.
  @IsString()
  @Length(1, 128)
  @NotContains('\0')
  correlationId: string;

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
}

export const toPostStudentMatchSubmitResponseDto = makeSerializer(
  PostStudentMatchSubmitResponseDto
);

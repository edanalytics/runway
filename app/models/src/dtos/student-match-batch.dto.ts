import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { StudentMatchBatch, User } from '@prisma/client';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { GetUserDto } from './user.dto';

/** The largest PostgreSQL INTEGER (int4). Past it, a cast to int fails with a 500. */
const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** A student to submit, with the version of their match the page loaded. */
export class PostStudentMatchBatchStudentDto {
  @IsString()
  @IsNotEmpty()
  correlationId: string;

  /** The `version` of the student's current decision, a match, as the page loaded it. */
  @IsInt()
  @Min(1)
  @Max(POSTGRES_INTEGER_MAX)
  version: number;
}

/** Submit saved matches for delivery, as one batch. */
export class PostStudentMatchBatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((student: PostStudentMatchBatchStudentDto | undefined) => student?.correlationId)
  @ValidateNested({ each: true })
  @Type(() => PostStudentMatchBatchStudentDto)
  students: PostStudentMatchBatchStudentDto[];
}

/** A submitted batch, for display. */
export class GetStudentMatchBatchDto {
  @Expose()
  id: number;

  /** The send run that delivers the batch. */
  @Expose()
  runId: number | null;

  /** Null if the user has since been deleted. */
  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true }))
  submittedBy: GetUserDto | null;

  @Expose()
  @Type(() => Date)
  submittedOn: Date;

  /** How many students the batch submitted. */
  @Expose()
  memberCount: number;
}

export type StudentMatchBatchForDisplay = Pick<
  StudentMatchBatch,
  'id' | 'runId' | 'submittedOn'
> & {
  submittedBy: User | null;
  memberCount: number;
};

export class PostStudentMatchBatchResponseDto {
  @Expose()
  @Type(() => GetStudentMatchBatchDto)
  batch: GetStudentMatchBatchDto;
}

export const toPostStudentMatchBatchResponseDto = makeSerializerCustomType<
  PostStudentMatchBatchResponseDto,
  { batch: StudentMatchBatchForDisplay }
>(PostStudentMatchBatchResponseDto);

/** A job's batches, oldest first. */
export class GetStudentMatchBatchesDto {
  @Expose()
  @Type(() => GetStudentMatchBatchDto)
  batches: GetStudentMatchBatchDto[];
}

export const toGetStudentMatchBatchesDto = makeSerializerCustomType<
  GetStudentMatchBatchesDto,
  { batches: StudentMatchBatchForDisplay[] }
>(GetStudentMatchBatchesDto);

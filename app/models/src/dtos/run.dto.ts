import { Expose, Transform, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { Prisma, Run, RunKind, RunStatus } from '@prisma/client';
import { makeSerializer } from '../utils';
import { IsOptional } from 'class-validator';

/** The Executor's file of the students a fuzzy full run matched without review. */
export const AUTO_MATCHES_FILE_NAME = 'auto_matches.csv';

export class GetRunDto
  extends DtoGetBase
  implements
    GetDto<
      Omit<Run, 'unmatchedStudentsInfo'> & {
        unmatchedStudentsInfo: UnmatchedStudentsInfoDto | null;
      },
      'displayName'
    >
{
  @Expose()
  id: number;

  @Expose()
  jobId: number;

  @Expose()
  status: RunStatus;

  @Expose()
  summary: Prisma.JsonValue | null;

  @Expose()
  @Type(() => UnmatchedStudentsInfoDto)
  unmatchedStudentsInfo: UnmatchedStudentsInfoDto | null;

  @Expose()
  kind: RunKind;

  /**
   * Whether the run recorded an `AUTO_MATCHES_FILE_NAME` output file. The API
   * sets it from the run's `runOutputFile` rows for that name, which aren't
   * exposed; afterwards, as in the frontend, the serialized value is kept.
   */
  @Expose()
  @Transform(({ obj, value }) => value ?? (obj.runOutputFile?.length ?? 0) > 0)
  hasAutoMatches: boolean;

  //not exposed
  ecsTaskArn: string | null;
  taskSize: string | null;
}

export class UnmatchedStudentsInfoDto {
  @Expose()
  name: string;

  @Expose()
  type: string;

  @Expose()
  @IsOptional()
  count?: number;
}
export class GetRunUpdateDto {
  @Expose()
  status: string;

  @Expose()
  action: string;

  @Expose()
  @Type(() => Date)
  receivedAt: Date;
}
export const toGetRunUpdateDto = makeSerializer<GetRunUpdateDto>(GetRunUpdateDto);

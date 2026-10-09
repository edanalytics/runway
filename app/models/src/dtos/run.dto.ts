import { Expose, Transform, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { Prisma, Run, RunStatus } from '@prisma/client';
import { makeSerializer } from '../utils';
import { IsOptional } from 'class-validator';
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

  //not exposed
  ecsTaskArn: string | null;
  taskSize: string | null;

  /**
   * Whether the run recorded the ECS task its executor logs are found by, without exposing the
   * ARN. Runs from before the task was recorded, and local runs, have none. As with
   * GetJobDto.isApiInitiated, the ARN is gone after serialization, so reuse the computed value.
   */
  @Expose()
  @Transform(({ obj }) => !!obj.ecsTaskArn || !!obj.hasEcsTask)
  hasEcsTask: boolean;
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

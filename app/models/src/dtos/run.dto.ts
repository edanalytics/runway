import { Expose, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { Prisma, Run, RunStatus } from '@prisma/client';
import { makeSerializer } from '../utils';
import { IsOptional } from 'class-validator';

export class RunOutputFileDto {
  @Expose()
  name: string;
}

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
  @Type(() => RunOutputFileDto)
  runOutputFile: RunOutputFileDto[];

  get unmatchedStudentsFile() {
    return this.runOutputFile.find((f) => f.name === 'input_no_student_id_match.csv');
  }
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

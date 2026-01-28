import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { DtoPostBase, PostDto } from '../utils/post-base.dto';
import { GetJobTemplateDto, GetJobTemplateInputParamDto } from './job-template.dto';
import { GetFileDto, PostFileDto } from './file.dto';
import { $Enums, Job, JobFile, Run, RunError, RunOutputFile } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { GetSchoolYearDto } from './school-year.dto';
import { GetRunDto } from './run.dto';
import { GetUserDto } from './user.dto';
import { GetJobNoteDto } from './job-note.dto';

interface IBaseJobDto {
  id: number;
  uid: string;
  name: string;
  odsId: number;
  schoolYearId: string;
  template: GetJobTemplateDto;
  inputParams: JobInputParamDto[] | null;
  previousJobId: number | null;
  files: GetFileDto[] | PostFileDto[];
}

export class JobInputParamDto extends GetJobTemplateInputParamDto {
  @Expose()
  value: string | null;
}

export type DtoableJob = Job & {
  files: JobFile[];
  runs?: Array<Run & { runError?: RunError[]; runOutputFile?: RunOutputFile[] }>;
};
export type TJobDisplayStatus =
  | Exclude<GetRunDto['status'], null>
  | 'complete with errors'
  | 'resolved';
export class GetJobDto
  extends DtoGetBase
  implements
    GetDto<
      Omit<Job, 'template' | 'inputParams'> & {
        template: GetJobTemplateDto;
        inputParams: JobInputParamDto[] | null;
      }
    >
{
  @Expose()
  id: number;

  @Expose()
  uid: string; // uid will take the place of ID for frontend and api consumers, eventually

  @Expose()
  name: string;

  @Expose()
  odsId: number;

  @Expose()
  schoolYearId: string;

  @Expose()
  @Type(() => GetJobNoteDto)
  notes: GetJobNoteDto[] | null;

  @Expose()
  @Type(() => GetSchoolYearDto)
  schoolYear: GetSchoolYearDto;

  @Expose()
  @Type(() => JobInputParamDto)
  inputParams: JobInputParamDto[] | null;

  @Expose()
  @Type(() => GetFileDto)
  files: GetFileDto[];

  @Expose()
  @Type(() => GetJobTemplateDto)
  template: GetJobTemplateDto;

  @Expose()
  @Type(() => GetRunDto)
  runs: GetRunDto[];

  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true })) // not using @Type here since we might add sensitive data to the User DTO. Probably should do this with other nested DTOs, too.
  createdBy: GetUserDto;

  @Expose()
  isResolved: boolean;

  get lastRun(): GetRunDto | undefined {
    return this.runs?.slice().sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
  }

  get displayName() {
    return this.name ?? 'Unconfigured';
  }

  /**
   * "status" on a job is a composite of a number of different properties:
   * - the status of the last run
   * - whether the last run had unmatched students or resource errors
   * - whether a user marked the job as resolved
   * ... and possible others in the future.
   */
  get status(): TJobDisplayStatus | null {
    return this.isResolved ? 'resolved' : this.originalStatus;
  }
  get originalStatus(): TJobDisplayStatus | null {
    const status = this.lastRun?.status;
    if (!status) {
      return null;
    }

    if (status === 'success' && (this.unmatchedStudentsFile || this.hasResourceErrors)) {
      return 'complete with errors';
    }
    return status;
  }

  get isStatusChangeable(): boolean {
    const status = this.status;
    return status === 'resolved' || status === 'complete with errors';
  }

  get unmatchedStudentsFile() {
    return this.lastRun?.unmatchedStudentsFile;
  }

  get hasResourceErrors() {
    return this.resourceErrors.length > 0;
  }
  get resourceErrors() {
    const failedResources = Object.entries(this.resourceSummaries ?? {})
      .filter(([_, summary]) => summary.failed > 0)
      .map(([resource]) => resource);

    const reportableResources = this.template.reportResources ?? [];

    return failedResources
      .filter((resource) => reportableResources.includes(resource))
      .map((reportableFailedResource) => ({
        resource: reportableFailedResource,
        failed: this.resourceSummaries?.[reportableFailedResource]?.failed ?? 0,
        total:
          this.resourceSummaries?.[reportableFailedResource].success ??
          0 +
            (this.resourceSummaries?.[reportableFailedResource]?.skipped ?? 0) +
            (this.resourceSummaries?.[reportableFailedResource]?.failed ?? 0),
      }));
  }

  get resourceSummaries():
    | Record<string, { skipped: number; failed: number; success: number }>
    | undefined {
    // Tidy up the summary object and eventually handle different types of summaries
    return this.lastRun?.summary
      ? Object.fromEntries(
          Object.entries(this.lastRun.summary).map(([resource, summary]) => {
            const skipped = summary['records_skipped'] ?? 0;
            const failed = summary['records_failed'] ?? 0;
            const success = Math.max(0, (summary['records_processed'] ?? 0) - skipped - failed); // if we get lighbeam data that's off, just show 0 rather than a negative number
            return [resource, { skipped, failed, success }];
          })
        )
      : undefined;
  }

  get displayStartedOn() {
    const createdOn = this.lastRun?.createdOn;
    return createdOn
      ? `${createdOn.toLocaleDateString()} ${createdOn.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : null;
  }

  get isComplete() {
    return this.lastRun?.status === 'success' || this.lastRun?.status === 'error';
  }

  // Intentionally not exposing
  previousJobId: number | null;
  tenantCode: string;
  partnerId: string;
  fileProtocol: $Enums.FileStorageProtocol | null;
  fileBucketOrHost: string | null;
  fileBasePath: string | null;
  configStatus: $Enums.JobConfigStatus; // TODO, remove prop and column, no longer needed
}

export const toGetJobDto = makeSerializerCustomType<GetJobDto, DtoableJob>(GetJobDto);

export class PostJobDto extends DtoPostBase implements PostDto<IBaseJobDto> {
  @Expose()
  @IsString()
  name: string;

  @Expose()
  @IsNumber()
  odsId: number;

  @Expose()
  @IsString()
  schoolYearId: string;

  @Expose()
  @IsArray()
  @Type(() => PostFileDto)
  @ValidateNested({ each: true })
  files: PostFileDto[];

  @Expose()
  @IsArray()
  @Type(() => JobInputParamDto)
  @ValidateNested({ each: true })
  inputParams: JobInputParamDto[];

  @Expose()
  @Type(() => GetJobTemplateDto)
  @ValidateNested()
  template: GetJobTemplateDto;

  @Expose()
  @IsNumber()
  @IsOptional()
  previousJobId: number | null;
}

export class PostJobResponseDto {
  @Expose()
  id: number;

  @Expose()
  uploadLocations: Array<{
    //TODO: i don't like how this deviates from the job/file DTO structure
    templateKey: string;
    url: string;
  }>;
}

export class PutJobParamsDto implements Pick<IBaseJobDto, 'inputParams'> {
  @Expose()
  @Type(() => JobInputParamDto)
  @ValidateNested({ each: true })
  inputParams: JobInputParamDto[];
}

export class PutJobResolveDto {
  @Expose()
  @IsBoolean()
  isResolved: boolean;
}

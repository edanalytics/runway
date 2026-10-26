import { Exclude, Expose, plainToInstance, Transform, Type } from 'class-transformer';
import { DtoGetBase, GetDto } from '../utils/get-base.dto';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { DtoPostBase, PostDto } from '../utils/post-base.dto';
import { GetJobTemplateDto, GetJobTemplateInputParamDto } from './job-template.dto';
import { GetFileDto, PostFileDto } from './file.dto';
import { $Enums, Job, JobFile, Run, RunError } from '@prisma/client';
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
import { GetStudentMatchCountsDto, outstandingStudents } from './student-match-results.dto';

interface IBaseJobDto {
  id: number;
  uid: string;
  name: string;
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
  runs?: Array<Run & { runError?: RunError[]; }>;
  studentMatchCounts: GetStudentMatchCountsDto;
};
export type TJobDisplayStatus =
  | Exclude<GetRunDto['status'], null>
  | 'complete with errors'
  | 'resolved';
export class GetJobDto
  extends DtoGetBase
  implements
    GetDto<
      Omit<Job, 'template' | 'inputParams' | 'odsId'> & {
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
  sendToOds: boolean;

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

  @Expose()
  @Type(() => GetStudentMatchCountsDto)
  studentMatchCounts: GetStudentMatchCountsDto;

  /** Snapshotted from the partner when the job was created. */
  @Expose()
  idMatchingMode: $Enums.IdMatchingMode;

  @Expose()
  apiClientName: string | null;

  @Expose()
  tenantCode: string;

  /** Used internally to compute isApiInitiated - not included in serialized output */
  @Expose()
  @Exclude({ toPlainOnly: true })
  apiClientId: string | null;

  /**
   * Allows us to distinguish API-initiated jobs from user-initiated jobs without exposing apiClientId.
   * This prop is initially set based on presence of apiClientId. After serialization, we drop apiClientId,
   * so any future transformations cannot reference it. Instead, we see if we've already computed it and
   * use that value.
   */
  @Expose()
  @Transform(({ obj }) => !!obj.apiClientId || !!obj.isApiInitiated)
  isApiInitiated: boolean;

  /**
   * The job's full run: it has one, since it's started once, and the latest by
   * id should it ever have more. Its send runs count through its students and
   * combined summary.
   */
  get fullRun(): GetRunDto | undefined {
    return this.runs
      ?.filter((run) => run.kind === 'full')
      .sort((a, b) => b.id - a.id)[0];
  }

  get displayName() {
    return this.name ?? 'Unconfigured';
  }

  /**
   * "status" on a job is a composite of a number of different properties:
   * - the status of the full run
   * - whether the job has outstanding students or resource errors
   * - whether a user marked the job as resolved
   * ... and possible others in the future.
   */
  get status(): TJobDisplayStatus | null {
    return this.isResolved ? 'resolved' : this.originalStatus;
  }
  get originalStatus(): TJobDisplayStatus | null {
    const status = this.fullRun?.status;
    if (!status) {
      return null;
    }

    if (
      status === 'success' &&
      (this.hasIdBasedUnmatchedStudents || this.hasFuzzyStudentsToMatch || this.hasResourceErrors)
    ) {
      return 'complete with errors';
    }
    return status;
  }

  get isStatusChangeable(): boolean {
    const status = this.status;
    return status === 'resolved' || status === 'complete with errors';
  }

  /**
   * Fuzzy mode: outstanding students (`outstandingStudents`). Never in fuzzy
   * background mode, where the ID-based run has delivered.
   */
  get hasFuzzyStudentsToMatch() {
    return this.idMatchingMode === 'fuzzy' && outstandingStudents(this.studentMatchCounts) > 0;
  }

  /**
   * ID-based matching (`id_based`, and the ID-based run of fuzzy background
   * mode): students whose IDs the full run couldn't find. The user fixes the
   * IDs in the file and reprocesses it.
   */
  get hasIdBasedUnmatchedStudents() {
    return (
      this.fullRun?.unmatchedStudentsInfo?.count !== undefined &&
      this.fullRun?.unmatchedStudentsInfo?.count > 0
    );
  }

  get hasResourceErrors() {
    return this.resourceErrors.length > 0;
  }
  get resourceErrors() {
    return getResourceErrors(this.combinedSummary, this.template.reportResources);
  }

  get resourceSummaries() {
    const combined = this.combinedSummary;
    return combined ? getResourceSummaries(combined) : undefined;
  }

  /**
   * One summary, in a run summary's shape, of what the job's successful runs
   * report delivering: the full run, when it succeeded, and each successful
   * send run, which deliver disjoint students. A failed send run's partial
   * loads are left out; its students are run-failed until resent.
   */
  get combinedSummary() {
    const fullRun = this.fullRun;
    const delivered = [
      ...(fullRun?.status === 'success' ? [fullRun] : []),
      ...(this.runs ?? []).filter(({ kind, status }) => kind === 'send' && status === 'success'),
    ];
    return combineRunSummaries(delivered.map(({ summary }) => summary));
  }

  get displayStartedOn() {
    const createdOn = this.fullRun?.createdOn;
    return createdOn
      ? `${createdOn.toLocaleDateString()} ${createdOn.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : null;
  }

  get isComplete() {
    return this.fullRun?.status === 'success' || this.fullRun?.status === 'error';
  }

  // Intentionally not exposing
  previousJobId: number | null;
  apiIssuer: string | null;
  partnerId: string;
  fileProtocol: $Enums.FileStorageProtocol | null;
  fileBucketOrHost: string | null;
  fileBasePath: string | null;
  configStatus: $Enums.JobConfigStatus; // TODO, remove prop and column, no longer needed
}

export const toGetJobDto = makeSerializerCustomType<GetJobDto, DtoableJob>(GetJobDto);

/** A run's per-resource record counts. */
export const getResourceSummaries = (
  summary: NonNullable<GetRunDto['summary']>
): Record<string, { skipped: number; failed: number; success: number }> =>
  // Tidy up the summary object and eventually handle different types of summaries
  Object.fromEntries(
    Object.entries(summary).map(([resource, summary]) => {
      const skipped = summary['records_skipped'] ?? 0;
      const failed = summary['records_failed'] ?? 0;
      const success = Math.max(0, (summary['records_processed'] ?? 0) - skipped - failed); // if we get lighbeam data that's off, just show 0 rather than a negative number
      return [resource, { skipped, failed, success }];
    })
  );

/**
 * Runs' summaries combined into one, in a run summary's shape, with each
 * resource's counts summed. A resource missing from a run counts nothing
 * there. Null when no run has a summary.
 */
const combineRunSummaries = (summaries: GetRunDto['summary'][]) => {
  const reported = summaries.filter(
    (summary): summary is NonNullable<GetRunDto['summary']> => summary !== null
  );
  if (reported.length === 0) {
    return null;
  }
  const combined: Record<
    string,
    { records_processed: number; records_skipped: number; records_failed: number }
  > = {};
  for (const summary of reported) {
    for (const [resource, counts] of Object.entries(summary)) {
      const sum = (combined[resource] ??= {
        records_processed: 0,
        records_skipped: 0,
        records_failed: 0,
      });
      sum.records_processed += counts['records_processed'] ?? 0;
      sum.records_skipped += counts['records_skipped'] ?? 0;
      sum.records_failed += counts['records_failed'] ?? 0;
    }
  }
  return combined;
};

/** The resources with failed records in a run's summary that the bundle reports on. */
export const getResourceErrors = (
  summary: GetRunDto['summary'] | undefined,
  reportResources: string[] | null | undefined
) => {
  const reportableResources = reportResources ?? [];

  return Object.entries(summary ? getResourceSummaries(summary) : {})
    .filter(([resource, { failed }]) => failed > 0 && reportableResources.includes(resource))
    .map(([resource, { skipped, failed, success }]) => ({
      resource,
      failed,
      total: success + skipped + failed,
    }));
};

export class PostJobDto extends DtoPostBase implements PostDto<IBaseJobDto> {
  @Expose()
  @IsString()
  name: string;

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

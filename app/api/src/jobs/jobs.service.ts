import {
  EarthmoverBundleTypes,
  GetStudentMatchCountsDto,
  GetStudentSearchHitDto,
  JobInputParamDto,
  JsonArray,
  pickStudentSearchDetails,
  PostStudentMatchDecisionDto,
  StudentMatchDecisionWithUser,
  StudentSearchDetailsDto,
  studentMatchStatus,
  toGetJobTemplateDto,
} from '@edanalytics/models';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  FileStatus,
  Job,
  JobFile,
  PrismaClient,
  StudentMatchDecision,
  Tenant,
  User,
} from '@prisma/client';
import { FileService } from '../files/file.service';
import { rosterFileKey } from '../earthbeam/roster-path';
import { PRISMA_READ_ONLY } from '../database';
import { EarthbeamBundlesService } from '../earthbeam/earthbeam-bundles.service';
import { AppConfigService } from '../config/app-config.service';
import {
  ExecutorService,
  ExecutorStartResult,
  EXECUTOR_SERVICE,
} from '../earthbeam/executor/executor.service';
import { ApiTokenClient } from '../external-api/external-api-token-client.decorator';
import { IdrsSearchService } from '../idrs/idrs-search.service';

/**
 * Far more than a reviewer will work through (typically under 10, at most a
 * few hundred). Past it, the file itself needs fixing. At the limit, with ten
 * suggestions each, the response is about 3.5 MB.
 */
export const MATCH_REVIEW_STUDENT_LIMIT = 1000;

/**
 * Whether a job could load a student IDRS found. With cross-year matching on,
 * any student IDRS knows can be, outside the ODS as cross-year matches are;
 * otherwise only one in the job's school year. `school_years` holds Ed-Fi
 * school years, which are end years, like `endYear`.
 *
 * The Executor's suggestion filter must apply the same rule. A match an ODS job
 * keeps only through cross-year matching must never be sent to the ODS.
 */
export const isLoadableSearchHit = (
  hit: { school_years?: unknown },
  endYear: number,
  crossYearMatchingEnabled: boolean
) =>
  crossYearMatchingEnabled ||
  (Array.isArray(hit.school_years) && hit.school_years.includes(endYear));

/**
 * A decision row as the API shows it: none for a clear, and a search basis's
 * columns gathered into `search`. They reach the client only through here.
 */
const toStudentMatchDecision = ({
  user,
  searchDetails,
  rosterDetails,
  ...row
}: StudentMatchDecision & { user: User | null }): StudentMatchDecisionWithUser | null => {
  if (row.kind === 'clear') {
    return null;
  }
  return {
    ...row,
    version: row.seq,
    decidedBy: user,
    // The table's check requires both, or neither.
    search:
      searchDetails !== null && rosterDetails !== null ? { searchDetails, rosterDetails } : null,
  };
};

const noStudentsToMatch: GetStudentMatchCountsDto = {
  total: 0,
  toReview: 0,
  ready: 0,
  excluded: 0,
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    @Inject(PRISMA_READ_ONLY) private prisma: PrismaClient,
    private fileService: FileService,
    @Inject(EXECUTOR_SERVICE) private executor: ExecutorService,
    private bundleService: EarthbeamBundlesService,
    private appConfig: AppConfigService,
    private idrsSearch: IdrsSearchService
  ) {}

  async getStatusUpdates(jobId: Job['id']) {
    const lastRun = await this.prisma.run.findFirst({
      where: { jobId },
      orderBy: { createdOn: 'desc' },
      include: { runUpdate: true },
    });
    return lastRun?.runUpdate;
  }

  async getErrors(jobId: Job['id']) {
    const lastRun = await this.prisma.run.findFirst({
      where: { jobId },
      orderBy: { createdOn: 'desc' },
      include: { runError: true },
    });
    return lastRun?.runError;
  }

  /** Overridable so tests can reach the limit without seeding 1,000 students. */
  studentMatchReviewLimit = MATCH_REVIEW_STUDENT_LIMIT;

  /**
   * Each job's student match counts. Job reads and the review read both use
   * this, so they count the same way. Jobs with no students are absent.
   *
   * Takes a Prisma client, though it only reads, so the review read can run it
   * in its transaction. Other callers use the service's read-only client.
   */
  async getStudentMatchCounts(
    jobIds: Job['id'][],
    prisma: PrismaClient = this.prisma
  ): Promise<Map<Job['id'], GetStudentMatchCountsDto>> {
    // Keep the statuses in step with studentMatchStatus.
    const rows = await prisma.$queryRaw<
      { job_id: number; total: bigint; to_review: bigint; ready: bigint; excluded: bigint }[]
    >`
      SELECT i.job_id,
             count(*) AS total,
             count(*) FILTER (WHERE d.kind IS NULL OR d.kind = 'clear') AS to_review,
             count(*) FILTER (WHERE d.kind = 'match') AS ready,
             count(*) FILTER (WHERE d.kind = 'exclude') AS excluded
      FROM public.student_input_details i
      LEFT JOIN LATERAL (
        SELECT kind FROM public.student_match_decision d
        WHERE d.job_id = i.job_id AND d.correlation_id = i.correlation_id
        ORDER BY d.seq DESC
        LIMIT 1
      ) d ON true
      WHERE i.job_id = ANY(${jobIds}::int[])
      GROUP BY i.job_id
    `;
    return new Map(
      rows.map((row) => [
        row.job_id,
        {
          total: Number(row.total),
          toReview: Number(row.to_review),
          ready: Number(row.ready),
          excluded: Number(row.excluded),
        },
      ])
    );
  }

  /** Adds the counts every job read that shows a status needs. */
  async withStudentMatchCounts<T extends Pick<Job, 'id'>>(jobs: T[]) {
    const counts = await this.getStudentMatchCounts(jobs.map((job) => job.id));
    return jobs.map((job) => {
      return { ...job, studentMatchCounts: counts.get(job.id) ?? noStudentsToMatch };
    });
  }

  /**
   * The job's students to match, each with their current decision and every
   * run's result for it, and each result's suggestions in order.
   */
  async getStudentMatchResults(jobId: Job['id']) {
    // One snapshot, so the counts and the students agree with each other even
    // while students are reported or decided.
    return this.prisma.$transaction(
      async (tx) => {
        const counts =
          (await this.getStudentMatchCounts([jobId], tx as PrismaClient)).get(jobId) ??
          noStudentsToMatch;
        if (counts.total > this.studentMatchReviewLimit) {
          return { counts, students: null };
        }

        const inputs = await tx.studentInputDetails.findMany({
          where: { jobId },
          // Only for a stable order: correlation ids are opaque hashes, so it
          // means nothing to a reviewer.
          orderBy: { correlationId: 'asc' },
          include: {
            studentMatchDecision: { orderBy: { seq: 'desc' }, take: 1, include: { user: true } },
            studentMatchResult: {
              orderBy: { runId: 'asc' },
              include: { studentMatchSuggestion: { orderBy: { ordinal: 'asc' } } },
            },
          },
        });
        return {
          counts,
          // Prisma names each relation after its table; the API calls them
          // results and suggestions.
          students: inputs.map(({ studentMatchDecision, studentMatchResult, ...input }) => {
            const latest = studentMatchDecision[0] as (typeof studentMatchDecision)[0] | undefined;
            return {
              ...input,
              status: studentMatchStatus(latest?.kind),
              decision: latest ? toStudentMatchDecision(latest) : null,
              results: studentMatchResult.map(({ studentMatchSuggestion, ...result }) => ({
                ...result,
                suggestions: studentMatchSuggestion,
              })),
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }

  /** Appends a decision to the student's history. See AGENTS.md. */
  async decideStudentMatch(
    input: {
      jobId: Job['id'];
      correlationId: string;
      userId: number;
      decision: PostStudentMatchDecisionDto;
    },
    prisma: PrismaClient
  ): Promise<
    | {
        status: 'SUCCESS';
        data: { decision: StudentMatchDecisionWithUser | null };
      }
    | {
        status: 'ERROR';
        code: 'not_found' | 'decision_changed' | 'results_changed' | 'invalid_target';
      }
  > {
    const { jobId, correlationId, userId } = input;
    const { replacesVersion, kind } = input.decision;
    // Only a match has a basis, either the reviewer's own search or a
    // suggestion. A basis sent with anything else is ignored, as is a
    // suggestion sent beside a search.
    const search = kind === 'match' ? input.decision.search : undefined;
    const picksSuggestion = kind === 'match' && !search;
    const { resultId = null, ordinal = null } = picksSuggestion ? input.decision : {};
    const searchBasis = search && {
      // Exactly what search sends IDRS for these details.
      searchDetails: JSON.stringify(pickStudentSearchDetails(search.searchDetails)),
      rosterDetails: JSON.stringify(search.rosterDetails),
    };

    // PostgreSQL text can't hold a NUL, so no student has one, and the lookup
    // would fail on it with a 500.
    if (correlationId.includes('\0')) {
      return { status: 'ERROR', code: 'not_found' };
    }

    const student = await prisma.studentInputDetails.findUnique({
      where: { jobId_correlationId: { jobId, correlationId } },
      select: { studentMatchResult: { select: { id: true }, orderBy: { runId: 'desc' } } },
    });
    if (!student) {
      return { status: 'ERROR', code: 'not_found' };
    }

    if (picksSuggestion) {
      const resultIds = student.studentMatchResult.map(({ id }) => id.toString());
      if (!resultIds.includes(resultId!)) {
        return { status: 'ERROR', code: 'invalid_target' };
      }
      // Reviewers pick from the latest result. A pick from an earlier one
      // means the page predates it. Checked before the insert rather than in
      // it: a result landing in between is harmless, since new results never
      // invalidate a decision already made.
      if (resultIds[0] !== resultId) {
        return { status: 'ERROR', code: 'results_changed' };
      }
    }
    // Suggestions never change, so this can't go stale before the insert.
    const suggestion = picksSuggestion
      ? await prisma.studentMatchSuggestion.findUnique({
          where: { resultId_ordinal: { resultId: BigInt(resultId!), ordinal: ordinal! } },
          select: { studentUniqueId: true },
        })
      : null;
    if (picksSuggestion && !suggestion) {
      return { status: 'ERROR', code: 'invalid_target' };
    }
    // The answer: the student the reviewer found, or the picked suggestion's.
    const studentUniqueId = search
      ? input.decision.studentUniqueId
      : suggestion?.studentUniqueId ?? null;

    // Writes the row after the student's latest, if the caller saw what's
    // current: that latest row for a version, or no decision (no rows, or a
    // clear) for null. A clear needs a decision to clear.
    // Two racing writes compute the same seq, so the loser collides with
    // the winner on the primary key and does nothing.
    const inserted = await prisma.$queryRaw<{ seq: number }[]>`
      INSERT INTO public.student_match_decision
        (job_id, correlation_id, seq, kind, student_unique_id, result_id, ordinal,
         search_details, roster_details, decided_by_id)
      SELECT ${jobId}::int, ${correlationId}, coalesce(latest.seq, 0) + 1,
             ${kind}::public.student_match_decision_kind, ${studentUniqueId},
             ${resultId}::bigint, ${ordinal}::int,
             ${searchBasis?.searchDetails ?? null}::jsonb,
             ${searchBasis?.rosterDetails ?? null}::jsonb,
             ${userId}::int
      FROM (SELECT 1) AS one
      LEFT JOIN LATERAL (
        SELECT seq, kind FROM public.student_match_decision
        WHERE job_id = ${jobId}::int AND correlation_id = ${correlationId}
        ORDER BY seq DESC
        LIMIT 1
      ) latest ON true
      WHERE CASE
        WHEN ${replacesVersion}::int IS NULL
          THEN (latest.kind IS NULL OR latest.kind = 'clear') AND ${kind} <> 'clear'
        ELSE latest.seq = ${replacesVersion}::int AND latest.kind <> 'clear'
      END
      ON CONFLICT (job_id, correlation_id, seq) DO NOTHING
      RETURNING seq
    `;
    if (inserted.length === 0) {
      return { status: 'ERROR', code: 'decision_changed' };
    }

    const row = await prisma.studentMatchDecision.findUniqueOrThrow({
      where: { jobId_correlationId_seq: { jobId, correlationId, seq: inserted[0].seq } },
      include: { user: true },
    });
    return { status: 'SUCCESS', data: { decision: toStudentMatchDecision(row) } };
  }

  /**
   * Searches IDRS for a student with a reviewer's details, and returns the
   * students the job could load. `returned` is how many IDRS found, for the
   * log only.
   */
  async searchStudentMatch(input: {
    job: Job;
    correlationId: string;
    details: StudentSearchDetailsDto;
  }): Promise<
    | {
        status: 'SUCCESS';
        data: {
          hits: GetStudentSearchHitDto[];
          returned: number;
        };
      }
    | { status: 'ERROR'; code: 'not_found' }
    | { status: 'ERROR'; code: 'identity_service_unavailable'; cause: string }
  > {
    const { job, correlationId } = input;

    // PostgreSQL text can't hold a NUL, so no student has one, and the lookup
    // would fail on it with a 500.
    if (correlationId.includes('\0')) {
      return { status: 'ERROR', code: 'not_found' };
    }

    // The partner's setting is read live, as the Executor's payload reads it,
    // not snapshotted onto the job.
    const student = await this.prisma.studentInputDetails.findUnique({
      where: { jobId_correlationId: { jobId: job.id, correlationId } },
      select: {
        job: {
          select: {
            schoolYear: { select: { endYear: true } },
            tenant: { select: { partner: { select: { crossYearMatchingEnabled: true } } } },
          },
        },
      },
    });
    if (!student) {
      return { status: 'ERROR', code: 'not_found' };
    }
    const { endYear } = student.job.schoolYear;
    const { crossYearMatchingEnabled } = student.job.tenant.partner;

    const result = await this.idrsSearch.searchStudent({
      partnerId: job.partnerId,
      tenantCode: job.tenantCode,
      correlationId,
      details: pickStudentSearchDetails(input.details),
    });
    if (result.status === 'ERROR') {
      return result;
    }

    const hits = result.data
      .filter((match) => isLoadableSearchHit(match, endYear, crossYearMatchingEnabled))
      .map(({ student_unique_id, score, ...rosterDetails }) => ({
        studentUniqueId: student_unique_id,
        score,
        rosterDetails,
      }));
    return { status: 'SUCCESS', data: { hits, returned: result.data.length } };
  }

  async resolveJobDestination(input: { schoolYearId: string; tenant: Tenant }): Promise<
    | {
        status: 'success';
        data: {
          schoolYearId: string;
          sendToOds: boolean;
          odsId: number | null;
        };
      }
    | {
        status: 'error';
        code:
          | 'school_year_config_missing'
          | 'school_year_disabled'
          | 'ods_not_found'
          | 'roster_unavailable';
      }
  > {
    const config = await this.prisma.schoolYearConfig.findUnique({
      where: {
        partnerId_schoolYearId: {
          partnerId: input.tenant.partnerId,
          schoolYearId: input.schoolYearId,
        },
      },
      include: {
        schoolYear: {
          include: {
            odsConfig: {
              where: {
                partnerId: input.tenant.partnerId,
                tenantCode: input.tenant.code,
                retired: false,
                activeConnectionId: { not: null },
              },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!config) {
      return { status: 'error', code: 'school_year_config_missing' };
    }

    if (!config.isEnabled) {
      return { status: 'error', code: 'school_year_disabled' };
    }

    if (!config.sendToOds) {
      // A no-ODS year is valid if a roster file exists OR the partner has
      // cross-year matching enabled (EDU can supply the roster).
      // Short-circuit the S3 check when the toggle is on; we don't need the file.
      const partner = await this.prisma.partner.findUniqueOrThrow({
        where: { id: input.tenant.partnerId },
        select: { crossYearMatchingEnabled: true },
      });

      if (!partner.crossYearMatchingEnabled) {
        const rosterKey = rosterFileKey(
          { partnerId: input.tenant.partnerId, tenantCode: input.tenant.code },
          config.schoolYear
        );
        const rosterExists = await this.fileService.doesFileExist(
          rosterKey,
          this.appConfig.rosterBucket()
        );
        if (!rosterExists) {
          return { status: 'error', code: 'roster_unavailable' };
        }
      }

      return {
        status: 'success',
        data: {
          schoolYearId: config.schoolYearId,
          sendToOds: false,
          odsId: null,
        },
      };
    }

    if (config.schoolYear.odsConfig.length === 0) {
      return { status: 'error', code: 'ods_not_found' };
    }

    // Safe to take [0]: a DB uniqueness constraint enforces one non-retired ODS
    // config per tenant per school year, and the query above filters to exactly
    // that combination.
    return {
      status: 'success',
      data: {
        schoolYearId: config.schoolYearId,
        sendToOds: true,
        odsId: config.schoolYear.odsConfig[0].id,
      },
    };
  }

  /**
   * Creates a new job with validated inputs.
   *
   * Controllers are responsible for:
   * - Auth/authorization
   * - Tenant and school year destination lookup/validation
   * - Verifying bundle is enabled for partner
   *
   * This method handles:
   * - Fetching bundle (for security - don't trust client-provided template)
   * - Validating params against bundle requirements
   * - Validating files against bundle requirements
   * - Creating job and file records
   */
  async createJob(
    input: {
      bundlePath: string;
      odsId: number | null;
      sendToOds: boolean;
      schoolYearId: string;
      files: Array<{ templateKey: string; nameFromUser: string; type: string }>;
      params: Record<string, string>;
    },
    tenant: Tenant,
    prisma: PrismaClient,
    apiClient?: ApiTokenClient
  ): Promise<
    | { status: 'success'; job: Job & { files: JobFile[] } }
    | {
        status: 'error';
        code:
          | 'bundle_not_found'
          | 'missing_required_params'
          | 'invalid_param_values'
          | 'unexpected_params'
          | 'missing_required_files'
          | 'unexpected_files';
        message: string;
      }
  > {
    const bundle = await this.bundleService.getBundle(
      EarthmoverBundleTypes.assessments,
      input.bundlePath
    );

    if (!bundle) {
      return {
        status: 'error',
        code: 'bundle_not_found',
        message: `Bundle not found: ${input.bundlePath}`,
      };
    }

    // ─── Validate params ────────────────────────────────────────────────────
    // Params are validated against bundle metadata. For the EA instance, these can be found in the registry.json file:
    // https://raw.githubusercontent.com/edanalytics/earthmover_edfi_bundles/refs/heads/main/registry.json
    //
    // The registry.json file compiles and jsonifies the metadata.yaml files that live in each bundle's directory.
    //  Example metadata.yaml: https://github.com/edanalytics/earthmover_edfi_bundles/blob/main/assessments/PSAT_SAT/_metadata.yaml
    const requiredParams =
      bundle.input_params?.filter((p) => p.is_required && p.env_var !== 'API_YEAR') ?? []; // We use the ODS to supply API_YEAR rathern than take it as input
    const missingParams = requiredParams
      .filter((p) => input.params[p.env_var] == null)
      .map((p) => p.env_var);

    if (missingParams.length > 0) {
      return {
        status: 'error',
        code: 'missing_required_params',
        message: `Missing required params: ${missingParams.join(', ')}`,
      };
    }

    const paramsWithAllowedValues =
      bundle.input_params?.filter((p) => !!p.allowed_values?.length) ?? [];
    const invalidParams = paramsWithAllowedValues
      .filter((bundleParam) => {
        const value = input.params[bundleParam.env_var];
        return value != null && !bundleParam.allowed_values?.includes(value); // if there is a value, it must be an allowed value
      })
      .map((p) => p.env_var);

    if (invalidParams.length > 0) {
      return {
        status: 'error',
        code: 'invalid_param_values',
        message: `Invalid param values: ${invalidParams.join(', ')}`,
      };
    }

    const incomingParams = Object.keys(input.params);
    const expectedParams = bundle.input_params?.map((p) => p.env_var) ?? [];
    const unexpectedParams = incomingParams.filter((key) => !expectedParams.includes(key));
    if (unexpectedParams.length > 0) {
      return {
        status: 'error',
        code: 'unexpected_params',
        message: `Unexpected params: ${unexpectedParams.join(', ')}`,
      };
    }

    // ─── Validate files ─────────────────────────────────────────────────────
    const incomingFiles = input.files.map((f) => f.templateKey);
    const expectedFiles = bundle.input_files?.map((f) => f.env_var) ?? [];
    const unexpectedFiles = incomingFiles.filter((key) => !expectedFiles.includes(key));
    if (unexpectedFiles.length > 0) {
      return {
        status: 'error',
        code: 'unexpected_files',
        message: `Unexpected files: ${unexpectedFiles.join(', ')}`,
      };
    }

    const requiredFileKeys =
      bundle.input_files?.filter((f) => f.is_required).map((f) => f.env_var) ?? [];
    const missingFiles = requiredFileKeys.filter((key) => !incomingFiles.includes(key));
    if (missingFiles.length > 0) {
      return {
        status: 'error',
        code: 'missing_required_files',
        message: `Missing required files: ${missingFiles.join(', ')}`,
      };
    }

    // Enrich flat params with bundle metadata for storage
    const enrichedParams: JobInputParamDto[] = Object.entries(input.params).map(([key, value]) => {
      const bundleParam = bundle.input_params?.find((p) => p.env_var === key);
      return {
        templateKey: key,
        value,
        name: bundleParam?.display_name ?? key,
        isRequired: bundleParam?.is_required ?? false,
        allowedValues: bundleParam?.allowed_values,
      };
    });

    // ─── Create job ─────────────────────────────────────────────────────────
    // Snapshot the partner's matching mode so every run of this job uses the
    // mode in effect at creation. Read explicitly — the column default is
    // migration safety, not the creation path.
    const partner = await prisma.partner.findUniqueOrThrow({
      where: { id: tenant.partnerId },
      select: { idMatchingMode: true },
    });

    const job = await prisma.job.create({
      data: {
        name: bundle.display_name,
        odsId: input.odsId,
        sendToOds: input.sendToOds,
        schoolYearId: input.schoolYearId,
        template: toGetJobTemplateDto(bundle),
        inputParams: enrichedParams,
        configStatus: 'input_complete', // TODO: job config used to be a multi-step process, but not anymore and this col should probably be removed
        idMatchingMode: partner.idMatchingMode,
        tenantCode: tenant.code,
        partnerId: tenant.partnerId,
        apiIssuer: apiClient?.issuer,
        apiClientId: apiClient?.clientId,
        apiClientName: apiClient?.clientName,
      },
    });

    const basePath = [tenant.partnerId, tenant.code, input.schoolYearId, job.id]
      .map(encodeURIComponent)
      .join('/');

    const files = input.files.map((file) => {
      const nameInternal = `${file.templateKey}__${file.nameFromUser}`;
      return {
        templateKey: file.templateKey,
        nameFromUser: file.nameFromUser,
        type: file.type,
        nameInternal,
        path: `${basePath}/input/${nameInternal}`,
      };
    });

    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: {
        fileProtocol: 's3',
        fileBucketOrHost: this.appConfig.s3Bucket(),
        fileBasePath: basePath,
        files: { createMany: { data: files } },
      },
      include: { files: true },
    });

    return { status: 'success', job: updatedJob };
  }

  async getUploadUrls(files: JobFile[]) {
    return Promise.all(
      files.map(async (file) => ({
        templateKey: file.templateKey,
        url: await this.fileService.getPresignedUploadUrl({
          fullPath: file.path,
          fileType: file.type,
        }),
      }))
    );
  }

  async getDownloadUrlForInputFile(jobId: Job['id'], templateKey: JobFile['templateKey']) {
    const file = await this.prisma.jobFile.findUnique({
      where: { jobId_templateKey: { jobId, templateKey } },
    });

    if (!file) {
      return null;
    }
    return this.fileService.getPresignedDownloadUrl({
      fullPath: file.path,
      nameForDownload: file.nameFromUser,
    });
  }

  async getDownloadUrlForOutputFile(jobId: Job['id'], fileName: string) {
    const file = await this.prisma.runOutputFile.findFirst({
      where: { run: { jobId }, name: fileName },
      orderBy: { runId: 'desc' },
    });

    if (!file) {
      return null;
    }
    return this.fileService.getPresignedDownloadUrl({
      fullPath: file.path,
      nameForDownload: file.name,
    });
  }

  async updateFileStatusForJob(jobId: Job['id'], status: FileStatus, prisma: PrismaClient) {
    return prisma.job.update({
      where: { id: jobId },
      data: {
        files: { updateMany: { where: { jobId }, data: { status } } },
      },
      include: { files: true },
    });
  }

  async startJob(job: Job & { files: JobFile[] }, prisma: PrismaClient) {
    if (
      job.configStatus !== 'input_complete' ||
      job.files.some((file) => file.status !== 'upload_complete')
    ) {
      return { result: 'JOB_CONFIG_INCOMPLETE', job };
    }

    const runs = await prisma.run.findMany({ where: { jobId: job.id } });
    if (runs.some((run) => run.status === 'running' || run.status === 'new')) {
      return { result: 'JOB_IN_PROGRESS', job };
    }

    const run = await prisma.run.create({
      data: {
        jobId: job.id,
        status: 'new', // it may take aws a few min to start the run, so we won't update this status as part of this function
      },
      include: { job: { include: { schoolYear: true, files: true } } },
    });

    let startResult: ExecutorStartResult;
    try {
      startResult = await this.executor.start(run);
    } catch (e) {
      this.logger.error(`Failed to start run ${run.id}: ${e}`);

      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: 'error',
          runError: {
            create: {
              code: 'failed_to_start_executor',
              payload: { stacktrace: 'stacktrace unavailable' },
            },
          },
          runUpdate: {
            create: {
              action: 'done',
              status: 'failure',
            },
          },
        },
      });

      return { result: 'JOB_START_FAILED', job, error: e };
    }

    if (startResult.ecsTaskArn || startResult.taskSize) {
      try {
        await prisma.run.update({
          where: { id: run.id },
          data: { ecsTaskArn: startResult.ecsTaskArn, taskSize: startResult.taskSize },
        });
      } catch (e) {
        this.logger.error(`Failed to record ECS task for run ${run.id}: ${e}`);
      }
    }

    return { result: 'JOB_STARTED', job, run };
  }
}

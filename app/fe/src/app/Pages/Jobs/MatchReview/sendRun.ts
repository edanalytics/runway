import {
  GetRunDto,
  getResourceErrors,
  GetSendRunDto,
  GetStudentInputDetailsDto,
  GetStudentMatchDecisionDto,
} from '@edanalytics/models';

/*
 * A send run, as the reviewer who created it sees it: a submission.
 */

/**
 * How a send run turned out, as its submission shows it: `queued` while the
 * run is new, `running` while it runs, `complete` or `complete with errors`
 * once it succeeds, by whether a resource the bundle reports on has failed
 * records, and `failed` once it ends in error. Display only, not a status the
 * API stores.
 */
export type SendRunOutcome = 'queued' | 'running' | 'complete' | 'complete with errors' | 'failed';

export const sendRunOutcome = (
  sendRun: Pick<GetRunDto, 'status' | 'summary'>,
  reportResources: string[] | null | undefined
): SendRunOutcome => {
  switch (sendRun.status) {
    case 'new':
      return 'queued';
    case 'running':
      return 'running';
    case 'success':
      return getResourceErrors(sendRun.summary, reportResources).length
        ? 'complete with errors'
        : 'complete';
    case 'error':
      return 'failed';
  }
};

export const outcomeLabel: Record<SendRunOutcome, string> = {
  queued: 'Queued',
  running: 'Reprocessing',
  complete: 'Complete',
  'complete with errors': 'Complete with errors',
  failed: 'Run failed',
};

/** A submission's number: the job's first is 1. Send runs are never deleted, so it's stable. */
export const submissionNumber = (sendRuns: GetSendRunDto[], sendRun: GetSendRunDto) =>
  // The review read lists send runs newest first.
  sendRuns.length - sendRuns.findIndex(({ id }) => id === sendRun.id);

/**
 * How a support ticket names a submission. The ticket also carries the page's
 * URL, so it names no student.
 */
export const submissionReference = (jobId: number, number: number, sendRun: GetSendRunDto) =>
  `Job ${jobId} · submission ${number} (run ${sendRun.id})`;

/** A student as sending them again needs them: where they stand, and their decision's version. */
export type ResendableStudent = Pick<
  GetStudentInputDetailsDto,
  'correlationId' | 'status' | 'sendRunId'
> & { decision: Pick<GetStudentMatchDecisionDto, 'version'> | null };

/**
 * The students to send again from a failed send run, as submit takes them:
 * those it failed for, which is those still run-failed with it as their send
 * run. Any sent again since have a later send run.
 */
export const studentsToResend = (
  students: ResendableStudent[],
  sendRunId: number
): { correlationId: string; version: number }[] =>
  students.flatMap((student) =>
    student.status === 'run-failed' && student.sendRunId === sendRunId && student.decision
      ? [{ correlationId: student.correlationId, version: student.decision.version }]
      : []
  );

/** What a refused submit asks of the reviewer. */
export type SubmitRefusalAction =
  /** Leave these students out and submit the rest: `decision_changed`, `already_submitted`. */
  | 'leave out'
  /** As above, or exclude them first: `not_a_match`, `invalid_school_years`. */
  | 'leave out or exclude'
  /** Submit later, once the job's full run has succeeded: `full_run_not_done`. */
  | 'try later';

export type SubmitRefusal<S> = { code: string; action: SubmitRefusalAction; refused: S[] };

/**
 * A submit's 409, read against the students it submitted: which of them it
 * refused, by the body's `indices`, and what that asks of the reviewer. Null
 * for any other failure, which the page reports as an error: another status,
 * a code the page doesn't know, or a refusal that should name students and
 * doesn't.
 */
export const submitRefusal = <S>(body: unknown, submitted: S[]): SubmitRefusal<S> | null => {
  throw new Error('not implemented');
};

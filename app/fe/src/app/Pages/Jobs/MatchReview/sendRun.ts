import { GetRunDto, getResourceErrors, GetSendRunDto } from '@edanalytics/models';

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

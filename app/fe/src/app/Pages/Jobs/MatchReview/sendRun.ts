import { GetRunDto } from '@edanalytics/models';

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
  throw new Error('not implemented');
};

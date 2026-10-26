import { GetRunDto } from '@edanalytics/models';
import { describe, expect, it } from 'vitest';
import { sendRunOutcome } from './sendRun';

// The bundle reports on student assessments only, as every bundle does today.
const reportResources = ['studentAssessments'];

const sendRun = (
  status: GetRunDto['status'],
  summary: GetRunDto['summary'] = null
): Pick<GetRunDto, 'status' | 'summary'> => ({ status, summary });

describe('sendRunOutcome', () => {
  it('is queued while the run is new', () => {
    expect(sendRunOutcome(sendRun('new'), reportResources)).toBe('queued');
  });

  it('is running while the run runs', () => {
    expect(sendRunOutcome(sendRun('running'), reportResources)).toBe('running');
  });

  it('is complete when the run succeeded with no failed records', () => {
    const summary = {
      studentAssessments: { records_processed: 4, records_skipped: 0, records_failed: 0 },
    };
    expect(sendRunOutcome(sendRun('success', summary), reportResources)).toBe('complete');
  });

  it('is complete with errors when a reported resource has failed records', () => {
    const summary = {
      studentAssessments: { records_processed: 4, records_skipped: 0, records_failed: 1 },
    };
    expect(sendRunOutcome(sendRun('success', summary), reportResources)).toBe(
      'complete with errors'
    );
  });

  it('is complete when the only failed records are in a resource the bundle does not report on', () => {
    const summary = {
      studentAssessments: { records_processed: 4, records_skipped: 0, records_failed: 0 },
      students: { records_processed: 4, records_skipped: 0, records_failed: 4 },
    };
    expect(sendRunOutcome(sendRun('success', summary), reportResources)).toBe('complete');
  });

  it('is complete when the run succeeded without reporting a summary', () => {
    expect(sendRunOutcome(sendRun('success', null), reportResources)).toBe('complete');
  });

  it('is failed when the run ended in error, whatever it reported loading', () => {
    const summary = {
      studentAssessments: { records_processed: 4, records_skipped: 0, records_failed: 0 },
    };
    expect(sendRunOutcome(sendRun('error', summary), reportResources)).toBe('failed');
  });
});

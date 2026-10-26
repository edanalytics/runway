import { GetRunDto } from '@edanalytics/models';
import { describe, expect, it } from 'vitest';
import {
  needsAttention,
  ResendableStudent,
  sendRunOutcome,
  studentsToResend,
  submitRefusal,
} from './sendRun';

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

describe('studentsToResend', () => {
  const student = (
    correlationId: string,
    status: ResendableStudent['status'],
    sendRunId: number,
    version: number
  ): ResendableStudent => ({ correlationId, status, sendRunId, decision: { version } });

  it("picks the failed run's students, with their decisions' versions", () => {
    const students = [
      student('corr-1', 'run-failed', 41, 3),
      student('corr-2', 'run-failed', 41, 1),
    ];
    expect(studentsToResend(students, 41)).toEqual([
      { correlationId: 'corr-1', version: 3 },
      { correlationId: 'corr-2', version: 1 },
    ]);
  });

  it('leaves out students sent again since, whose send run is the later one', () => {
    const students = [
      student('corr-1', 'run-failed', 41, 3),
      student('corr-2', 'reprocessing', 42, 1),
    ];
    expect(studentsToResend(students, 41)).toEqual([{ correlationId: 'corr-1', version: 3 }]);
  });

  it('leaves out the students of another failed run', () => {
    const students = [
      student('corr-1', 'run-failed', 41, 3),
      student('corr-2', 'run-failed', 43, 2),
    ];
    expect(studentsToResend(students, 41)).toEqual([{ correlationId: 'corr-1', version: 3 }]);
  });

  it('picks no one from a run still reprocessing', () => {
    const students = [student('corr-1', 'reprocessing', 44, 2)];
    expect(studentsToResend(students, 44)).toEqual([]);
  });
});

describe('submitRefusal', () => {
  const submitted = [
    { correlationId: 'corr-1', version: 2 },
    { correlationId: 'corr-2', version: 1 },
    { correlationId: 'corr-3', version: 4 },
  ];

  // The bodies are the submit route's, as Nest sends a ConflictException.
  it('leaves out students whose decision changed, by their positions in the submit', () => {
    const body = {
      statusCode: 409,
      code: 'decision_changed',
      message: 'A student’s decision has changed since the page loaded.',
      indices: [0, 2],
    };
    expect(submitRefusal(body, submitted)).toEqual({
      code: 'decision_changed',
      action: 'leave out',
      refused: [submitted[0], submitted[2]],
    });
  });

  it('leaves out students already submitted, as when two reviewers submit the same student', () => {
    const body = {
      statusCode: 409,
      code: 'already_submitted',
      message: 'A student’s match is being or has been sent.',
      indices: [1],
    };
    expect(submitRefusal(body, submitted)).toEqual({
      code: 'already_submitted',
      action: 'leave out',
      refused: [submitted[1]],
    });
  });

  it('offers to exclude students whose decision is no longer a match', () => {
    const body = {
      statusCode: 409,
      code: 'not_a_match',
      message: 'A student’s decision isn’t a match.',
      indices: [1],
    };
    expect(submitRefusal(body, submitted)).toEqual({
      code: 'not_a_match',
      action: 'leave out or exclude',
      refused: [submitted[1]],
    });
  });

  it('offers to exclude students whose match has no valid school years', () => {
    const body = {
      statusCode: 409,
      code: 'invalid_school_years',
      message: 'A student’s match has no valid school years.',
      indices: [2],
    };
    expect(submitRefusal(body, submitted)).toEqual({
      code: 'invalid_school_years',
      action: 'leave out or exclude',
      refused: [submitted[2]],
    });
  });

  it('asks to try later, refusing no one in particular, while the full run has not succeeded', () => {
    const body = {
      statusCode: 409,
      code: 'full_run_not_done',
      message: 'The job’s full run hasn’t succeeded.',
    };
    expect(submitRefusal(body, submitted)).toEqual({
      code: 'full_run_not_done',
      action: 'try later',
      refused: [],
    });
  });

  it('is null for a refusal that should name students and does not', () => {
    const body = {
      statusCode: 409,
      code: 'decision_changed',
      message: 'A student’s decision has changed since the page loaded.',
    };
    expect(submitRefusal(body, submitted)).toBeNull();
  });

  it('is null for a failure that is not a refusal, such as a student missing from the job', () => {
    const body = { statusCode: 404, code: 'not_found', message: 'A student isn’t in the job.' };
    expect(submitRefusal(body, submitted)).toBeNull();
  });

  it('is null for a failure with no code', () => {
    const body = { statusCode: 500, message: 'Failed to submit the matches' };
    expect(submitRefusal(body, submitted)).toBeNull();
  });
});

describe('needsAttention', () => {
  it('needs the reviewer once complete with errors, for support to trace', () => {
    expect(needsAttention('complete with errors', 0)).toBe(true);
  });

  it('needs the reviewer when failed with students still to send again', () => {
    expect(needsAttention('failed', 2)).toBe(true);
  });

  it('needs no one when failed but all its students have been sent again', () => {
    expect(needsAttention('failed', 0)).toBe(false);
  });

  it('needs the reviewer when failed and the page cannot tell who is left, past the limit', () => {
    expect(needsAttention('failed', null)).toBe(true);
  });

  it('needs no one while queued, running or complete', () => {
    expect(needsAttention('queued', 0)).toBe(false);
    expect(needsAttention('running', 0)).toBe(false);
    expect(needsAttention('complete', 0)).toBe(false);
  });
});

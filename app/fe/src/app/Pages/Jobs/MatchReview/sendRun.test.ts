import { GetRunDto, GetSendRunDto } from '@edanalytics/models';
import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from '@jest/globals';
import {
  needsAttention,
  ResendableStudent,
  sendRunOutcome,
  studentsToResend,
  submissionNumber,
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

describe('submissionNumber', () => {
  // As the review read lists a job's send runs: newest first.
  const sendRuns = [44, 42, 41].map((id) => plainToInstance(GetSendRunDto, { id }));

  it("numbers a job's submissions from its first, the last the read lists", () => {
    expect(sendRuns.map((sendRun) => submissionNumber(sendRuns, sendRun))).toEqual([3, 2, 1]);
  });
});

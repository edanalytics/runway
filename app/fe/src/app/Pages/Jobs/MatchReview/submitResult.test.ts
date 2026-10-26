import { describe, expect, it } from 'vitest';
import { submitRefusal, wroteNothing } from './submitResult';

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

describe('wroteNothing', () => {
  it('is true for a refusal', () => {
    const body = {
      statusCode: 409,
      code: 'already_submitted',
      message: 'A student’s match is being or has been sent.',
      indices: [0],
    };
    expect(wroteNothing(body)).toBe(true);
  });

  it('is true for a student missing from the job, which the API checks before writing', () => {
    const body = { statusCode: 404, code: 'not_found', message: 'A student isn’t in the job.' };
    expect(wroteNothing(body)).toBe(true);
  });

  it('is true for a body that fails validation', () => {
    const body = {
      statusCode: 400,
      message: ['students must contain at least 1 elements'],
      error: 'Bad Request',
    };
    expect(wroteNothing(body)).toBe(true);
  });

  it('is false for a server error, which can come after the submit committed', () => {
    const body = { statusCode: 500, message: 'Failed to submit the matches' };
    expect(wroteNothing(body)).toBe(false);
  });

  it('is false for a failure with no response, such as a dropped connection', () => {
    expect(wroteNothing({ message: 'Network Error', code: 'ERR_NETWORK' })).toBe(false);
  });
});

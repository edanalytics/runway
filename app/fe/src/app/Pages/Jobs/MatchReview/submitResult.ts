import {
  PostStudentMatchSubmitStudentDto,
  StudentMatchSubmitRefusalCode,
} from '@edanalytics/models';

/*
 * A failed submit, as the page reads the API's answer.
 */

/** What a refused submit asks of the reviewer. */
export type SubmitRefusalAction =
  /** Leave these students out and submit the rest: `decision_changed`, `already_submitted`. */
  | 'leave out'
  /** As above, or exclude them first: `not_a_match`, `invalid_school_years`. */
  | 'leave out or exclude'
  /** Submit later, once the job's full run has succeeded: `full_run_not_done`. */
  | 'try later';

export type SubmitRefusal = {
  code: StudentMatchSubmitRefusalCode | 'full_run_not_done';
  action: SubmitRefusalAction;
  refused: PostStudentMatchSubmitStudentDto[];
};

/** What each code that names students asks of the reviewer. */
const refusalActions: Record<StudentMatchSubmitRefusalCode, SubmitRefusalAction> = {
  decision_changed: 'leave out',
  already_submitted: 'leave out',
  not_a_match: 'leave out or exclude',
  invalid_school_years: 'leave out or exclude',
};

const isRefusalCode = (code: string): code is StudentMatchSubmitRefusalCode =>
  Object.keys(refusalActions).includes(code);

/**
 * A submit's 409, read against the students it submitted: which of them it
 * refused, by the body's `indices`, and what that asks of the reviewer. Null
 * for any other failure, which the page reports as an error: another status,
 * a code the page doesn't know, or a refusal that should name students and
 * doesn't.
 */
export const submitRefusal = (
  body: unknown,
  submitted: PostStudentMatchSubmitStudentDto[]
): SubmitRefusal | null => {
  const { statusCode, code, indices } = (body ?? {}) as {
    statusCode?: unknown;
    code?: unknown;
    indices?: unknown;
  };
  if (statusCode !== 409 || typeof code !== 'string') return null;
  if (code === 'full_run_not_done') return { code, action: 'try later', refused: [] };
  if (!isRefusalCode(code) || !Array.isArray(indices)) return null;
  return {
    code,
    action: refusalActions[code],
    refused: submitted.filter((_, index) => indices.includes(index)),
  };
};

/** Why a refused submit refused its students, in a sentence for the reviewer. */
export const refusalReason = ({ code, refused }: SubmitRefusal) => {
  const n = refused.length;
  const students = `${n} ${n === 1 ? 'student' : 'students'}`;
  switch (code) {
    case 'decision_changed':
      return `${students} had ${
        n === 1 ? 'its decision' : 'their decisions'
      } changed since the page loaded.`;
    case 'already_submitted':
      return `${students} ${n === 1 ? 'is' : 'are'} already in another submission.`;
    case 'not_a_match':
      return `${students} no longer ${n === 1 ? 'has a match' : 'have matches'}.`;
    case 'invalid_school_years':
      return `${students} ${
        n === 1 ? 'is' : 'are'
      } matched to a student with no school years on record, so ${
        n === 1 ? 'it' : 'they'
      } can't be sent.`;
    // The one refusal that names no students.
    case 'full_run_not_done':
      return 'The job is still processing, so nothing can be submitted yet.';
  }
};

/**
 * A failed submit, as the page reports it: `refused`, for a refusal the page
 * can act on; `not submitted`, when the API certainly wrote nothing; or
 * `unknown`, when a server error or a lost response leaves open whether the
 * submit committed. `refreshed` says whether the page has caught up since.
 */
export type SubmitFailure = { message: string; refreshed: boolean } & (
  | { kind: 'refused'; refusal: SubmitRefusal }
  | { kind: 'not submitted' }
  | { kind: 'unknown' }
);

/** What a failed submit or Send again tells the reviewer, in the modal and the toast alike. */
export const submitFailureText = (failure: SubmitFailure, verb: 'submitted' | 'sent again') => ({
  title:
    failure.kind === 'unknown'
      ? `Couldn’t confirm whether they were ${verb}`
      : `Nothing was ${verb}`,
  detail:
    failure.kind === 'refused'
      ? refusalReason(failure.refusal)
      : failure.kind === 'not submitted'
      ? failure.message
      : `${failure.message} They may already be in a submission.`,
  caughtUp: failure.refreshed
    ? 'The list has been refreshed.'
    : 'The list couldn’t be refreshed: reload the page before going on.',
});

/**
 * Whether a failed submit certainly wrote nothing: the API answered with a
 * client error, which it decides before writing anything. A 5xx can come
 * after the submit committed, and a failure with no status, such as a lost
 * response, says nothing either way.
 */
export const wroteNothing = (body: unknown): boolean => {
  const { statusCode } = (body ?? {}) as { statusCode?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
};

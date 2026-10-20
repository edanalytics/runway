import { Injectable } from '@nestjs/common';
import { StudentRosterDetailsJson, StudentSearchDetailsDto } from '@edanalytics/models';
import { IdrsCredentials, IdrsCredentialsService } from './idrs-credentials.service';
import { idrsStudentSearchUrl } from './idrs-student-search-url';

/**
 * The search request's own bound. Getting credentials is bounded separately,
 * at 5 s for the secret and 5 s for the token.
 */
const IDRS_SEARCH_TIMEOUT_MS = 20_000;

/** One of IDRS's matches, as returned, including fields not named here. */
type IdrsStudentMatch = StudentRosterDetailsJson & {
  student_unique_id: string;
  score: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The matches from IDRS's response to a search for one student, or null if
 * the response isn't one result, for that student, whose matches each have a
 * student unique id and a numeric score.
 */
function parseStudentSearchResponse(
  body: unknown,
  correlationId: string
): IdrsStudentMatch[] | null {
  if (!Array.isArray(body) || body.length !== 1) {
    return null;
  }
  const [result] = body;
  if (!isObject(result) || result.correlation_id !== correlationId) {
    return null;
  }
  const { matches } = result;
  if (!Array.isArray(matches)) {
    return null;
  }
  const valid = matches.every(
    (match) =>
      isObject(match) &&
      typeof match.student_unique_id === 'string' &&
      match.student_unique_id.length > 0 &&
      typeof match.score === 'number' &&
      Number.isFinite(match.score)
  );
  return valid ? matches : null;
}

/** Searches IDRS for one student on a partner's behalf. */
@Injectable()
export class IdrsSearchService {
  constructor(private readonly credentials: IdrsCredentialsService) {}

  /**
   * Returns every match IDRS found. Writes no log line of its own: the
   * controller logs one line per search, with the job and user ids this
   * service doesn't have. So a failure's `cause` must be safe to log: a short
   * description, with IDRS's status or the error's name where it helps, or the
   * credentials service's own error, whose messages name no secrets. Never a
   * response body, which could quote student data.
   */
  async searchStudent(input: {
    partnerId: string;
    tenantCode: string;
    correlationId: string;
    details: StudentSearchDetailsDto;
  }): Promise<
    | { status: 'SUCCESS'; data: IdrsStudentMatch[] }
    | { status: 'ERROR'; code: 'identity_service_unavailable'; cause: string }
  > {
    const { partnerId, tenantCode, correlationId, details } = input;
    const unavailable = (cause: string) =>
      ({ status: 'ERROR', code: 'identity_service_unavailable', cause } as const);

    let credentials: IdrsCredentials;
    try {
      credentials = await this.credentials.getCredentials(partnerId);
    } catch (err) {
      return unavailable(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }

    let response: Response;
    try {
      response = await fetch(idrsStudentSearchUrl(credentials.url, partnerId, tenantCode), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        // The student's own correlation id, so a reviewer's search can be traced
        // to the same student as the Executor's, in any IDRS logs that show it.
        body: JSON.stringify([{ correlation_id: correlationId, ...details }]),
        signal: AbortSignal.timeout(IDRS_SEARCH_TIMEOUT_MS),
      });
    } catch (err) {
      return unavailable(`search request failed (${err instanceof Error ? err.name : 'unknown'})`);
    }

    if (!response.ok) {
      // Status only: a 400's details describe the student's fields.
      return unavailable(`search rejected with status ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      return unavailable(
        `search response unreadable (${err instanceof Error ? err.name : 'unknown'})`
      );
    }
    const matches = parseStudentSearchResponse(body, correlationId);
    if (!matches) {
      return unavailable('search response malformed');
    }
    return { status: 'SUCCESS', data: matches };
  }
}

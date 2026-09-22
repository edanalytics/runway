import { BadRequestException, Injectable, Logger, PipeTransform } from '@nestjs/common';

/**
 * Validation and projection for the unmatched-student-records callback.
 *
 * The contract is deliberately permissive about student details: malformed
 * names and dates may be exactly why a record needs human review, so recognized
 * fields are preserved verbatim rather than semantically validated. Only
 * structural fields — the array shape, correlation ids, canonical student ids
 * and scores — are enforced.
 *
 * Nest's global ValidationPipe does not validate an array of DTOs, so this pipe
 * checks the top-level array explicitly instead of relying on it.
 */

/** A value as it arrives from JSON.parse. */
export type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

export interface NormalizedSuggestion {
  ordinal: number;
  studentUniqueId: string;
  rosterDetails: Record<string, JsonLike>;
  score: number;
}

export interface NormalizedRecord {
  correlationId: string;
  inputDetails: Record<string, JsonLike>;
  suggestions: NormalizedSuggestion[];
}

/** Recognized input-detail fields. Missing ones stay missing. */
const CANDIDATE_FIELDS = [
  'first_name',
  'last_name',
  'birth_date',
  'school_ids',
  'student_ids',
] as const;

/** Recognized roster fields. Missing ones normalize to JSON null. */
const ROSTER_FIELDS = [
  'first_name',
  'middle_name',
  'last_name',
  'birth_date',
  'student_ids',
  'school_years',
] as const;

/** Recognized fields of a roster student-id object. */
const STUDENT_ID_FIELDS = ['id_type', 'id_value'] as const;

/** Matches the SQL CHECK on correlation_id, counted in code points. */
const MAX_CORRELATION_ID_LENGTH = 128;

const isPlainObject = (value: unknown): value is Record<string, JsonLike> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * PostgreSQL's length() counts characters, so the wire bound must too —
 * JavaScript's .length counts UTF-16 units and would let a 129-character id
 * through, or reject a valid one built from astral characters.
 */
const codePointLength = (value: string) => Array.from(value).length;

@Injectable()
export class UnmatchedStudentRecordsPipe implements PipeTransform<unknown, NormalizedRecord[]> {
  private readonly logger = new Logger(UnmatchedStudentRecordsPipe.name);

  transform(body: unknown): NormalizedRecord[] {
    try {
      return this.project(body);
    } catch (err) {
      // The message carries an index and a field name, never body content.
      this.logger.warn(
        `unmatched student records: rejected payload: ${
          err instanceof Error ? err.message : 'invalid payload'
        }`
      );
      throw err;
    }
  }

  private project(body: unknown): NormalizedRecord[] {
    // A JSON string is not an array of records. Check before iterating, so a
    // string is never treated as a sequence of characters.
    if (!Array.isArray(body)) {
      throw new BadRequestException('body must be an array of unmatched student records');
    }

    const seen = new Set<string>();
    return body.map((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new BadRequestException(`record ${index}: must be an object`);
      }

      const correlationId = entry['correlation_id'];
      if (typeof correlationId !== 'string' || correlationId.length === 0) {
        throw new BadRequestException(`record ${index}: correlation_id must be a nonempty string`);
      }
      if (codePointLength(correlationId) > MAX_CORRELATION_ID_LENGTH) {
        throw new BadRequestException(
          `record ${index}: correlation_id must be at most ${MAX_CORRELATION_ID_LENGTH} characters`
        );
      }
      // Correlation ids are opaque digests to us. We bound their length and
      // require uniqueness within a request, but never validate their encoding.
      if (seen.has(correlationId)) {
        throw new BadRequestException(`record ${index}: duplicate correlation_id in request`);
      }
      seen.add(correlationId);

      const candidate = entry['candidate'];
      if (!isPlainObject(candidate)) {
        throw new BadRequestException(`record ${index}: candidate must be an object`);
      }

      const matches = entry['matches'];
      if (!Array.isArray(matches)) {
        throw new BadRequestException(`record ${index}: matches must be an array`);
      }

      return {
        correlationId,
        inputDetails: this.projectCandidate(candidate),
        suggestions: matches.map((match, ordinal) =>
          this.projectSuggestion(match, index, ordinal)
        ),
      };
    });
  }

  /**
   * Recognized fields only, values untouched. Absent stays absent: on the input
   * side, missing and null are different observations about the source row.
   */
  private projectCandidate(candidate: Record<string, JsonLike>): Record<string, JsonLike> {
    const projected: Record<string, JsonLike> = {};
    for (const field of CANDIDATE_FIELDS) {
      if (field in candidate && candidate[field] !== undefined) {
        projected[field] = candidate[field];
      }
    }
    return projected;
  }

  private projectSuggestion(match: unknown, index: number, ordinal: number): NormalizedSuggestion {
    if (!isPlainObject(match)) {
      throw new BadRequestException(`record ${index}, match ${ordinal}: must be an object`);
    }

    const studentUniqueId = match['student_unique_id'];
    if (typeof studentUniqueId !== 'string' || studentUniqueId.length === 0) {
      throw new BadRequestException(
        `record ${index}, match ${ordinal}: student_unique_id must be a nonempty string`
      );
    }

    const score = match['score'];
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new BadRequestException(
        `record ${index}, match ${ordinal}: score must be a finite number`
      );
    }

    // Unlike the candidate, missing roster fields become null: IDRS gives their
    // absence no meaning distinct from null. Empty strings and empty arrays stay
    // distinct from both.
    const rosterDetails: Record<string, JsonLike> = {};
    for (const field of ROSTER_FIELDS) {
      const value = match[field];
      rosterDetails[field] =
        field === 'student_ids' ? this.projectStudentIds(value) : value ?? null;
    }

    return { ordinal, studentUniqueId, rosterDetails, score };
  }

  /**
   * Roster student ids are objects, unlike the candidate's plain strings. Project
   * recognized keys when an entry has that documented shape and leave anything
   * else verbatim — coercing a malformed value would destroy the evidence a
   * reviewer needs. Order and duplicates are preserved.
   */
  private projectStudentIds(value: JsonLike | undefined): JsonLike {
    if (!Array.isArray(value)) {
      return value ?? null;
    }
    return value.map((entry) => {
      if (!isPlainObject(entry)) {
        return entry;
      }
      const projected: Record<string, JsonLike> = {};
      for (const field of STUDENT_ID_FIELDS) {
        projected[field] = entry[field] ?? null;
      }
      return projected;
    });
  }
}

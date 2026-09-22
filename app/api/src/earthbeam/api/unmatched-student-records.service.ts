import { Injectable, Logger } from '@nestjs/common';
import { NormalizedRecord } from './unmatched-student-records.pipe';
import {
  IngestionOutcome,
  UnmatchedStudentRecordsRepository,
} from './unmatched-student-records.repository';

export type IngestResult =
  | { status: 'SUCCESS' }
  | { status: 'ERROR'; code: Exclude<IngestionOutcome, 'SUCCESS'> };

@Injectable()
export class UnmatchedStudentRecordsService {
  private readonly logger = new Logger(UnmatchedStudentRecordsService.name);

  constructor(private readonly repository: UnmatchedStudentRecordsRepository) {}

  async ingest(runId: number, records: NormalizedRecord[]): Promise<IngestResult> {
    const startedAt = Date.now();
    const suggestionCount = records.reduce((total, r) => total + r.suggestions.length, 0);

    try {
      const outcome = await this.repository.ingest(runId, records);
      // Counts and identifiers only — never correlation ids, names or any other
      // detail under review.
      this.logger.log(
        `unmatched student records: runId=${runId} outcome=${outcome} records=${records.length} ` +
          `suggestions=${suggestionCount} durationMs=${Date.now() - startedAt}`
      );
      return outcome === 'SUCCESS' ? { status: 'SUCCESS' } : { status: 'ERROR', code: outcome };
    } catch (err) {
      // An allowlisted error name only: a raw driver message can quote the
      // parameters that failed, which are student details.
      this.logger.error(
        `unmatched student records: runId=${runId} outcome=FAILED records=${records.length} ` +
          `suggestions=${suggestionCount} durationMs=${Date.now() - startedAt} ` +
          `cause=${err instanceof Error ? err.name : 'unknown'}`
      );
      throw err;
    }
  }
}

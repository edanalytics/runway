import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  Logger,
  ParseArrayPipe,
} from '@nestjs/common';
import { EarthbeamApiStudentMatchResultDto } from '@edanalytics/models';

/**
 * Validates the unmatched-student-records body, a top-level array of match
 * results, against EarthbeamApiStudentMatchResultDto one item at a time, and
 * logs what it rejects.
 *
 * ParseArrayPipe also splits string input on commas, being built for query
 * strings. A request body cannot reach it as a string: the JSON body parser's
 * strict mode (the default) accepts only objects and arrays. Keep strict mode
 * on if this route ever gets its own parser.
 */
@Injectable()
export class UnmatchedStudentRecordsPipe extends ParseArrayPipe {
  private readonly logger = new Logger(UnmatchedStudentRecordsPipe.name);

  constructor() {
    super({ items: EarthbeamApiStudentMatchResultDto });
  }

  // Logged here rather than via exceptionFactory, which ParseArrayPipe also
  // hands to its inner ValidationPipe with a different argument shape.
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    try {
      return await super.transform(value, metadata);
    } catch (err) {
      if (err instanceof BadRequestException) {
        // Indices, field names and constraints only; never values.
        const response = err.getResponse();
        const message =
          typeof response === 'object' && response !== null && 'message' in response
            ? (response as { message: unknown }).message
            : err.message;
        this.logger.warn(
          `unmatched student records: rejected payload: ${
            Array.isArray(message) ? message.join('; ') : String(message)
          }`
        );
      }
      throw err;
    }
  }
}

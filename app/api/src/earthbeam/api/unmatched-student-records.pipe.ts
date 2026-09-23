import {
  BadRequestException,
  Injectable,
  Logger,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { UnmatchedStudentRecordDto } from '@edanalytics/models';

/**
 * Validates the unmatched-student-records callback body against
 * UnmatchedStudentRecordDto, which holds the rules and the projection.
 *
 * This pipe does only what a DTO cannot. The body is a top-level array, which
 * Nest's global ValidationPipe skips. `ParseArrayPipe` would handle an array
 * but is built for query strings: it splits a string body on commas and
 * JSON-parses the pieces, so a string holding one record would be accepted.
 * Duplicate correlation ids span items, which a single item's DTO cannot see.
 */
@Injectable()
export class UnmatchedStudentRecordsPipe
  implements PipeTransform<unknown, Promise<UnmatchedStudentRecordDto[]>>
{
  private readonly logger = new Logger(UnmatchedStudentRecordsPipe.name);

  // Unlike the global pipe, drops unknown keys instead of passing them
  // through — here they would otherwise be stored — and lets DTO defaults
  // stand in for missing fields. See UnmatchedStudentRecordDto.
  private readonly validation = new ValidationPipe({
    transform: true,
    transformOptions: { excludeExtraneousValues: true, exposeDefaultValues: true },
  });

  async transform(body: unknown): Promise<UnmatchedStudentRecordDto[]> {
    try {
      return await this.validate(body);
    } catch (err) {
      // Messages carry indices, field names and constraints, never values.
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `unmatched student records: rejected payload: ${messagesOf(err).join('; ')}`
        );
      }
      throw err;
    }
  }

  private async validate(body: unknown): Promise<UnmatchedStudentRecordDto[]> {
    if (!Array.isArray(body)) {
      throw new BadRequestException('body must be an array of unmatched student records');
    }

    const records: UnmatchedStudentRecordDto[] = [];
    for (const [index, item] of body.entries()) {
      try {
        records.push(
          await this.validation.transform(item, {
            type: 'body',
            metatype: UnmatchedStudentRecordDto,
          })
        );
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw new BadRequestException(messagesOf(err).map((m) => `record ${index}: ${m}`));
        }
        throw err;
      }
    }

    const seen = new Set<string>();
    for (const [index, record] of records.entries()) {
      if (seen.has(record.correlation_id)) {
        throw new BadRequestException(`record ${index}: duplicate correlation_id in request`);
      }
      seen.add(record.correlation_id);
    }
    return records;
  }
}

const messagesOf = (err: BadRequestException): string[] => {
  const response = err.getResponse();
  const message =
    typeof response === 'object' && response !== null && 'message' in response
      ? (response as { message: unknown }).message
      : err.message;
  return Array.isArray(message) ? message.map(String) : [String(message)];
};

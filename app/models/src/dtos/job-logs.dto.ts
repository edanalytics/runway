import { Expose, Type } from 'class-transformer';
import { makeSerializer } from '../utils';

export class GetJobLogEventDto {
  @Expose()
  timestamp: number | null;

  @Expose()
  message: string;
}

export class GetJobLogsDto {
  @Expose()
  @Type(() => GetJobLogEventDto)
  events: GetJobLogEventDto[];

  // Pass back as `cursor` to get the next page, or, at the end, any lines
  // written since. Null only if CloudWatch gave no position to resume from.
  @Expose()
  nextCursor: string | null;

  // Whether this page reaches the current end of the stream. More lines can
  // still arrive while the executor is running.
  @Expose()
  atEnd: boolean;
}

export const toGetJobLogsDto = makeSerializer<GetJobLogsDto>(GetJobLogsDto);

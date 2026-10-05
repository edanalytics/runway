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

  // Pass back as `cursor` to get the next page; null once the stream is exhausted
  @Expose()
  nextCursor: string | null;
}

export const toGetJobLogsDto = makeSerializer<GetJobLogsDto>(GetJobLogsDto);

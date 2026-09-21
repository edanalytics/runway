import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils';

export class GetOutputFileDto {
  @Expose()
  runId: number;

  @Expose()
  name: string;
}

export const toGetOutputFileDto = makeSerializer<GetOutputFileDto>(GetOutputFileDto);

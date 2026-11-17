import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils';

export class GetOutputFileDto {
  @Expose()
  name: string;
}

export const toGetOutputFileDto = makeSerializer<GetOutputFileDto>(GetOutputFileDto);

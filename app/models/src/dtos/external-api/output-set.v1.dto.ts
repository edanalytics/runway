import { Expose } from 'class-transformer';
import { makeSerializer } from '../../utils';

export class OutputSetV1Dto {
  @Expose()
  uid: string;

  @Expose()
  files: string[];

  @Expose()
  sentToOds: boolean;

  @Expose()
  createdAt: string;

  @Expose()
  jobUid: string;

  @Expose()
  partner: string;

  @Expose()
  tenant: string;

  @Expose()
  schoolYear: string;

  @Expose()
  bundle: string;
}
export const toOutputSetV1Dto = makeSerializer(OutputSetV1Dto);

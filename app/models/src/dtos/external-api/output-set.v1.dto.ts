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

export class OutputSetListV1ResponseDto {
  @Expose()
  data: OutputSetV1Dto[];
}

export class OutputSetDownloadLinksV1ResponseDto {
  @Expose()
  downloadLinks: Record<string, string>;
}

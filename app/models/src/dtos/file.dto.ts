import { Expose } from 'class-transformer';
import { FileStatus } from '@prisma/client';
import { GetJobDto } from './job.dto';

export class GetFileDto {
  @Expose()
  nameFromUser: string;

  @Expose()
  type: string;

  @Expose()
  path: string;

  @Expose()
  status: FileStatus;

  @Expose()
  templateKey: string;

  @Expose()
  jobId: GetJobDto['id'];
}

export class PostFileDto {
  @Expose()
  nameFromUser: string;

  @Expose()
  type: string;

  @Expose()
  templateKey: string;
}

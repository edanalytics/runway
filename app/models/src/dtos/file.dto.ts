import { Expose } from 'class-transformer';
import { FileStatus } from '@prisma/client';
import { GetJobDto } from './job.dto';
import { IsNotEmpty, IsString } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  nameFromUser: string;

  @Expose() // TODO: determin whether type is actually required and reliably provided
  type: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  templateKey: string;
}

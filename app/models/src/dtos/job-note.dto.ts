import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import { GetUserDto } from './user.dto';
import { JobNote, User } from '@prisma/client';
import { makeSerializerCustomType } from '../utils/make-serializer';
import { DtoGetBase, GetDto } from '../utils';
import { NOTE_CHAR_LIMIT } from '../constants';
import { IsString } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { MaxLength } from 'class-validator';

export class GetJobNoteDto extends DtoGetBase implements GetDto<JobNote, 'displayName'> {
  @Expose()
  jobId: number;

  @Expose()
  id: number;

  @Expose()
  noteText: string;

  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true })) // not using @Type here since we might add sensitive data to the User DTO.
  createdBy: GetUserDto;

  @Expose()
  @Transform(({ value }) => plainToInstance(GetUserDto, value, { excludeExtraneousValues: true })) // not using @Type here since we might add sensitive data to the User DTO.
  modifiedBy: GetUserDto;
}

export const toGetJobNoteDto = makeSerializerCustomType<GetJobNoteDto, JobNote>(GetJobNoteDto);

export class PostJobNoteDto {
  @Expose()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_CHAR_LIMIT)
  noteText: string;
}
export class PostJobNoteResponseDto {
  @Expose()
  @Type(() => GetJobNoteDto)
  note: GetJobNoteDto;
}

export class PutJobNoteDto extends PostJobNoteDto {}
export class PutJobNoteResponseDto extends PostJobNoteResponseDto {}

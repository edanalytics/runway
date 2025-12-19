import { Expose } from 'class-transformer';
import { MinLength } from 'class-validator';
import type { IUser } from '../interfaces/user.interface';
import { DtoGetBase, GetDto, GettersOmit } from '../utils/get-base.dto';
import { makeSerializer } from '../utils/make-serializer';
import { DtoPostBase, PostDto } from '../utils/post-base.dto';
import { DtoPutBase, PutDto } from '../utils/put-base.dto';

type UserDtoOmit = 'idpId' | 'externalUserId';

export class GetUserDto extends DtoGetBase implements GetDto<IUser, UserDtoOmit> {
  @Expose()
  id: number;

  @Expose()
  email: string | null;

  @Expose()
  givenName: string;

  @Expose()
  familyName: string;

  get fullName() {
    return this.givenName + ' ' + this.familyName;
  }

  get displayName() {
    return this.fullName;
  }
}
export const toGetUserDto = makeSerializer<GetUserDto, 'fullName' | GettersOmit>(GetUserDto);

export class PutUserDto extends DtoPutBase implements PutDto<IUser, UserDtoOmit | 'fullName'> {
  @Expose()
  email: string | null;

  @Expose()
  @MinLength(2)
  givenName: string;

  @Expose()
  @MinLength(2)
  familyName: string;
}

export class PostUserDto extends DtoPostBase implements PostDto<IUser, UserDtoOmit | 'fullName'> {
  @Expose()
  email: string | null;

  @Expose()
  givenName: string;

  @Expose()
  familyName: string;
}

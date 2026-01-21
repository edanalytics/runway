import { PrivilegeKey } from './privileges';
import { AppRoles, rolePrivileges } from './role-privileges';
import { GetUserDto, toGetUserDto } from './user.dto';
import { IPassportSession } from '../interfaces';
import { Expose, Transform, Type } from 'class-transformer';
import { Tenant } from '@prisma/client';
import { GetTenantDto } from './tenant.dto';
import { makeSerializerCustomType } from '../utils';

// May extend this in the future, keeping it simple for now
export class GetSessionDataDto {
  @Expose()
  @Transform(({ value }) => toGetUserDto(value))
  user: GetUserDto;
  @Expose()
  @Type(() => GetTenantDto)
  tenant: Tenant;
  @Expose()
  roles?: AppRoles[];
  get privileges() {
    if (!this.roles) return new Set<PrivilegeKey>();
    return new Set<PrivilegeKey>(
      this.roles.flatMap((role) => (role in rolePrivileges ? Array.from(rolePrivileges[role]) : []))
    );
  }
}
export const toGetSessionDataDto = makeSerializerCustomType<GetSessionDataDto, IPassportSession>(
  GetSessionDataDto
);

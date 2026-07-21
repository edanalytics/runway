import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils/make-serializer';
import { Tenant } from '@prisma/client';
import { DtoGetBase } from '../utils';

export class GetTenantDto extends DtoGetBase implements Tenant {
  @Expose()
  code: string;

  @Expose()
  partnerId: string;

  @Expose()
  deletedOn: Date | null;

  @Expose()
  isGlobal: boolean;

  isDescendant(potentialParent: GetTenantDto): boolean {
    return !this.isGlobal && potentialParent.isGlobal && this.partnerId === potentialParent.partnerId;
  }
}

export const toGetTenantDto = makeSerializer<GetTenantDto>(GetTenantDto);

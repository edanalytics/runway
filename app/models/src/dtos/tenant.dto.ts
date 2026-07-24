import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils/make-serializer';
import { Tenant } from '@prisma/client';
import { DtoGetBase } from '../utils';

export const isDescendant = (potentialParent: GetTenantDto, potentialChild: GetTenantDto) => {
  //TODO: expand this when we have the full metatenancy hierarchy synced
  return (
    !potentialChild.isGlobal &&
    potentialParent.isGlobal &&
    potentialChild.partnerId === potentialParent.partnerId
  );
};
export class GetTenantDto extends DtoGetBase implements Tenant {
  @Expose()
  code: string;

  @Expose()
  partnerId: string;

  @Expose()
  deletedOn: Date | null;

  @Expose()
  isGlobal: boolean;
}

export const toGetTenantDto = makeSerializer<GetTenantDto>(GetTenantDto);

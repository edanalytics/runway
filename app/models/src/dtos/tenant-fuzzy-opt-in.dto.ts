import { Expose, Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { makeSerializer } from '../utils/make-serializer';

export class GetTenantFuzzyOptInDto {
  @Expose()
  tenantCode: string;

  @Expose()
  fuzzyOptIn: boolean;
}

export const toGetTenantFuzzyOptInDto =
  makeSerializer<GetTenantFuzzyOptInDto>(GetTenantFuzzyOptInDto);

export class GetTenantFuzzyOptInsDto {
  @Expose()
  @Type(() => GetTenantFuzzyOptInDto)
  tenants: GetTenantFuzzyOptInDto[];
}

export const toGetTenantFuzzyOptInsDto =
  makeSerializer<GetTenantFuzzyOptInsDto>(GetTenantFuzzyOptInsDto);

export class PutTenantFuzzyOptInDto {
  @IsBoolean()
  fuzzyOptIn: boolean;
}

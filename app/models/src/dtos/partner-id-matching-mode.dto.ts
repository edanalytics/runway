import { Expose } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { IdMatchingMode } from '@prisma/client';
import { makeSerializer } from '../utils/make-serializer';

export class PutPartnerIdMatchingModeDto {
  @IsEnum(IdMatchingMode)
  idMatchingMode: IdMatchingMode;
}

export class GetPartnerIdMatchingModeDto {
  @Expose()
  idMatchingMode: IdMatchingMode;
}

export const toGetPartnerIdMatchingModeDto = makeSerializer<GetPartnerIdMatchingModeDto>(
  GetPartnerIdMatchingModeDto
);

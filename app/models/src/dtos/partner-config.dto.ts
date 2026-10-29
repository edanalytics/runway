import { Expose, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsObject, ValidateNested } from 'class-validator';
import { IdMatchingMode } from '@prisma/client';
import { makeSerializer } from '../utils/make-serializer';

export class GetPartnerConfigDto {
  @Expose()
  crossYearMatchingEnabled: boolean;

  @Expose()
  idMatchingMode: IdMatchingMode;

  @Expose()
  canConnectToEdu: boolean;
}

export const toGetPartnerConfigDto = makeSerializer<GetPartnerConfigDto>(GetPartnerConfigDto);

export class PartnerConfigValuesDto {
  @IsBoolean()
  crossYearMatchingEnabled: boolean;

  @IsEnum(IdMatchingMode)
  idMatchingMode: IdMatchingMode;
}

export class PutPartnerConfigDto extends PartnerConfigValuesDto {
  /** The saved values the edit started from; the write is refused if they've since changed. */
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerConfigValuesDto)
  expected: PartnerConfigValuesDto;
}

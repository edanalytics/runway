import { Expose, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, ValidateNested } from 'class-validator';
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

// Spelled out rather than Prisma's runtime enum, which would pull @prisma/client into the frontend bundle.
const ID_MATCHING_MODES: IdMatchingMode[] = ['id_based', 'fuzzy', 'id_based_fuzzy_background'];

export class PartnerConfigValuesDto {
  @IsBoolean()
  crossYearMatchingEnabled: boolean;

  @IsIn(ID_MATCHING_MODES)
  idMatchingMode: IdMatchingMode;
}

export class PutPartnerConfigDto extends PartnerConfigValuesDto {
  /** The saved values the edit started from; the write is refused if they've since changed. */
  @IsObject()
  @ValidateNested()
  @Type(() => PartnerConfigValuesDto)
  expected: PartnerConfigValuesDto;
}

import { Expose } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { makeSerializer } from '../utils/make-serializer';

export class GetPartnerConfigDto {
  @Expose()
  crossYearMatchingEnabled: boolean;

  @Expose()
  eduCredsExist: boolean;
}

export const toGetPartnerConfigDto = makeSerializer<GetPartnerConfigDto>(GetPartnerConfigDto);

export class PutPartnerConfigDto {
  @IsBoolean()
  crossYearMatchingEnabled: boolean;
}

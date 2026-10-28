import { IsEnum } from 'class-validator';
import { IdMatchingMode } from '@prisma/client';

export class PutPartnerIdMatchingModeDto {
  @IsEnum(IdMatchingMode)
  idMatchingMode: IdMatchingMode;
}

import { Expose } from 'class-transformer';
import { IsBoolean, IsString } from 'class-validator';
import { makeSerializer } from '../utils/make-serializer';

// --- GET response ---

export class GetSchoolYearConfigDto {
  @Expose()
  schoolYearId: string;

  @Expose()
  startYear: number;

  @Expose()
  endYear: number;

  @Expose()
  isEnabled: boolean;

  @Expose()
  sendToOds: boolean;

  @Expose()
  hasOds: boolean;
}

export const toGetSchoolYearConfigDto = makeSerializer<GetSchoolYearConfigDto>(GetSchoolYearConfigDto);

// --- PUT request ---

export class PutSchoolYearConfigRowDto {
  @IsString()
  schoolYearId: string;

  @IsBoolean()
  isEnabled: boolean;

  @IsBoolean()
  sendToOds: boolean;
}

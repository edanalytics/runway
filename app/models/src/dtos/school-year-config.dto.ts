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
  odsCount: number;
}

export const toGetSchoolYearConfigDto = makeSerializer<GetSchoolYearConfigDto>(GetSchoolYearConfigDto);

export class GetTenantSchoolYearConfigDto {
  @Expose()
  schoolYearId: string;

  @Expose()
  startYear: number;

  @Expose()
  endYear: number;

  @Expose()
  sendToOds: boolean;

  @Expose()
  hasOds: boolean;

  // Null for ODS years (they use an ODS-fetched roster). For no-ODS years,
  // true when a roster is available — from an S3 file or, when cross-year
  // matching is enabled, from EDU.
  @Expose()
  hasNonOdsRoster: boolean | null;
}

export const toGetTenantSchoolYearConfigDto = makeSerializer<GetTenantSchoolYearConfigDto>(
  GetTenantSchoolYearConfigDto
);

// --- PUT request ---

export class PutSchoolYearConfigRowDto {
  @IsString()
  schoolYearId: string;

  @IsBoolean()
  isEnabled: boolean;

  @IsBoolean()
  sendToOds: boolean;
}

import { Expose, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { makeSerializer } from '../utils/make-serializer';

// --- GET response ---

export class GetSchoolYearConfigRowDto {
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

export class GetSchoolYearConfigDto {
  @Expose()
  partnerName: string;

  @Expose()
  lastModifiedOn: string | null;

  @Expose()
  @Type(() => GetSchoolYearConfigRowDto)
  rows: GetSchoolYearConfigRowDto[];
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

export class PutSchoolYearConfigDto {
  @IsOptional()
  @IsString()
  lastModifiedOn: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PutSchoolYearConfigRowDto)
  rows: PutSchoolYearConfigRowDto[];
}

import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils/make-serializer';
import { SchoolYear } from '@prisma/client';

export class GetSchoolYearDto implements SchoolYear {
  @Expose()
  id: string;

  @Expose()
  startYear: number;

  @Expose()
  endYear: number;

  get displayName() {
    return `${this.startYear} - ${this.endYear}`;
  }
}

export const toGetSchoolYearDto =
  makeSerializer<Omit<GetSchoolYearDto, 'displayName'>>(GetSchoolYearDto);

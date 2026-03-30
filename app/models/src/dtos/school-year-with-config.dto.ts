import { Expose } from 'class-transformer';
import { makeSerializer } from '../utils/make-serializer';

export class GetSchoolYearWithConfigDto {
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

  get displayName() {
    return `${this.startYear} - ${this.endYear}`;
  }
}

export const toGetSchoolYearWithConfigDto =
  makeSerializer<Omit<GetSchoolYearWithConfigDto, 'displayName'>>(GetSchoolYearWithConfigDto);

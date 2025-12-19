import { GetSchoolYearDto } from '@edanalytics/models';
import { EntityQueryBuilder } from './builder';

export const schoolYearQueries = new EntityQueryBuilder({ classNamePlural: 'SchoolYears' })
  .getAll({ ResDto: GetSchoolYearDto })
  .build();

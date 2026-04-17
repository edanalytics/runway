import { useQuery } from '@tanstack/react-query';
import { odsConfigQueries } from '../api';
import { tenantSchoolYearConfigQuery } from '../api/queries/school-year-config.queries';
import { GetSchoolYearDto } from '@edanalytics/models';

/**
 * Year options for ODS create/edit forms. Only enabled years with sendToOds=true
 * are included. Years that already have an ODS are disabled (except for the
 * current config's year in the edit case).
 */
export const useOdsYearOptions = (currentYearId?: GetSchoolYearDto['id']) => {
  const { data: yearConfigs } = useQuery(tenantSchoolYearConfigQuery);
  const { data: odsConfigs } = useQuery(odsConfigQueries.getAll({}));

  const odsYears = yearConfigs?.filter((y) => y.sendToOds) ?? [];
  const odsConfigYearIds = new Set(odsConfigs?.map((c) => c.schoolYearId) ?? []);

  const yearOptions = odsYears.map((y) => ({
    label: `${y.startYear} - ${y.endYear} school year`,
    value: y.schoolYearId,
  }));

  const isYearAvailable = (yearId: string) => {
    if (currentYearId && yearId === currentYearId) return true;
    return !odsConfigYearIds.has(yearId);
  };

  return { yearOptions, isYearAvailable };
};

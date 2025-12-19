import { useQuery } from '@tanstack/react-query';
import { odsConfigQueries, schoolYearQueries } from '../api';
import { keyBy } from 'lodash';
import { GetOdsConfigDto, GetSchoolYearDto } from '@edanalytics/models';
import { OdsConfig } from '@prisma/client';

export interface SchoolYearWithOds {
  year: GetSchoolYearDto;
  odsConfig: GetOdsConfigDto | undefined;
}

/**
 * We interact with school years in a handful of places in the app. Which
 * years we display and how we display them depends on whether there's an
 * associated ODS for the year. This hook helps us be consistent about that logic.
 */

// TODO: this hook is working around a confusion / infelicity in the data model.
// Rather than extend it, see if we can move towards a model that'll allow us to
// avoid this hook altogether.

export const useSchoolYears = () => {
  const { data: years, isLoading: yearsLoading } = useQuery(schoolYearQueries.getAll({}));
  const { data: odsConfigs, isLoading: odsConfigsLoading } = useQuery(odsConfigQueries.getAll({}));
  const odsConfigByYear = keyBy(odsConfigs, 'schoolYearId');
  years?.sort((a, b) => b.startYear - a.startYear);
  const mostRecentYear = years ? years[0] : undefined;
  const earliestYearWithConfig = [...(years ?? [])]
    .reverse()
    .find((year) => !!odsConfigByYear[year.id]);

  const yearWithOds = (year: GetSchoolYearDto): SchoolYearWithOds => ({
    year,
    odsConfig: odsConfigByYear[year.id] as GetOdsConfigDto | undefined,
  });

  const allYears = years?.map(yearWithOds);
  const yearsSinceFirstOds = allYears?.filter(
    ({ year }) =>
      mostRecentYear?.id === year.id ||
      (earliestYearWithConfig && year.startYear >= earliestYearWithConfig.startYear)
  );

  return {
    ready: !yearsLoading && !odsConfigsLoading,
    allYears,
    yearsSinceFirstOds,
    doesYearHaveOds: (yearId: GetSchoolYearDto['id']) => !!odsConfigByYear[yearId],
    odsConfigForYear: (yearId: GetSchoolYearDto['id']) => odsConfigByYear[yearId],
    yearForId: (yearId: GetSchoolYearDto['id']) =>
      allYears?.find(({ year }) => year.id === yearId)?.year,
    isYearSelectableForConfig: (configId?: OdsConfig['id']) => {
      const availableYearIds = allYears
        ?.filter(
          // current config's year remains available and any other years without a config
          ({ odsConfig }) => (configId && odsConfig?.id === configId) || odsConfig === undefined
        )
        .map(({ year }) => year.id);
      return (yearId: GetSchoolYearDto['id']) => availableYearIds?.includes(yearId) ?? false;
    },
  };
};

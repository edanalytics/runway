import { useQuery } from '@tanstack/react-query';
import { schoolYearWithConfigQueries } from '../api/queries/school-year-with-config.queries';

export const useSchoolYears = () => {
  const { data: years, isLoading } = useQuery(schoolYearWithConfigQueries);

  const mostRecentYear = years ? years[0] : undefined;
  const earliestYearWithOds = years ? [...years].reverse().find((y) => y.hasOds) : undefined;

  const yearsSinceFirstOds = years?.filter(
    (y) =>
      mostRecentYear?.schoolYearId === y.schoolYearId ||
      (earliestYearWithOds && y.startYear >= earliestYearWithOds.startYear)
  );

  return {
    ready: !isLoading,
    years,
    yearsSinceFirstOds,
    doesYearHaveOds: (yearId: string) => !!years?.find((y) => y.schoolYearId === yearId)?.hasOds,
    yearForId: (yearId: string) => years?.find((y) => y.schoolYearId === yearId),
  };
};

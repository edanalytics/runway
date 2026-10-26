import { hasSchoolYears, isInJobYear, StudentRosterDetailsJson } from '@edanalytics/models';

/**
 * Whether a roster student is in the job's school year: `in-year` when their
 * school years include the job's end year, `cross-year` when they don't,
 * which is a match delivered outside the ODS (the send run's `isCrossYear`),
 * and `unknown` when they have no valid school years, which submit refuses.
 */
export type CrossYear = 'in-year' | 'cross-year' | 'unknown';

export const crossYearOf = (
  rosterDetails: StudentRosterDetailsJson | null | undefined,
  endYear: number
): CrossYear => {
  if (!hasSchoolYears(rosterDetails)) return 'unknown';
  return isInJobYear(rosterDetails, endYear) ? 'in-year' : 'cross-year';
};

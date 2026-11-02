import { hasSchoolYears, isInJobYear, StudentRosterDetailsJson } from '@edanalytics/models';

/**
 * Whether a job could load a student IDRS found. With cross-year matching on, it can load any of
 * them, since one outside the job's school year is a cross-year match. With it off, it can load
 * only students in the job's year, so none whose school years are malformed.
 *
 * The Executor's suggestion filter must apply the same rule. A match an ODS job
 * keeps only through cross-year matching must never be sent to the ODS.
 */
export const isLoadableStudent = (
  student: StudentRosterDetailsJson,
  endYear: number,
  crossYearMatchingEnabled: boolean
) => crossYearMatchingEnabled || (hasSchoolYears(student) && isInJobYear(student, endYear));

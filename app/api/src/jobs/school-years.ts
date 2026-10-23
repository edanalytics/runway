import { StudentRosterDetailsJson } from '@edanalytics/models';

/** Roster details whose school years `hasSchoolYears` has checked. */
export type StudentRosterDetailsWithSchoolYears = StudentRosterDetailsJson & {
  school_years: number[];
};

/**
 * IDRS guarantees a student's school years, but roster details reach a match from IDRS through
 * the Executor, from a reviewer's search or from a client, and are stored as sent. Submit checks
 * them with this before anything relies on them.
 */
export const hasSchoolYears = (
  rosterDetails: StudentRosterDetailsJson | null | undefined
): rosterDetails is StudentRosterDetailsWithSchoolYears => {
  const schoolYears = rosterDetails?.school_years;
  return Array.isArray(schoolYears) && schoolYears.every(Number.isInteger);
};

/**
 * Whether the student is in the job's school year, by end year (2025 for 2024–25). A match
 * outside it is a cross-year match, which is delivered outside the ODS.
 */
export const isInJobYear = (
  rosterDetails: StudentRosterDetailsWithSchoolYears,
  endYear: number
): boolean => rosterDetails.school_years.includes(endYear);

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

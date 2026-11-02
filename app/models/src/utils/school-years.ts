import type { StudentRosterDetailsJson } from '../dtos/earthbeam-api.dto';

/** Roster details whose school years `hasSchoolYears` has checked. */
export type StudentRosterDetailsWithSchoolYears = StudentRosterDetailsJson & {
  school_years: number[];
};

/**
 * IDRS guarantees a student's school years, but roster details reach a match from IDRS through
 * the Executor, from a reviewer's search or from a client, and are stored as sent. Check them
 * with this before anything relies on them.
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

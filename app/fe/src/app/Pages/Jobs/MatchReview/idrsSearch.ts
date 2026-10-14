import {
  GetStudentSearchResultsDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
  StudentSearchDetailsDto,
} from '@edanalytics/models';
import { methods } from '../../../api/methods';
import { compare } from './compare';

/*
 * Searching IDRS for one of a job's students, through the app's search
 * endpoint. The terms are what the reviewer typed; the details are what's
 * sent, and what's stored with a hit if the reviewer saves a match to it.
 */

export type RosterStudent = { studentUniqueId: string; rosterDetails: StudentRosterDetailsJson };

export type SearchTerms = {
  first_name: string;
  last_name: string;
  birth_date: string;
  /** Any IDs the reviewer has, separated by commas or spaces. */
  student_ids: string;
};

/** A hit, with the details it was found with, so a match to it can be saved. */
export type SearchHit = RosterStudent & { score: number; searchDetails: StudentSearchDetailsDto };

/** What a search sends: blank fields left out, IDs split. */
export const toSearchDetails = (terms: SearchTerms): StudentSearchDetailsDto => {
  const ids = terms.student_ids
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    ...(terms.first_name.trim() && { first_name: terms.first_name.trim() }),
    ...(terms.last_name.trim() && { last_name: terms.last_name.trim() }),
    ...(terms.birth_date.trim() && { birth_date: terms.birth_date.trim() }),
    ...(ids.length && { student_ids: ids }),
  };
};

/** Whether there's anything to search on: a search with nothing would find no one useful. */
export const canSearch = (terms: SearchTerms) => Object.keys(toSearchDetails(terms)).length > 0;

/** IDRS's hits for one of the job's students, best first. Throws the API's error body. */
export const searchIdrs = async (
  jobId: number,
  correlationId: string,
  searchDetails: StudentSearchDetailsDto
): Promise<SearchHit[]> => {
  const { hits } = await methods.post(
    `/jobs/${jobId}/student-match-results/${encodeURIComponent(correlationId)}/search`,
    StudentSearchDetailsDto,
    GetStudentSearchResultsDto,
    searchDetails
  );
  return hits.map(({ studentUniqueId, score, rosterDetails }) => ({
    studentUniqueId,
    score,
    rosterDetails,
    searchDetails,
  }));
};

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Search terms pre-filled from the file's details. */
export const termsFrom = (file: StudentInputDetailsJson): SearchTerms => ({
  first_name: text(file.first_name) ?? '',
  last_name: text(file.last_name) ?? '',
  birth_date: text(file.birth_date) ?? '',
  student_ids: Array.isArray(file.student_ids) ? file.student_ids.map(String).join(', ') : '',
});

// Re-exported so search results are judged against the file, like suggestions.
export { compare };

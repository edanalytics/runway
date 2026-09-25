import {
  GetStudentInputDetailsDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { compare, compareDates, compareNames } from './compare';

/*
 * PROTOTYPE ONLY. A pretend roster and a pretend identity search, so the
 * review designs can show searching without a real IDRS call. The roster is
 * every student the job's suggestions mention, plus a few invented ones so
 * students IDRS found nothing for have someone to find.
 */

export type RosterStudent = { studentUniqueId: string; rosterDetails: StudentRosterDetailsJson };

const invented: RosterStudent[] = [
  {
    studentUniqueId: 'S-7001',
    rosterDetails: {
      first_name: 'Alan',
      middle_name: 'Mathison',
      last_name: 'Turing',
      birth_date: '2012-06-23',
      student_ids: [{ id_type: 'state', id_value: 'S-7001' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: 'S-7004',
    rosterDetails: {
      first_name: 'Alan',
      middle_name: null,
      last_name: 'Turner',
      birth_date: '2012-06-03',
      student_ids: [{ id_type: 'state', id_value: 'S-7004' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: 'S-7002',
    rosterDetails: {
      first_name: 'Mae',
      middle_name: 'Carol',
      last_name: 'Jemison',
      birth_date: '2012-10-17',
      student_ids: [{ id_type: 'state', id_value: 'S-7002' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: 'S-7003',
    rosterDetails: {
      first_name: 'Mae',
      middle_name: null,
      last_name: 'Jennings',
      birth_date: '2012-10-07',
      student_ids: [{ id_type: 'state', id_value: 'S-7003' }],
      school_years: [2025],
    },
  },
];

export const pretendRoster = (groups: GetStudentInputDetailsDto[]): RosterStudent[] => {
  const byId = new Map<string, RosterStudent>();
  for (const group of groups) {
    for (const result of group.results) {
      for (const suggestion of result.suggestions) {
        byId.set(suggestion.studentUniqueId, {
          studentUniqueId: suggestion.studentUniqueId,
          rosterDetails: suggestion.rosterDetails,
        });
      }
    }
  }
  for (const student of invented) {
    byId.set(student.studentUniqueId, student);
  }
  return [...byId.values()];
};

export type SearchTerms = {
  first_name: string;
  last_name: string;
  birth_date: string;
  student_unique_id: string;
};

export type SearchHit = RosterStudent & { score: number };

/**
 * A student unique ID narrows the search to that one student. Otherwise,
 * anyone whose name and date of birth come close enough, best first.
 */
export const searchRoster = async (
  roster: RosterStudent[],
  terms: SearchTerms
): Promise<SearchHit[]> => {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const id = terms.student_unique_id.trim().toLowerCase();
  if (id) {
    return roster
      .filter((student) => student.studentUniqueId.toLowerCase() === id)
      .map((student) => ({ ...student, score: 1 }));
  }
  const weight = { same: 1, close: 0.6, different: 0, unknown: 0 };
  return roster
    .map((student) => {
      const first = compareNames(terms.first_name || null, text(student.rosterDetails.first_name));
      const last = compareNames(terms.last_name || null, text(student.rosterDetails.last_name));
      const dob = compareDates(terms.birth_date || null, text(student.rosterDetails.birth_date));
      const score = (weight[first] + weight[last] * 1.2 + weight[dob]) / 3.2;
      return { ...student, score: Math.round(score * 100) / 100 };
    })
    .filter((hit) => hit.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Search terms pre-filled from the file's details. */
export const termsFrom = (file: StudentInputDetailsJson): SearchTerms => ({
  first_name: text(file.first_name) ?? '',
  last_name: text(file.last_name) ?? '',
  birth_date: text(file.birth_date) ?? '',
  student_unique_id: '',
});

// Re-exported so search results are judged against the file, like suggestions.
export { compare };

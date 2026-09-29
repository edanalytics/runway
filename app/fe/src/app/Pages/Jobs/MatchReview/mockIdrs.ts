import {
  GetStudentInputDetailsDto,
  StudentInputDetailsJson,
  StudentRosterDetailsJson,
} from '@edanalytics/models';
import { compare } from './compare';

/*
 * PROTOTYPE ONLY. A pretend roster and a pretend identity search, so the
 * review designs can show searching without a real IDRS call. The roster is
 * every student the job's suggestions mention, plus a few invented ones so
 * students IDRS found nothing for have someone to find.
 */

export type RosterStudent = { studentUniqueId: string; rosterDetails: StudentRosterDetailsJson };

const invented: RosterStudent[] = [
  {
    studentUniqueId: '107001',
    rosterDetails: {
      first_name: 'Alan',
      middle_name: 'Mathison',
      last_name: 'Turing',
      birth_date: '2012-06-23',
      student_ids: [{ id_type: 'state', id_value: '107001' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: '107004',
    rosterDetails: {
      first_name: 'Alan',
      middle_name: null,
      last_name: 'Turner',
      birth_date: '2012-06-03',
      student_ids: [{ id_type: 'state', id_value: '107004' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: '107002',
    rosterDetails: {
      first_name: 'Mae',
      middle_name: 'Carol',
      last_name: 'Jemison',
      birth_date: '2012-10-17',
      student_ids: [{ id_type: 'state', id_value: '107002' }],
      school_years: [2025],
    },
  },
  {
    studentUniqueId: '107003',
    rosterDetails: {
      first_name: 'Mae',
      middle_name: null,
      last_name: 'Jennings',
      birth_date: '2012-10-07',
      student_ids: [{ id_type: 'state', id_value: '107003' }],
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
  /** Any IDs the reviewer has, separated by commas or spaces. */
  student_ids: string;
};

export type SearchHit = RosterStudent & { score: number };

/** Every ID the roster has for a student: their unique ID and any others. */
const idsOf = (student: RosterStudent) => [
  student.studentUniqueId,
  ...(Array.isArray(student.rosterDetails.student_ids)
    ? student.rosterDetails.student_ids.map((id) =>
        id && typeof id === 'object' && !Array.isArray(id) && 'id_value' in id
          ? String(id.id_value)
          : String(id)
      )
    : []),
];

/**
 * Like the identity service, takes any IDs alongside the details. A student
 * with one of those IDs comes first; others follow if their name and date
 * of birth come close enough, best first.
 */
export const searchRoster = async (
  roster: RosterStudent[],
  terms: SearchTerms
): Promise<SearchHit[]> => {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const wanted = terms.student_ids
    .split(/[\s,]+/)
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const byId = roster
    .filter((student) => idsOf(student).some((id) => wanted.includes(id.toLowerCase())))
    .map((student) => ({ ...student, score: 1 }));
  const weight = { same: 1, close: 0.6, different: 0, unknown: 0 };
  const byDetails = roster
    .filter((student) => !byId.some((hit) => hit.studentUniqueId === student.studentUniqueId))
    .map((student) => {
      const first = compareNames(terms.first_name || null, text(student.rosterDetails.first_name));
      const last = compareNames(terms.last_name || null, text(student.rosterDetails.last_name));
      const dob = compareDates(terms.birth_date || null, text(student.rosterDetails.birth_date));
      const score = (weight[first] + weight[last] * 1.2 + weight[dob]) / 3.2;
      return { ...student, score: Math.round(score * 100) / 100 };
    })
    .filter((hit) => hit.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  return [...byId, ...byDetails].slice(0, 5);
};

// A crude stand-in for IDRS's own scoring: what counts as close is the
// matching service's call, so this lives with the mock, not the UI.
type Closeness = 'same' | 'close' | 'different' | 'unknown';

const distance = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

const letters = (value: string) =>
  value
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const compareNames = (a: string | null, b: string | null): Closeness => {
  if (!a || !b) return 'unknown';
  const [x, y] = [letters(a), letters(b)];
  if (x === y) return 'same';
  const prefix = Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x));
  return prefix || distance(x, y) <= 2 ? 'close' : 'different';
};

const compareDates = (a: string | null, b: string | null): Closeness => {
  if (!a || !b) return 'unknown';
  if (a === b) return 'same';
  return distance(a, b) <= 2 ? 'close' : 'different';
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

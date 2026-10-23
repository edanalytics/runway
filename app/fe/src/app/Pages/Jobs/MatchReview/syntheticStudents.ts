import { GetStudentInputDetailsDto, StudentRosterDetailsJson } from '@edanalytics/models';

/*
 * PROTOTYPE ONLY. A large job's worth of made-up unmatched students, so
 * navigating hundreds of records can be tried without seeding the database.
 * Generated deterministically, so the same students (and correlation IDs)
 * come back on every load and saved decisions stay attached.
 */

const firstNames = [
  'Amara',
  'Ben',
  'Carmen',
  'Dmitri',
  'Elena',
  'Farah',
  'Gabriel',
  'Hana',
  'Isaac',
  'Jada',
  'Kenji',
  'Lucia',
  'Malik',
  'Nora',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Samuel',
  'Tariq',
  'Uma',
  'Victor',
  'Wren',
  'Xavier',
  'Yara',
  'Zane',
];
const lastNames = [
  'Abbott',
  'Baptiste',
  'Castillo',
  'Delgado',
  'Eriksen',
  'Fontaine',
  'Guerrero',
  'Hartley',
  'Ibarra',
  'Jansen',
  'Kowalski',
  'Lindqvist',
  'Moreau',
  'Nakamura',
  'Okafor',
  'Petrov',
  'Quintero',
  'Rahman',
  'Sandoval',
  'Takahashi',
  'Underwood',
  'Vasquez',
  'Whitaker',
  'Yilmaz',
];

// A small deterministic generator, so every load produces the same students.
const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A near miss of the file record: one or two fields nudged. */
const nearMiss = (
  next: () => number,
  first: string,
  last: string,
  birth: string,
  id: number
): StudentRosterDetailsJson => {
  const [y, m, d] = birth.split('-').map(Number);
  const variants = [
    () => ({ first_name: first.slice(0, -1) || first, last_name: last, birth_date: birth }),
    () => ({
      first_name: first,
      last_name: `${last}-${lastNames[id % lastNames.length]}`,
      birth_date: birth,
    }),
    () => ({
      first_name: first,
      last_name: last,
      birth_date: `${y}-${pad(d <= 12 ? d : m)}-${pad(d <= 12 ? m : d)}`,
    }),
    () => ({ first_name: first, last_name: last, birth_date: `${y - 1}-${pad(m)}-${pad(d)}` }),
    () => ({ first_name: first, last_name: last.slice(0, -1), birth_date: birth }),
  ];
  const base = variants[Math.floor(next() * variants.length)]();
  return {
    ...base,
    middle_name: next() < 0.3 ? firstNames[id % firstNames.length] : null,
    student_ids: [{ id_type: 'state', id_value: `${900000 + id}` }],
    school_years: next() < 0.9 ? [2025] : [2024],
  };
};

export const syntheticStudents = (count: number, runId: number): GetStudentInputDetailsDto[] => {
  const next = random(20260925);
  const createdOn = new Date('2026-09-24T20:23:01Z');
  let rosterId = 0;
  return Array.from({ length: count }, (_, i) => {
    const first = firstNames[Math.floor(next() * firstNames.length)];
    const last = lastNames[Math.floor(next() * lastNames.length)];
    const birth = `${2011 + Math.floor(next() * 3)}-${pad(1 + Math.floor(next() * 12))}-${pad(
      1 + Math.floor(next() * 28)
    )}`;
    // Mostly one or two suggestions, some none, a few several.
    const roll = next();
    const suggestionCount =
      roll < 0.2 ? 0 : roll < 0.55 ? 1 : roll < 0.85 ? 2 : roll < 0.95 ? 3 : 4;
    const suggestions = Array.from({ length: suggestionCount }, (_, ordinal) => {
      rosterId += 1;
      return {
        ordinal,
        studentUniqueId: `${900000 + rosterId}`,
        score: Math.round((0.88 - ordinal * 0.07 - next() * 0.1) * 100) / 100,
        rosterDetails: nearMiss(next, first, last, birth, rosterId),
      };
    });
    // Hex, like the Executor's MD5 correlation IDs, and never clashing with them.
    const correlationId = `e${(i + 1).toString(16).padStart(31, '0')}`;
    return {
      correlationId,
      sourceRunId: runId,
      createdOn,
      inputDetails: {
        first_name: first,
        last_name: last,
        birth_date: birth,
        student_ids: [String(5000 + i)],
        school_ids: [1234],
      },
      results: [{ id: `synthetic-${i}`, runId, createdOn, suggestions }],
    } as GetStudentInputDetailsDto;
  });
};

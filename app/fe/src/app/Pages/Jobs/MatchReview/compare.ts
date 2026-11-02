import { JsonValue, StudentInputDetailsJson, StudentRosterDetailsJson } from '@edanalytics/models';

/*
 * How a file record and a roster student compare, field by field. This is the
 * evidence a reviewer decides on, so each field gets a plain verdict rather
 * than leaving the reviewer to line up two strings by eye.
 */

export type Agreement = 'same' | 'different' | 'unknown';

/**
 * The fields compared. Not IDs: the file's and the roster's come from
 * different identifier systems, so equal strings aren't evidence either way.
 */
const comparedFields = ['first_name', 'last_name', 'birth_date'] as const;

export type ComparedField = (typeof comparedFields)[number];

export const isComparedField = (field: string): field is ComparedField =>
  (comparedFields as readonly string[]).includes(field);

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
    ? String(value)
    : null;

/**
 * Exact equality only, ignoring case and surrounding whitespace. Whether two
 * values are close enough to be the same student is IDRS's call, not ours.
 */
const compareText = (a: string | null, b: string | null): Agreement => {
  if (!a || !b) return 'unknown';
  return a.toLowerCase() === b.toLowerCase() ? 'same' : 'different';
};

/** How the file and the roster agree on each compared field. */
export const compare = (
  file: StudentInputDetailsJson,
  roster: StudentRosterDetailsJson
): Record<ComparedField, Agreement> => ({
  first_name: compareText(text(file.first_name), text(roster.first_name)),
  last_name: compareText(text(file.last_name), text(roster.last_name)),
  birth_date: compareText(text(file.birth_date), text(roster.birth_date)),
});

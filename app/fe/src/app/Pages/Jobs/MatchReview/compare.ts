import { JsonValue, StudentInputDetailsJson, StudentRosterDetailsJson } from '@edanalytics/models';

/*
 * How a file record and a roster student compare, field by field. This is the
 * evidence a reviewer decides on, so each field gets a plain verdict rather
 * than leaving the reviewer to line up two strings by eye.
 */

export type Agreement = 'same' | 'different' | 'unknown';

export type ComparedField = {
  label: string;
  file: string | null;
  roster: string | null;
  agreement: Agreement;
};

export type Comparison = {
  fields: ComparedField[];
  summary: string;
};

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
    ? String(value)
    : null;

/** IDs as written, with their type when the roster gives one: "state S-4102". */
const idsOf = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    const single = text(value);
    return single ? [single] : [];
  }
  return value
    .map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry) && 'id_value' in entry
        ? [text(entry.id_type), text(entry.id_value)].filter(Boolean).join(' ') || null
        : text(entry)
    )
    .filter((id): id is string => id !== null);
};

/**
 * Exact equality only, ignoring case and surrounding whitespace. Whether two
 * values are close enough to be the same student is IDRS's call, not ours.
 */
const compareText = (a: string | null, b: string | null): Agreement => {
  if (!a || !b) return 'unknown';
  return a.toLowerCase() === b.toLowerCase() ? 'same' : 'different';
};

export const compare = (
  file: StudentInputDetailsJson,
  roster: StudentRosterDetailsJson
): Comparison => {
  const fileIds = idsOf(file.student_ids);
  const rosterIds = idsOf(roster.student_ids);
  const fields: ComparedField[] = [
    {
      label: 'First name',
      file: text(file.first_name),
      roster: text(roster.first_name),
      agreement: compareText(text(file.first_name), text(roster.first_name)),
    },
    {
      label: 'Last name',
      file: text(file.last_name),
      roster: text(roster.last_name),
      agreement: compareText(text(file.last_name), text(roster.last_name)),
    },
    {
      label: 'Date of birth',
      file: text(file.birth_date),
      roster: text(roster.birth_date),
      agreement: compareText(text(file.birth_date), text(roster.birth_date)),
    },
    {
      label: 'Student IDs',
      file: fileIds.join(', ') || null,
      roster: rosterIds.join(', ') || null,
      // The file's IDs and the roster's come from different identifier
      // systems, so equal strings aren't evidence either way.
      agreement: 'unknown',
    },
  ];
  return { fields, summary: summarize(fields) };
};

const list = (labels: string[]) =>
  labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;

/** "Last name and date of birth match; first name differs." */
const summarize = (fields: ComparedField[]) => {
  const named = (agreement: Agreement) =>
    fields
      .filter((field) => field.agreement === agreement)
      .map((field) => field.label.toLowerCase());
  const same = named('same');
  const different = named('different');
  const parts = [
    same.length && `${list(same)} ${same.length === 1 ? 'matches' : 'match'}`,
    different.length && `${list(different)} ${different.length === 1 ? 'differs' : 'differ'}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return 'Not enough details to compare.';
  const sentence = parts.join('; ');
  return `${capitalize(sentence)}.`;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

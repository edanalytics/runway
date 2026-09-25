import { JsonValue, StudentInputDetailsJson, StudentRosterDetailsJson } from '@edanalytics/models';

/*
 * How a file record and a roster student compare, field by field. This is the
 * evidence a reviewer decides on, so each field gets a plain verdict rather
 * than leaving the reviewer to line up two strings by eye.
 */

export type Agreement = 'same' | 'close' | 'different' | 'unknown';

export type ComparedField = {
  label: string;
  file: string | null;
  roster: string | null;
  agreement: Agreement;
};

export type Strength = 'strong' | 'possible' | 'weak';

export type Comparison = {
  fields: ComparedField[];
  strength: Strength;
  summary: string;
};

const text = (value: JsonValue | undefined): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
    ? String(value)
    : null;

const idsOf = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    const single = text(value);
    return single ? [single] : [];
  }
  return value
    .map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry) && 'id_value' in entry
        ? text(entry.id_value)
        : text(entry)
    )
    .filter((id): id is string => id !== null);
};

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

const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

export const compareNames = (a: string | null, b: string | null): Agreement => {
  if (!a || !b) return 'unknown';
  const [x, y] = [letters(a), letters(b)];
  if (x === y) return 'same';
  const prefix = Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x));
  return prefix || distance(x, y) <= 2 ? 'close' : 'different';
};

const asDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

export const compareDates = (a: string | null, b: string | null): Agreement => {
  if (!a || !b) return 'unknown';
  if (a === b) return 'same';
  // Transposed digits, like 2012-12-01 for 2012-12-10.
  const transposed = [...a].sort().join('') === [...b].sort().join('') && distance(a, b) <= 2;
  const [x, y] = [asDate(a), asDate(b)];
  const nearby = x && y && Math.abs(x.getTime() - y.getTime()) <= 7 * 24 * 60 * 60 * 1000;
  return transposed || nearby ? 'close' : 'different';
};

/**
 * Only evidence for a match: the file's local IDs and the roster's state IDs
 * usually come from different systems, so no shared ID says nothing.
 */
const compareIds = (file: string[], roster: string[]): Agreement =>
  file.some((id) => roster.some((other) => other.toLowerCase() === id.toLowerCase()))
    ? 'same'
    : 'unknown';

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
      agreement: compareNames(text(file.first_name), text(roster.first_name)),
    },
    {
      label: 'Last name',
      file: text(file.last_name),
      roster: text(roster.last_name),
      agreement: compareNames(text(file.last_name), text(roster.last_name)),
    },
    {
      label: 'Date of birth',
      file: text(file.birth_date),
      roster: text(roster.birth_date),
      agreement: compareDates(text(file.birth_date), text(roster.birth_date)),
    },
    {
      label: 'Student IDs',
      file: fileIds.join(', ') || null,
      roster: rosterIds.join(', ') || null,
      agreement: compareIds(fileIds, rosterIds),
    },
  ];
  const [first, last, dob, ids] = fields.map((field) => field.agreement);
  const agreeing = [first, last, dob].filter((a) => a === 'same' || a === 'close').length;
  const strength: Strength =
    ids === 'same' || (last === 'same' && dob === 'same' && (first === 'same' || first === 'close'))
      ? 'strong'
      : agreeing >= 2
      ? 'possible'
      : 'weak';
  return { fields, strength, summary: summarize(fields) };
};

const list = (labels: string[]) =>
  labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;

/** "Last name and date of birth match; first name is close." */
const summarize = (fields: ComparedField[]) => {
  const named = (agreement: Agreement) =>
    fields
      .filter((field) => field.agreement === agreement)
      .map((field) => (field.label === 'Student IDs' ? 'a student ID' : field.label.toLowerCase()));
  const same = named('same');
  const close = named('close');
  const different = named('different');
  const parts = [
    same.length && `${list(same)} ${same.length === 1 ? 'matches' : 'match'}`,
    close.length && `${list(close)} ${close.length === 1 ? 'is' : 'are'} close`,
    different.length && `${list(different)} ${different.length === 1 ? 'differs' : 'differ'}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return 'Not enough details to compare.';
  const sentence = parts.join('; ');
  return `${capitalize(sentence)}.`;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const strengthLabel: Record<Strength, string> = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match',
};

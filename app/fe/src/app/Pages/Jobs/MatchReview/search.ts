import { StudentInputDetailsJson, StudentSearchDetailsDto } from '@edanalytics/models';
import { valueText } from './values';

/** The search form's fields, as typed. */
export type SearchTerms = {
  first_name: string;
  last_name: string;
  birth_date: string;
  /** Any IDs the reviewer has, separated by commas or spaces. */
  student_ids: string;
};

/** Search terms pre-filled from the file's details. */
export const termsFrom = (file: StudentInputDetailsJson): SearchTerms => ({
  first_name: valueText(file.first_name) ?? '',
  last_name: valueText(file.last_name) ?? '',
  birth_date: valueText(file.birth_date) ?? '',
  student_ids: Array.isArray(file.student_ids)
    ? [...new Set(file.student_ids.map(String))].join(', ')
    : '',
});

/** The search route's body: IDRS's input, with blank fields left out. */
export const searchDetailsFrom = (terms: SearchTerms): StudentSearchDetailsDto => {
  const ids = [
    ...new Set(
      terms.student_ids
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  return {
    first_name: terms.first_name.trim() || null,
    last_name: terms.last_name.trim() || null,
    birth_date: terms.birth_date.trim() || null,
    student_ids: ids.length ? ids : null,
  };
};

/**
 * The fields where two sets of terms send IDRS different searches, ignoring
 * spacing and the order and repeats of IDs.
 */
export const changedFields = (a: SearchTerms, b: SearchTerms): (keyof SearchTerms)[] => {
  const sent = (terms: SearchTerms) => {
    const details = searchDetailsFrom(terms);
    return { ...details, student_ids: details.student_ids?.slice().sort().join(' ') ?? null };
  };
  const [sentA, sentB] = [sent(a), sent(b)];
  return (Object.keys(a) as (keyof SearchTerms)[]).filter((key) => sentA[key] !== sentB[key]);
};

export const isSameSearch = (a: SearchTerms, b: SearchTerms) => changedFields(a, b).length === 0;

/** Whether a date is a real YYYY-MM-DD date, the only form the search route takes. */
export const realDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/**
 * Why the terms can't be searched, or null when they can. A search mustn't
 * repeat what the reviewer already has: the file's values, which IDRS
 * searched for the suggestions (with the file's school IDs, which the form
 * leaves out), or the search whose results are shown.
 */
export const searchBlock = (
  terms: SearchTerms,
  fileTerms: SearchTerms,
  shownTerms: SearchTerms | null
): 'bad-date' | 'file' | 'shown' | null => {
  const birthDate = terms.birth_date.trim();
  if (birthDate && !realDate(birthDate)) return 'bad-date';
  if (isSameSearch(terms, fileTerms)) return 'file';
  if (shownTerms && isSameSearch(terms, shownTerms)) return 'shown';
  return null;
};

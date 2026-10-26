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
  student_ids: Array.isArray(file.student_ids) ? file.student_ids.map(String).join(', ') : '',
});

/** The search route's body: IDRS's input, with blank fields left out. */
export const searchDetailsFrom = (terms: SearchTerms): StudentSearchDetailsDto => {
  const ids = terms.student_ids
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    first_name: terms.first_name.trim() || null,
    last_name: terms.last_name.trim() || null,
    birth_date: terms.birth_date.trim() || null,
    student_ids: ids.length ? ids : null,
  };
};

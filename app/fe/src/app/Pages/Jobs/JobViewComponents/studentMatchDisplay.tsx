import { Box } from '@chakra-ui/react';
import { GetStudentInputDetailsDto, JsonValue } from '@edanalytics/models';
import { runwayTableSx } from '../../../components/Table/RunwayStdTable';

/** Known fields first, in this order; anything else IDRS sends follows. */
export const FIELDS: Record<string, string> = {
  first_name: 'First name',
  middle_name: 'Middle name',
  last_name: 'Last name',
  birth_date: 'Date of birth',
  student_ids: 'Student IDs',
  school_ids: 'School IDs',
  school_years: 'School years',
};

/** The fields present in any of the given details, known ones first. */
export const fieldsIn = (details: Record<string, unknown>[]) => {
  const sent = new Set(details.flatMap((detail) => Object.keys(detail)));
  return [
    ...Object.keys(FIELDS).filter((field) => sent.has(field)),
    ...[...sent].filter((field) => !(field in FIELDS)).sort(),
  ];
};

/** A stored detail as text, or null when it's missing or empty. */
export const format = (value: JsonValue | undefined): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (Array.isArray(value)) {
    const items = value.map(format).filter((item) => item !== null);
    return items.length ? items.join(', ') : null;
  }
  if (typeof value === 'object') {
    // Roster student ids arrive as { id_type, id_value }.
    if ('id_value' in value) {
      return value.id_type ? `${value.id_type}: ${value.id_value}` : String(value.id_value);
    }
    return JSON.stringify(value);
  }
  return String(value);
};

/** Stands in for a missing or empty value. */
export const Missing = () => (
  <Box as="span" opacity="0.5">
    —
  </Box>
);

/** One field of stored details, formatted, or a dash when missing. */
export const Detail = ({ details, field }: { details: object; field: string }) => {
  const value = format((details as Record<string, JsonValue | undefined>)[field]);
  return value !== null ? <Box as="span">{value}</Box> : <Missing />;
};

/** Every suggestion for a group of input details, across its results. */
export const suggestionsOf = (group: GetStudentInputDetailsDto) =>
  group.results.flatMap((result) =>
    result.suggestions.map((suggestion) => ({
      ...suggestion,
      key: `${result.id}-${suggestion.ordinal}`,
    }))
  );

// The shared table highlights rows on hover. Rows marked data-no-hover, and
// any table nested inside them, aren't rows to pick, so they don't.
export const tableSx = {
  ...runwayTableSx,
  'tbody tr[data-no-hover]:hover, tbody tr[data-no-hover] tr:hover': {
    bg: 'transparent',
  },
};

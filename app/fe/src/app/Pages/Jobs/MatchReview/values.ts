import { JsonValue } from '@edanalytics/models';

/**
 * A detail from a file record or a roster student as text, or null when
 * there's nothing to show. ID lists read as "type value".
 */
export const valueText = (value: JsonValue | undefined): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value
      .map((v) =>
        v && typeof v === 'object' && !Array.isArray(v) && 'id_value' in v
          ? [v.id_type, v.id_value].filter(Boolean).join(' ')
          : valueText(v)
      )
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

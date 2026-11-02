export const NOTE_CHAR_LIMIT = 5000;

/** The largest PostgreSQL INTEGER (int4). Past it, a cast to int fails with a 500. */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Far more students to match than a reviewer will work through (typically
 * under 10, at most a few hundred). Past it, the file itself needs fixing. At
 * the limit, with ten suggestions each, the review read's response is about
 * 3.5 MB.
 */
export const MATCH_REVIEW_STUDENT_LIMIT = 1000;

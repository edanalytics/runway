import type {
  StudentInputDetailsJson as InputDetails,
  StudentRosterDetailsJson as RosterDetails,
} from '../dtos/earthbeam-api.dto';
import type { JobInputParamDto } from '../dtos/job.dto';

/*

These came from Prisma. Prisma returns JSON columns as `JsonValue`, so we are
forced to accept loose types and validate alignment between the database and app
code manually.

*/

/**
 * From https://github.com/sindresorhus/type-fest/
 * Matches a JSON object.
 * This type can be useful to enforce some input to be JSON-compatible or as a super-type to be extended from.
 */
export type JsonObject = { [Key in string]?: JsonValue };

/**
 * From https://github.com/sindresorhus/type-fest/
 * Matches a JSON array.
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * From https://github.com/sindresorhus/type-fest/
 * Matches any valid JSON value.
 */
export type JsonValue = string | number | boolean | JsonObject | JsonArray | null;

/**
 * Types for the JSON columns annotated in schema.prisma (`/// [TypeName]`),
 * applied to the generated client by prisma-json-types-generator. Declared here
 * rather than in the API so every program that reads Prisma types through
 * `@edanalytics/models` sees them, the frontend included.
 */
declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    type UnmatchedStudentsInfo = { name: string; type: string; count?: number } | null;
    // Use JobInputParamDto as the element type - Prisma JSON stores plain objects matching this shape
    type JobInputParams = JobInputParamDto[];
    type RunOutputFileSetFiles = string[];
    // The lightbeam run summary, stored as the executor posts it
    type RunSummary = JsonValue;
    type StudentInputDetailsJson = InputDetails;
    type StudentRosterDetailsJson = RosterDetails;
  }
}

import type { GetJobTemplateDto, JobInputParamDto } from '@edanalytics/models';
import type {
  StudentInputDetailsJson as InputDetails,
  StudentRosterDetailsJson as RosterDetails,
} from '@edanalytics/models';

declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    type UnmatchedStudentsInfo = { name: string; type: string; count?: number } | null;
    // Use JobInputParamDto as the element type - Prisma JSON stores plain objects matching this shape
    type JobInputParams = JobInputParamDto[];
    // The DTO as stored. It has only plain fields, so its type fits the JSON;
    // a getter or method added to it would not be in the stored JSON.
    type JobTemplate = GetJobTemplateDto;
    type RunOutputFileSetFiles = string[];
    type StudentInputDetailsJson = InputDetails;
    type StudentRosterDetailsJson = RosterDetails;
  }
}

export {};

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
    // Stored as instanceToPlain of the DTO, which has no getters, so the shape matches
    type JobTemplate = GetJobTemplateDto;
    type RunOutputFileSetFiles = string[];
    type StudentInputDetailsJson = InputDetails;
    type StudentRosterDetailsJson = RosterDetails;
  }
}

export {};

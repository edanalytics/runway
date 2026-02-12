import type { JobInputParamDto } from '@edanalytics/runway-models';

declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    type UnmatchedStudentsInfo = { name: string; type: string; count?: number } | null;
    // Use JobInputParamDto as the element type - Prisma JSON stores plain objects matching this shape
    type JobInputParams = JobInputParamDto[];
  }
}
    
export {};
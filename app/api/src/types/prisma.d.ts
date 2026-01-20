import type { JobInputParamDto } from '@edanalytics/runway-models';

declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    // Use JobInputParamDto as the element type - Prisma JSON stores plain objects matching this shape
    type JobInputParams = JobInputParamDto[];
  }
}

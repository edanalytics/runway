declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    type RunSummary = Record<string, string>;
    type UnmatchedStudentsInfo = Record<string, string | number | null> | null;
  }
}

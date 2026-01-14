export {};
declare global {
  namespace PrismaJson {
    type DescriptorMappingLHSColumns = Record<string, string>;
    type UnmatchedStudentsInfo = { name: string; type: string; count?: number } | null;
  }
}

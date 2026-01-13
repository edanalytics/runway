export {};
declare global {}
namespace PrismaJson {
  type DescriptorMappingLHSColumns = Record<string, string>;
  type RunSummary = Record<
    string,
    Record<'records_processed' | 'records_skipped' | 'records_failed', number>
  > | null;
  type UnmatchedStudentsInfo = { name: string; type: string; count?: number };
}

import { JobsController } from './jobs.controller';
import { ALLOW_METATENANT } from '../auth/authorization/allow-metatenant.decorator';

describe('JobsController output-files routes', () => {
  it('does not require any privilege beyond basic job read for input_no_student_id_match.csv', () => {
    const privilege = Reflect.getMetadata(
      ALLOW_METATENANT,
      JobsController.prototype.downloadUrlForUnmatchedStudentsOutputFile
    );
    // Same privilege as GET /jobs/:jobId (findOne) -- nothing extra is required
    // to access this specific output file beyond being able to view the job at all.
    expect(privilege).toBe('job.metatenant.read');
  });

  it('requires the dedicated output-files privilege on the generic output-files handler', () => {
    const privilege = Reflect.getMetadata(
      ALLOW_METATENANT,
      JobsController.prototype.downloadUrlForOutputFile
    );
    expect(privilege).toBe('job.metatenant.output-files.read');
  });

  it('requires a stricter privilege for the generic output-files handler than for input_no_student_id_match.csv', () => {
    const unmatchedPrivilege = Reflect.getMetadata(
      ALLOW_METATENANT,
      JobsController.prototype.downloadUrlForUnmatchedStudentsOutputFile
    );
    const outputFilesPrivilege = Reflect.getMetadata(
      ALLOW_METATENANT,
      JobsController.prototype.downloadUrlForOutputFile
    );
    expect(outputFilesPrivilege).not.toBe(unmatchedPrivilege);
  });
});

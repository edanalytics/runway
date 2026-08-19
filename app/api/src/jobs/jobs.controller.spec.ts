import { JobsController } from './jobs.controller';
import { EXTERNAL_API_SCOPE_KEY } from '../external-api/auth/external-api-scope.decorator';

describe('JobsController output-files routes', () => {
  it('requires the read:jobs:output-files external API scope on the generic output-files handler', () => {
    const scopes = Reflect.getMetadata(
      EXTERNAL_API_SCOPE_KEY,
      JobsController.prototype.downloadUrlForOutputFile
    );
    expect(scopes).toEqual(['read:jobs:output-files']);
  });

  it('does not require the read:jobs:output-files external API scope on the input_no_student_id_match.csv handler', () => {
    const scopes = Reflect.getMetadata(
      EXTERNAL_API_SCOPE_KEY,
      JobsController.prototype.downloadUrlForUnmatchedStudentsOutputFile
    );
    expect(scopes).toBeUndefined();
  });
});

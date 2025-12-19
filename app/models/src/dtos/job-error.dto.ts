import { Expose, plainToInstance, Type } from 'class-transformer';
import { RunError } from '@prisma/client';

const codeToMessage: Record<string, string> = {
  unknown: 'An unknown error occurred while processing the job.',
  lightbeam_fetch: 'Lightbeam encountered an error while fetching data from the ODS.',
  lightbeam_send: 'Lightbeam encounter an error while sending data to the ODS.',
  lightbeam_validate_students: 'Lightbeam encountered an error while validating student records.',
  lightbeam_validate_other: 'Lightbeam encountered an error validating resources.',
  input_s3_download: 'Unable to download the input file for processing.',
  bundle_git_pull: 'An error occurred retrieving the Earthmover bundle.',
  artifact_not_found: 'Earthmover was unable to locate an artifact on the file system.',
  artifact_empty: 'An artifact was empty.',
  artifact_s3_upload: 'An error occurred while uploading an artifact to S3.',
  earthmover_deps: 'An error occurred while installing Earthmover dependencies.',
  earthmover_run: 'Runway could not transform the uploaded file.',
  failed_to_start_executor: 'Failed to start assessment processing.',
  insufficient_matches: 'Insufficient student ID matches.',
  missing_ods_roster: 'Unable to locate student roster.',
};

export abstract class JobErrorDto {
  @Expose()
  id: number;

  @Expose()
  code: string;

  @Expose()
  payload: {
    stacktrace: string;
  };

  get message() {
    return codeToMessage[this.code];
  }

  get details(): string | undefined {
    return undefined;
  }

  get stacktrace() {
    return this.payload.stacktrace;
  }
}

class BaseJobFileErrorDto extends JobErrorDto {
  @Expose()
  override payload: {
    stacktrace: string;
    name: string;
    path: string;
  };

  override get details() {
    return `Unable to find the ${this.payload.name} artifact. Expected location: ${this.payload.path}`;
  }
}

export class JobFileErrorDto extends BaseJobFileErrorDto {
  @Expose()
  override code: 'job_file';
}

export class JobUnkownErrorDto extends JobErrorDto {
  @Expose()
  override code: 'unknown';
}

export class JobLightbeamFetchErrorDto extends JobErrorDto {
  @Expose()
  override code: 'lightbeam_fetch';

  @Expose()
  override payload: {
    resource: string;
    stacktrace: string;
  };

  override get details() {
    return `Unable to fetch data for resource: ${this.payload.resource}`;
  }
}

export class JobLightbeamSendErrorDto extends JobErrorDto {
  @Expose()
  override code: 'lightbeam_send';
}

export class JobLightbeamValidateStudentsErrorDto extends JobErrorDto {
  @Expose()
  override code: 'lightbeam_validate_students';

  @Expose()
  override payload: {
    failure_pct: number;
    message: string;
    stacktrace: string;
  };
}

export class JobLightbeamValidateOtherErrorDto extends JobErrorDto {
  @Expose()
  override code: 'lightbeam_validate_other';

  @Expose()
  override payload: {
    resources: string;
    message: string;
    stacktrace: string;
  };

  override get details() {
    return `Resource: ${this.payload.resources}. Message: ${this.payload.message}`;
  }
}

export class JobInsufficientMatchesErrorDto extends JobErrorDto {
  @Expose()
  override code: 'insufficient_matches';

  @Expose()
  override payload: {
    match_rate: number;
    match_threshold: number;
    id_name: string;
    id_type: string;
    stacktrace: string;
  };

  override get details() {
    const threshold = (Number(this.payload.match_threshold) * 100).toFixed(1);
    const rate = (Number(this.payload.match_rate) * 100).toFixed(1);

    // We do not include id_name and id_type in the message, for now, since if the match rate is low, we don't
    // trust that these are correct. But if the match rate is above some threshold (and still below the
    // required match_rate threshold), we might update the message to include instructions on how to update
    // the IDs, directing the user to a column in the CSV and which ID type to put there.
    //
    // Currently, we're not sure what a good threshold is (and it might vary based on # of students in the file), so
    // we're holding off until we know more. In the meantime, it's entirely possible that some high level direction
    // is enough to get users on the right track and they can exercise their professional judgement to figure
    // out how to update IDs... If that's the case, then the value of being more specific is low and outweighed
    // by the risk of telling the user something potentially misleading that goes against their professional judgement.
    return `Runway matched ${rate}% of students from the input file to students in the ODS, which is below the required threshold of ${threshold}% to load data. Please review the student IDs in the original file and update them as needed to match IDs present in the ODS.`;
  }
}

export class JobInputS3DownloadErrorDto extends BaseJobFileErrorDto {
  @Expose()
  override code: 'input_s3_download';
}

export class JobGitPullErrorDto extends JobErrorDto {
  @Expose()
  override code: 'bundle_git_pull';
}

export class JobArtifactNotFoundErrorDto extends BaseJobFileErrorDto {
  @Expose()
  override code: 'artifact_not_found';
}

export class JobArtifactEmptyErrorDto extends BaseJobFileErrorDto {
  @Expose()
  override code: 'artifact_empty';
}

export class JobArtifactS3UploadErrorDto extends BaseJobFileErrorDto {
  @Expose()
  override code: 'artifact_s3_upload';
}

export class JobEarthmoverDepsErrorDto extends JobErrorDto {
  @Expose()
  override code: 'earthmover_deps';
}

export class JobEarthmoverRunErrorDto extends JobErrorDto {
  @Expose()
  override code: 'earthmover_run';

  override get details() {
    return `Please ensure you are using an unmodified file from the assessment vendor.`;
  }
}

export class JobExecutorStartErrorDto extends JobErrorDto {
  @Expose()
  override code: 'failed_to_start_executor';
}

export class JobMissingOdsRosterErrorDto extends JobErrorDto {
  @Expose()
  override code: 'missing_ods_roster';

  @Expose()
  override payload: {
    stacktrace: string;
  };

  override get details() {
    return 'Runway requires a roster in order to match data in the input file to students in your system. Please contact your district administrator.';
  }
}
export type TJobErrorDto =
  | JobFileErrorDto
  | JobUnkownErrorDto
  | JobLightbeamFetchErrorDto
  | JobLightbeamSendErrorDto
  | JobLightbeamValidateStudentsErrorDto
  | JobLightbeamValidateOtherErrorDto
  | JobInputS3DownloadErrorDto
  | JobGitPullErrorDto
  | JobArtifactNotFoundErrorDto
  | JobArtifactEmptyErrorDto
  | JobArtifactS3UploadErrorDto
  | JobEarthmoverDepsErrorDto
  | JobEarthmoverRunErrorDto
  | JobExecutorStartErrorDto
  | JobMissingOdsRosterErrorDto;

/**
 * It's a bit annoying, but to use ClassTransformer's discriminator, we need to
 * nest the error in a prop on a wrapper object. The nice thing about the discriminator
 * is that we can consolidate all the logic about messages, details, and payload structure,
 * which vary by error type, in this file here and consumers can just call getters.
 * Consumers need to know to unwrap the error DTO, but they don't need to know how the
 * different types of errors are structured.
 */
export class JobErrorWrapperDto {
  @Expose()
  @Type(() => JobUnkownErrorDto, {
    // unkown error is the default
    discriminator: {
      property: 'code',
      subTypes: [
        { value: JobFileErrorDto, name: 'job_file' },
        { value: JobLightbeamFetchErrorDto, name: 'lightbeam_fetch' },
        { value: JobLightbeamSendErrorDto, name: 'lightbeam_send' },
        { value: JobLightbeamValidateStudentsErrorDto, name: 'lightbeam_validate_students' },
        { value: JobLightbeamValidateOtherErrorDto, name: 'lightbeam_validate_other' },
        { value: JobInputS3DownloadErrorDto, name: 'input_s3_download' },
        { value: JobGitPullErrorDto, name: 'bundle_git_pull' },
        { value: JobArtifactNotFoundErrorDto, name: 'artifact_not_found' },
        { value: JobArtifactEmptyErrorDto, name: 'artifact_empty' },
        { value: JobArtifactS3UploadErrorDto, name: 'artifact_s3_upload' },
        { value: JobEarthmoverDepsErrorDto, name: 'earthmover_deps' },
        { value: JobEarthmoverRunErrorDto, name: 'earthmover_run' },
        { value: JobExecutorStartErrorDto, name: 'failed_to_start_executor' },
        { value: JobInsufficientMatchesErrorDto, name: 'insufficient_matches' },
        { value: JobUnkownErrorDto, name: 'unknown' },
        { value: JobMissingOdsRosterErrorDto, name: 'missing_ods_roster' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  error: TJobErrorDto;
}

export const toJobErrorWrapperDto = (
  error: RunError | RunError[]
): JobErrorWrapperDto | JobErrorWrapperDto[] => {
  const input = Array.isArray(error) ? error.map((error) => ({ error })) : { error }; // nesting for wrapper dto
  return plainToInstance(JobErrorWrapperDto, input, { excludeExtraneousValues: true });
};

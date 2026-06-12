import { ExecutorAwsService } from './executor.aws.service';
import { AppConfigService } from 'api/src/config/app-config.service';
import { EarthbeamApiAuthService } from '../api/auth/earthbeam-api-auth.service';
import { FileService } from 'api/src/files/file.service';
import { Job, JobFile, Run, SchoolYear } from '@prisma/client';

const MB = 1024 * 1024;

describe('ExecutorAwsService', () => {
  const ecsConfig = {
    cluster: 'cluster-arn',
    taskDefinition: {
      small: 'small-task-arn',
      medium: 'medium-task-arn',
      large: 'large-task-arn',
    },
    subnets: ['subnet-1'],
    securityGroups: ['sg-1'],
    taskRole: 'task-role-arn',
    containerName: {
      small: 'env-JobExecutorSmall',
      medium: 'env-JobExecutorMedium',
      large: 'env-JobExecutorLarge',
    },
  };

  const run = {
    id: 1,
    job: {
      id: 10,
      sendToOds: true,
      fileBucketOrHost: 'data-bucket',
      fileBasePath: 'partner/tenant/2025/10',
      files: [
        { jobId: 10, templateKey: 'INPUT_FILE', path: 'partner/tenant/2025/10/input/a.csv' },
        { jobId: 10, templateKey: 'OTHER_FILE', path: 'partner/tenant/2025/10/input/b.csv' },
      ],
      schoolYear: { id: '2025' },
    },
  } as unknown as Run & { job: Job & { schoolYear: SchoolYear; files: JobFile[] } };

  let appConfig: jest.Mocked<Pick<AppConfigService, 'get' | 'ecsConfig' | 'largeTaskFileSizeThresholdBytes'>>;
  let apiAuth: jest.Mocked<Pick<EarthbeamApiAuthService, 'createInitToken' | 'initEndpoint'>>;
  let fileService: jest.Mocked<Pick<FileService, 'getFileSize'>>;
  let service: ExecutorAwsService;
  let ecsSend: jest.Mock;

  beforeEach(() => {
    appConfig = {
      get: jest.fn().mockReturnValue(undefined),
      ecsConfig: jest.fn().mockResolvedValue(ecsConfig),
      largeTaskFileSizeThresholdBytes: jest.fn().mockReturnValue(100 * MB),
    };
    apiAuth = {
      createInitToken: jest.fn().mockResolvedValue('init-token'),
      initEndpoint: jest.fn().mockReturnValue('http://app/init'),
    };
    fileService = { getFileSize: jest.fn() };

    service = new ExecutorAwsService(
      appConfig as unknown as AppConfigService,
      apiAuth as unknown as EarthbeamApiAuthService,
      fileService as unknown as FileService
    );

    // Stub the AWS clients constructed by the service
    jest.spyOn((service as any).stsClient, 'send').mockResolvedValue({
      Credentials: {
        AccessKeyId: 'key',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
      },
    } as never);
    ecsSend = jest.fn().mockResolvedValue({ failures: [] });
    (service as any).ecsClient.send = ecsSend;
  });

  it('uses the medium task when input files total less than the threshold', async () => {
    fileService.getFileSize.mockResolvedValueOnce(40 * MB).mockResolvedValueOnce(50 * MB);

    await service.start(run);

    const taskInput = ecsSend.mock.calls[0][0].input;
    expect(taskInput.taskDefinition).toBe('medium-task-arn');
    expect(taskInput.overrides.containerOverrides[0].name).toBe('env-JobExecutorMedium');
  });

  it('uses the large task when input files total at least the threshold', async () => {
    fileService.getFileSize.mockResolvedValueOnce(40 * MB).mockResolvedValueOnce(60 * MB);

    await service.start(run);

    expect(fileService.getFileSize).toHaveBeenCalledWith(
      'partner/tenant/2025/10/input/a.csv',
      'data-bucket'
    );
    const taskInput = ecsSend.mock.calls[0][0].input;
    expect(taskInput.taskDefinition).toBe('large-task-arn');
    expect(taskInput.overrides.containerOverrides[0].name).toBe('env-JobExecutorLarge');
  });

  it('fails the start when a file size lookup fails', async () => {
    fileService.getFileSize.mockRejectedValue(new Error('S3 unavailable'));

    await expect(service.start(run)).rejects.toThrow('S3 unavailable');
    expect(ecsSend).not.toHaveBeenCalled();
  });
});

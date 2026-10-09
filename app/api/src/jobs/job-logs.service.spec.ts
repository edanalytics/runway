import {
  CloudWatchLogsClient,
  InvalidParameterException,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { JobLogsService } from './job-logs.service';
import { MockExecutorLogsClient } from './job-logs.mock-client';

describe('JobLogsService', () => {
  const ecsTaskArn = 'arn:aws:ecs:us-east-2:123456789012:task/env-cluster/abc123';

  let findFirst: jest.Mock;
  let logsSend: jest.Mock;
  let service: JobLogsService;

  const page = (nextForwardToken: string | undefined, messages: string[] = []) => ({
    nextForwardToken,
    events: messages.map((message, i) => ({ timestamp: 1000 + i, message })),
  });
  const requestedTokens = () => logsSend.mock.calls.map(([command]) => command.input.nextToken);

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue({ ecsTaskArn, taskSize: 'large' });
    const appConfig = {
      get: jest.fn((key: string) => ({ ENVLABEL: 'env', AWS_REGION: 'us-east-2' }[key])),
    };
    service = new JobLogsService(
      { run: { findFirst } } as unknown as PrismaClient,
      appConfig as unknown as AppConfigService
    );
    logsSend = jest.fn();
    (service as any).logsClient.send = logsSend;
  });

  it('reads the stream the awslogs driver wrote for the run’s task and size', async () => {
    logsSend.mockResolvedValue(page('f/1', ['hello']));

    await service.getLogs(1, 10);

    expect(logsSend.mock.calls[0][0].input).toMatchObject({
      logGroupName: '/ecs/JobExecutorLarge-env',
      logStreamName: 'ecs/env-JobExecutorLarge/abc123',
      startFromHead: true,
    });
  });

  it('looks the run up within the job, and returns NO_RUN when the job has no such run', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.getLogs(1, 10)).resolves.toEqual({ status: 'ERROR', code: 'NO_RUN' });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 10, jobId: 1 });
    expect(logsSend).not.toHaveBeenCalled();
  });

  it.each([
    { description: 'no task ARN', run: { ecsTaskArn: null, taskSize: 'medium' } },
    { description: 'no task size', run: { ecsTaskArn, taskSize: null } },
    { description: 'an unrecognized task size', run: { ecsTaskArn, taskSize: 'huge' } },
  ])('returns NO_TASK without calling CloudWatch for $description', async ({ run }) => {
    findFirst.mockResolvedValue(run);

    await expect(service.getLogs(1, 10)).resolves.toEqual({ status: 'ERROR', code: 'NO_TASK' });
    expect(logsSend).not.toHaveBeenCalled();
  });

  const requestedLimits = () => logsSend.mock.calls.map(([command]) => command.input.limit);

  it('returns a full page without checking for the end', async () => {
    const messages = Array.from({ length: 10000 }, (_, i) => `line ${i}`);
    logsSend.mockResolvedValueOnce(page('f/2', messages));

    const result = await service.getLogs(1, 10, 'f/1');

    expect(requestedTokens()).toEqual(['f/1']);
    expect(result).toMatchObject({ data: { nextCursor: 'f/2', atEnd: false } });
    expect((result as { data: { events: unknown[] } }).data.events).toHaveLength(10000);
  });

  it('fills a short page until CloudWatch reports the end, then returns a cursor for later lines', async () => {
    logsSend.mockResolvedValueOnce(page('f/2', ['one', 'two'])).mockResolvedValueOnce(page('f/2'));

    const result = await service.getLogs(1, 10, 'f/1');

    expect(requestedTokens()).toEqual(['f/1', 'f/2']);
    expect(requestedLimits()).toEqual([10000, 9998]);
    expect(result).toEqual({
      status: 'SUCCESS',
      data: {
        events: [
          { timestamp: 1000, message: 'one' },
          { timestamp: 1001, message: 'two' },
        ],
        nextCursor: 'f/2',
        atEnd: true,
      },
    });
  });

  it('reports the end with the same cursor when no lines have been written since', async () => {
    logsSend.mockResolvedValueOnce(page('f/1'));

    await expect(service.getLogs(1, 10, 'f/1')).resolves.toEqual({
      status: 'SUCCESS',
      data: { events: [], nextCursor: 'f/1', atEnd: true },
    });
  });

  it('follows empty pages mid-stream', async () => {
    logsSend
      .mockResolvedValueOnce(page('f/1'))
      .mockResolvedValueOnce(page('f/2'))
      .mockResolvedValueOnce(page('f/3', ['found']))
      .mockResolvedValueOnce(page('f/3'));

    const result = await service.getLogs(1, 10);

    expect(requestedTokens()).toEqual([undefined, 'f/1', 'f/2', 'f/3']);
    expect(result).toMatchObject({
      data: { events: [{ message: 'found' }], nextCursor: 'f/3', atEnd: true },
    });
  });

  it('stops after five requests and returns a cursor to resume from', async () => {
    let n = 0;
    logsSend.mockImplementation(async () => page(`f/${++n}`, ['more']));

    const result = await service.getLogs(1, 10);

    expect(logsSend).toHaveBeenCalledTimes(5);
    expect(result).toMatchObject({ data: { nextCursor: 'f/5', atEnd: false } });
  });

  it('returns STREAM_NOT_FOUND when CloudWatch has no such stream', async () => {
    logsSend.mockRejectedValue(
      new ResourceNotFoundException({
        message: 'The specified log stream does not exist.',
        $metadata: {},
      })
    );

    await expect(service.getLogs(1, 10)).resolves.toEqual({
      status: 'ERROR',
      code: 'STREAM_NOT_FOUND',
    });
  });

  it('returns INVALID_CURSOR when CloudWatch rejects the cursor it was given', async () => {
    logsSend.mockRejectedValue(
      new InvalidParameterException({ message: 'bad token', $metadata: {} })
    );

    await expect(service.getLogs(1, 10, 'not-a-token')).resolves.toEqual({
      status: 'ERROR',
      code: 'INVALID_CURSOR',
    });
  });

  it('throws when CloudWatch rejects a request that had no cursor', async () => {
    logsSend.mockRejectedValue(
      new InvalidParameterException({ message: 'bad group', $metadata: {} })
    );

    await expect(service.getLogs(1, 10)).rejects.toThrow('bad group');
  });

  it('throws other CloudWatch errors', async () => {
    logsSend.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(service.getLogs(1, 10)).rejects.toThrow('AccessDeniedException');
  });

  // The mock must never stand in for CloudWatch in a deployed environment
  it.each([
    { mockSetting: 'mock', isDev: true, client: MockExecutorLogsClient },
    { mockSetting: 'mock', isDev: false, client: CloudWatchLogsClient },
    { mockSetting: undefined, isDev: true, client: CloudWatchLogsClient },
  ])(
    'reads from $client.name when LOCAL_EXECUTOR_LOGS=$mockSetting and dev is $isDev',
    ({ mockSetting, isDev, client }) => {
      const appConfig = {
        get: jest.fn((key: string) => ({ LOCAL_EXECUTOR_LOGS: mockSetting }[key])),
        isDevEnvironment: () => isDev,
      };
      const selected = new JobLogsService(
        {} as PrismaClient,
        appConfig as unknown as AppConfigService
      );

      expect((selected as any).logsClient).toBeInstanceOf(client);
    }
  );
});

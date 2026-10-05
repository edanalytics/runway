import { ResourceNotFoundException } from '@aws-sdk/client-cloudwatch-logs';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { JobLogsService } from './job-logs.service';

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
      get: jest.fn((key: string) => ({ ENVLABEL: 'env', AWS_REGION: 'us-east-2' })[key]),
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

    await service.getLogs(1);

    expect(logsSend.mock.calls[0][0].input).toMatchObject({
      logGroupName: '/ecs/JobExecutorLarge-env',
      logStreamName: 'ecs/env-JobExecutorLarge/abc123',
      startFromHead: true,
    });
  });

  it.each([
    { description: 'no task ARN', run: { ecsTaskArn: null, taskSize: 'medium' } },
    { description: 'no task size', run: { ecsTaskArn, taskSize: null } },
    { description: 'an unrecognized task size', run: { ecsTaskArn, taskSize: 'huge' } },
    { description: 'no run', run: null },
  ])('returns NO_TASK without calling CloudWatch for $description', async ({ run }) => {
    findFirst.mockResolvedValue(run);

    await expect(service.getLogs(1)).resolves.toEqual({ status: 'ERROR', code: 'NO_TASK' });
    expect(logsSend).not.toHaveBeenCalled();
  });

  it('returns the events and a cursor that resumes after them', async () => {
    logsSend.mockResolvedValue(page('f/2', ['one', 'two']));

    const result = await service.getLogs(1, 'f/1');

    expect(requestedTokens()).toEqual(['f/1']);
    expect(result).toEqual({
      status: 'SUCCESS',
      data: {
        events: [
          { timestamp: 1000, message: 'one' },
          { timestamp: 1001, message: 'two' },
        ],
        nextCursor: 'f/2',
      },
    });
  });

  it('returns a null cursor when CloudWatch hands back the token it was given', async () => {
    logsSend.mockResolvedValue(page('f/1'));

    await expect(service.getLogs(1, 'f/1')).resolves.toEqual({
      status: 'SUCCESS',
      data: { events: [], nextCursor: null },
    });
  });

  it('returns a null cursor with the last events when that page also ends the stream', async () => {
    logsSend.mockResolvedValue(page('f/1', ['last']));

    const result = await service.getLogs(1, 'f/1');

    expect(result).toMatchObject({ data: { events: [{ message: 'last' }], nextCursor: null } });
  });

  it('follows empty pages mid-stream until it finds events', async () => {
    logsSend
      .mockResolvedValueOnce(page('f/1'))
      .mockResolvedValueOnce(page('f/2'))
      .mockResolvedValueOnce(page('f/3', ['found']));

    const result = await service.getLogs(1);

    expect(requestedTokens()).toEqual([undefined, 'f/1', 'f/2']);
    expect(result).toMatchObject({ data: { events: [{ message: 'found' }], nextCursor: 'f/3' } });
  });

  it('stops following empty pages after five requests and returns a cursor to resume from', async () => {
    let n = 0;
    logsSend.mockImplementation(async () => page(`f/${++n}`));

    const result = await service.getLogs(1);

    expect(logsSend).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ status: 'SUCCESS', data: { events: [], nextCursor: 'f/5' } });
  });

  it('returns STREAM_NOT_FOUND when CloudWatch has no such stream', async () => {
    logsSend.mockRejectedValue(
      new ResourceNotFoundException({ message: 'The specified log stream does not exist.', $metadata: {} })
    );

    await expect(service.getLogs(1)).resolves.toEqual({
      status: 'ERROR',
      code: 'STREAM_NOT_FOUND',
    });
  });

  it('throws other CloudWatch errors', async () => {
    logsSend.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(service.getLogs(1)).rejects.toThrow('AccessDeniedException');
  });
});

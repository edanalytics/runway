import {
  GetJobDto,
  PostJobDto,
  PostJobResponseDto,
  PutJobParamsDto,
  GetFileDto,
  GetRunUpdateDto,
  JobErrorWrapperDto,
  PutJobResolveDto,
} from '@edanalytics/models';
import { EntityQueryBuilder } from './builder';
import { apiClient, methods } from '../methods';
import { useQueryClient } from '@tanstack/react-query';

export const jobQueries = new EntityQueryBuilder({ classNamePlural: 'Jobs' })
  .getAll({ ResDto: GetJobDto })
  .getOne({ ResDto: GetJobDto })
  .post({ ReqDto: PostJobDto, ResDto: PostJobResponseDto })
  .put(
    {
      key: 'start',
      ReqDto: PutJobParamsDto,
      ResDto: GetJobDto,
      keysToInvalidate: () => [['jobs', 'list']],
    },
    ({ id }) => `/jobs/${id}/start`
  )
  .build();

export const putJobResolve = (job: GetJobDto, queryClient = useQueryClient()) => ({
  mutationFn: (putResolveDto: PutJobResolveDto) =>
    methods.put(`/jobs/${job.id}/resolve`, PutJobResolveDto, GetJobDto, putResolveDto),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ['jobs', 'list'] });
    await queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${job.id}`] });
  },
});

export const getJobStatusUpdates = (jobId: string) => ({
  queryKey: ['jobs', jobId, 'status-updates'],
  queryFn: () => methods.getMany(`/jobs/${jobId}/status-updates`, GetRunUpdateDto),
});

export const getJobErrors = (jobId: string) => ({
  queryKey: ['jobs', jobId, 'errors'],
  queryFn: () => methods.getMany(`/jobs/${jobId}/errors`, JobErrorWrapperDto),
});

export const getInputFileDownloadUrl = async ({
  jobId,
  templateKey,
}: Pick<GetFileDto, 'jobId' | 'templateKey'>) => {
  const url = await apiClient.get<string, string>(`/jobs/${jobId}/files/${templateKey}`);
  if (typeof url !== 'string') {
    throw new Error('Invalid download url');
  }
  return url;
};

export const getOutputFileDownloadUrl = async ({
  jobId,
  fileName,
}: {
  jobId: GetJobDto['id'];
  fileName: string;
}) => {
  const url = await apiClient.get<string, string>(
    `/jobs/${jobId}/output-files/${encodeURIComponent(fileName)}`
  );
  if (typeof url !== 'string') {
    throw new Error('Invalid download url');
  }
  return url;
};

export const useInvalidateJobQueries = (jobId: string | number) => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['jobs', jobId.toString()] });
    queryClient.invalidateQueries({ queryKey: ['jobs', `detail-${jobId}`] });
  };
};

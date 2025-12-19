import {
  GetJobNoteDto,
  PostJobNoteDto,
  PostJobNoteResponseDto,
  PutJobNoteDto,
  PutJobNoteResponseDto,
} from '@edanalytics/models';
import { methods } from '../methods';
import { useQueryClient } from '@tanstack/react-query';

const queryKeyBase = (jobId: number) => ['jobs', jobId, 'notes'];

export const getJobNotes = (jobId: number) => ({
  queryKey: queryKeyBase(jobId),
  queryFn: () => methods.getMany(`/jobs/${jobId}/notes`, GetJobNoteDto),
});

export const postJobNote = (jobId: number, queryClient = useQueryClient()) => ({
  mutationFn: (dto: PostJobNoteDto) =>
    methods.post(`/jobs/${jobId}/notes`, PostJobNoteDto, PostJobNoteResponseDto, dto),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeyBase(jobId) });
  },
});

export const putJobNote = (jobId: number, noteId: number, queryClient = useQueryClient()) => ({
  mutationFn: (dto: PutJobNoteDto) =>
    methods.put(`/jobs/${jobId}/notes/${noteId}`, PutJobNoteDto, PutJobNoteResponseDto, dto),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeyBase(jobId) });
  },
});

export const deleteJobNote = (jobId: number, noteId: number, queryClient = useQueryClient()) => ({
  mutationFn: () => methods.delete(`/jobs/${jobId}/notes/${noteId}`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeyBase(jobId) });
  },
});

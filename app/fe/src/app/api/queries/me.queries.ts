import { GetSessionDataDto } from '@edanalytics/models';
import { useQuery } from '@tanstack/react-query';
import { methods } from '../methods';

const baseUrl = '';

export const useMe = () =>
  useQuery({
    queryKey: [`me`],
    queryFn: () => methods.getOne<GetSessionDataDto>(`${baseUrl}/auth/me`, GetSessionDataDto),
  });

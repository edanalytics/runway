import { GetSessionDataDto } from '@edanalytics/models';
import { useQuery } from '@tanstack/react-query';
import { methods } from '../methods';

const baseUrl = '';

export const meQuery = {
  queryKey: [`me`],
  queryFn: () => methods.getOne<GetSessionDataDto>(`${baseUrl}/auth/me`, GetSessionDataDto),
};

export const useMe = () => useQuery(meQuery);

import { notFound } from '@tanstack/react-router';
import axios from 'axios';
import { ClassConstructor, instanceToPlain, plainToInstance } from 'class-transformer';

axios.defaults.baseURL = `${import.meta.env.VITE_API_URL.replace(/\/?$/, '')}/api/`;

export const apiClient = axios.create({
  withCredentials: true,
});

apiClient.interceptors.response.use(
  (res) => res.data,
  (error) => {
    if ([401].includes(error?.response?.status)) {
      console.log('Redirecting to login');
      window.location.href = `${import.meta.env.VITE_API_URL.replace(
        /\/?$/,
        ''
      )}/api/auth/login?redirect=${encodeURIComponent(
        window.location.href.replace(window.location.origin, '')
      )}&origin=${encodeURIComponent(window.location.origin)}`;
    } else {
      throw error?.response?.data ?? error;
    }
  }
);

async function getManyMap<R extends object>(
  url: string,
  dto: ClassConstructor<R>,
  params: object | undefined,
  key: keyof R
): Promise<Record<string | number, R>>;
async function getManyMap<R extends { id: number }>(
  url: string,
  dto: ClassConstructor<R>,
  params?: object | undefined
): Promise<Record<string | number, R>>;
async function getManyMap<R extends object>(
  url: string,
  dto: ClassConstructor<R>,
  params?: object | undefined,
  key?: keyof R
): Promise<Record<string | number, R>> {
  const res = (await apiClient.get<R>(url, params)) as unknown as R[];
  return (res ?? []).reduce((map, o) => {
    const instance = plainToInstance(dto, o);
    map[instance[key ?? ('id' as keyof R)] as string | number] = instance;
    return map;
  }, {} as Record<string | number, R>);
}

export const methods = {
  getOne: async <R extends object>(url: string, dto: ClassConstructor<R>, params?: object) => {
    const res = await apiClient.get<R>(url, params);
    return plainToInstance(dto, res) as R;
  },
  getMany: async <R extends object>(url: string, dto: ClassConstructor<R>, params?: object) => {
    const res = (await apiClient.get<R>(url, params)) as unknown as R[];
    return (res ?? []).map((o) => plainToInstance(dto, o));
  },
  getManyMap,
  put: async <R extends object, P extends object>(
    url: string,
    dtoReq: ClassConstructor<R>,
    dtoRes: ClassConstructor<P>,
    data: R
  ) => {
    const res = await apiClient.put<R>(url, instanceToPlain(plainToInstance(dtoReq, data)));
    return plainToInstance(dtoRes, res);
  },
  post: async <R extends object, P extends object>(
    url: string,
    dtoReq: ClassConstructor<R>,
    dtoRes: ClassConstructor<P>,
    data: R
  ) => {
    const res = await apiClient.post<R>(url, instanceToPlain(plainToInstance(dtoReq, data)));
    return plainToInstance(dtoRes, res);
  },
  delete: (url: string) => apiClient.delete<unknown>(url),
};

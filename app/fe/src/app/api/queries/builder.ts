import { Id } from '@edanalytics/models';
import { kebabCase } from '@edanalytics/utils';
import {
  QueryKey,
  UseMutationResult,
  UseQueryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { AxiosResponse } from 'axios';
import { ClassConstructor } from 'class-transformer';
import { queryClient } from '../../app';
import { methods } from '../methods';

export const queryFromEntity = <EntityType extends Id>(entity: EntityType) => ({
  data: { [entity.id]: entity },
});

export const standardPath = (params: {
  kebabCaseName: string;
  /** Applies after the standardized stem.
   *
   * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
   * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
   * override might be `applications/1/` or `applications/1/reset-credentials/`. If
   * you want to override the entire path after `/api/`, just instantiate some
   * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
   */
  pathOverride?: string | undefined;
  /** Can also accept arbitrary terminal path string */
  id?: string | number | undefined;
}) => {
  const { kebabCaseName, pathOverride, id } = params;
  const namePath = `${kebabCaseName}/`;
  const idPath = id === undefined ? '' : `${id}`;

  return pathOverride ? pathOverride : namePath + idPath;
};

type StandardQueryKeyParams = {
  kebabCaseName: string;
  pathOverride?: string | undefined;
  /** if `undefined`, uses "list" option. If `false`, omits to yield a partial (wildcard) key */
  id?: number | string | false;
};
/** Build standardized query key.
 *
 * Lists are keyed by `..., "list",...`. Details are keyed by `..., "detail-{id}",...`. Both
 * an entity's single list and its many detail caches can all be matched by passing `undefined`
 * as the `id` parameter to this function, as long as there is no `team` value. _Hint:
 * `team` should be included in the query, but not in mutation invalidations._
 *
 * If `undefined`, uses "list" option. If `false`, omits to yield a partial (wildcard) key */
export const queryKeyNew = (params: StandardQueryKeyParams) => {
  const { kebabCaseName, pathOverride, id } = params;
  const idKey = id === undefined ? ['list'] : id === false ? [] : [`detail-${id}`];
  const standardKey = [kebabCaseName, ...idKey];

  return pathOverride ? [...standardKey, pathOverride] : standardKey;
};

type BaseGetDto = { id: number | string };

type EntityQueryBuilderObject = object;

/**
 * Build a set of standardized or custom API queries for an entity. Add
 * queries to the set by method chaining. Comes with a lot of defualts,
 * but also supports custom URL factories and custom cache invalidations.
 *
 * There are three levels of config:
 * - baseConfig (for the whole set)
 * - extraConfig (specific to each chained method)
 * - queryParams (passed to the query upon usage)
 *
 * This allows the system as a whole to be as DRY as possible while still
 * highly configurable.
 *
 * Example:
```ts
const applicationQueries = new EntityQueryBuilder({
    adminApi: true,
    name: 'Application',
    includeEdfiTenant: true,
    includeTeam: TeamOptions.Required,
})
    .getOne('getOne', { ResDto: GetAppDto })
    .put('put', { ResDto: GetAppDto, ReqDto: PutAppDto })
    .put(
      'resetCreds',
      {
        ResDto: YopassResDto,
        ReqDto: Id,
        keysToInvalidate: (base) => [
        // ...keys
        ]
      },
      (base, extras) => '<path>'
    )
    .build();
```
 */
export class EntityQueryBuilder<T extends EntityQueryBuilderObject, ConfigType extends object> {
  private object: T;
  private baseConfig: ConfigType & { classNamePlural: string };

  constructor(
    baseConfig: ConfigType & {
      /** Plural version of "NiceEntity", i.e. "NiceEntities" */
      classNamePlural: string;
    }
  ) {
    this.object = {} as T;
    this.baseConfig = baseConfig;
  }
  getOne<GetType extends object, K extends string = 'getOne'>(args: {
    key?: K;
    ResDto: ClassConstructor<GetType>;
    /** When available, use item from getManyMap found by `id` as the initial data  */
    initialDataFromManyQuery?: boolean;
  }): EntityQueryBuilder<
    T &
      Record<
        K,
        (queryParams: { id: number | string; enabled?: boolean }) => UseQueryOptions<GetType>
      >,
    ConfigType
  >;
  getOne<GetType extends object, PathExtraParamsType, K extends string = 'getOne'>(
    args: {
      key?: K;
      ResDto: ClassConstructor<GetType>;
      /** When available, use item from getManyMap found by `id` as the initial data  */
      initialDataFromManyQuery?: boolean;
    },
    /** Applies after the standardized stem.
     *
     * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
     * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
     * override might be `applications/1/` or `applications/1/reset-credentials/`. If
     * you want to override the entire path after `/api/`, just instantiate some
     * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
     */
    path: (
      base: {
        id: number | string;
        enabled?: boolean;
      },
      extras: PathExtraParamsType
    ) => string
  ): EntityQueryBuilder<
    T &
      Record<
        K,
        (
          queryParams: {
            id: number | string;
            enabled?: boolean;
          },
          pathParams: PathExtraParamsType
        ) => UseQueryOptions<GetType>
      >,
    ConfigType
  >;
  getOne(extraConfig: any, pathConfig?: any) {
    const { ResDto, key, initialDataFromManyQuery } = extraConfig;
    const { classNamePlural: name } = this.baseConfig;
    const path = pathConfig;
    const kebabCaseName = kebabCase(name);
    const queryFactory = (
      queryParams: {
        id: number | string;
        enabled?: boolean;
      },
      pathParams?: any
    ): UseQueryOptions => {
      const pathOverride = path ? path(queryParams, pathParams) : undefined;
      return {
        enabled: queryParams.enabled === undefined || queryParams.enabled,
        queryKey: queryKeyNew({
          kebabCaseName,
          pathOverride,
          id: queryParams.id,
        }),
        queryFn: async () => {
          const url = standardPath({
            kebabCaseName,
            pathOverride,
            id: queryParams.id,
          });
          return await methods.getOne(url, ResDto);
        },
        initialData: initialDataFromManyQuery
          ? queryClient.getQueryData<Record<string, any>>(
              queryKeyNew({
                kebabCaseName,
                pathOverride,
              })
            )?.[queryParams.id]
          : undefined,
      };
    };

    Object.assign(this.object, {
      [key ?? 'getOne']: queryFactory,
    });

    return this as any;
  }

  getAll<GetType extends BaseGetDto, K extends string = 'getAll'>(args: {
    key?: K;
    ResDto: ClassConstructor<GetType>;
  }): EntityQueryBuilder<
    T & Record<K, (queryParams: { enabled?: boolean }) => UseQueryOptions<Array<GetType>>>,
    ConfigType
  >;
  getAll<GetType extends BaseGetDto, PathExtraParamsType, K extends string = 'getAll'>(
    args: {
      key?: K;
      ResDto: ClassConstructor<GetType>;
    },
    /** Applies after the standardized stem.
     *
     * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
     * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
     * override might be `applications/1/` or `applications/1/reset-credentials/`. If
     * you want to override the entire path after `/api/`, just instantiate some
     * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
     */
    path: (
      base: {
        enabled?: boolean;
      },
      extras: PathExtraParamsType
    ) => string
  ): EntityQueryBuilder<
    T &
      Record<
        K,
        (
          queryParams: {
            enabled?: boolean;
          },
          pathParams: PathExtraParamsType
        ) => UseQueryOptions<Array<GetType>>
      >,
    ConfigType
  >;
  getAll(extraConfig: any, pathConfig?: any) {
    const { ResDto, key } = extraConfig;
    const { classNamePlural: name } = this.baseConfig;
    const path = pathConfig;
    const kebabCaseName = kebabCase(name);

    const queryFactory = (
      queryParams: {
        enabled?: boolean;
      },
      pathParams?: any
    ) => {
      const pathOverride = path ? path(queryParams, pathParams) : undefined;
      return {
        enabled: queryParams.enabled === undefined || queryParams.enabled,
        queryKey: queryKeyNew({
          kebabCaseName,
          pathOverride,
        }),
        queryFn: async () => {
          const url = standardPath({
            kebabCaseName,
            pathOverride,
          });
          return await methods.getMany(url, ResDto);
        },
      };
    };

    Object.assign(this.object, {
      [key ?? 'getAll']: queryFactory,
    });

    return this as any;
  }

  put<ResType extends object, ReqType extends object, K extends string = 'put'>(args: {
    key?: K;
    ResDto: ClassConstructor<ResType>;
    ReqDto: ClassConstructor<ReqType>;
    keysToInvalidate?: (base: {
      entity: ReqType;
      standard: QueryKey;
      standardQueryKeyParams: StandardQueryKeyParams;
    }) => QueryKey[];
  }): EntityQueryBuilder<
    T & Record<K, () => UseMutationResult<ResType, Error, { entity: ReqType } & Id, unknown>>,
    ConfigType
  >;
  put<
    ResType extends object,
    ReqType extends object,
    PathExtraParamsType,
    K extends string = 'put'
  >(
    args: {
      key?: K;
      ResDto: ClassConstructor<ResType>;
      ReqDto: ClassConstructor<ReqType>;
      keysToInvalidate?: (base: {
        entity: ReqType;
        standard: QueryKey;
        standardQueryKeyParams: StandardQueryKeyParams;
      }) => QueryKey[];
    },
    /** Applies after the standardized stem.
     *
     * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
     * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
     * override might be `applications/1/` or `applications/1/reset-credentials/`. If
     * you want to override the entire path after `/api/`, just instantiate some
     * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
     */
    path: (
      base: {
        entity: ReqType;
        id: Id['id'];
      },
      extras: PathExtraParamsType
    ) => string
  ): EntityQueryBuilder<
    T &
      Record<
        K,
        () => UseMutationResult<
          ResType,
          Error,
          { entity: ReqType; pathParams?: PathExtraParamsType } & Id,
          unknown
        >
      >,
    ConfigType
  >;
  put(extraConfig: any, pathConfig?: any) {
    const { key, ResDto, ReqDto, keysToInvalidate } = extraConfig;
    const { classNamePlural: name } = this.baseConfig;
    const path = pathConfig;
    const kebabCaseName = kebabCase(name);
    const useMutationFactory = () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: ({ entity, id, pathParams }: Id & { entity: object; pathParams?: object }) => {
          const pathOverride = path ? path({ entity, id }, pathParams) : undefined;
          return methods.put(
            standardPath({
              id,
              kebabCaseName,
              pathOverride,
            }),
            ReqDto,
            ResDto,
            entity
          );
        },
        onSuccess: (
          data,
          { entity, id, pathParams }: Id & { entity: object; pathParams?: object }
        ) => {
          const pathOverride = path ? path({ entity }, pathParams) : undefined;
          // TODO: optionally configure cache update instead of invalidation

          const standardQueryKeyParams: StandardQueryKeyParams = {
            kebabCaseName,
            pathOverride,
            id: false,
          };
          const standard = queryKeyNew(standardQueryKeyParams);
          if (keysToInvalidate) {
            keysToInvalidate({ entity, standard, standardQueryKeyParams }).forEach(
              (key: QueryKey) => {
                queryClient.invalidateQueries({
                  queryKey: key,
                });
              }
            );
          } else {
            queryClient.invalidateQueries({
              queryKey: standard,
            });
          }
        },
      });
    };

    Object.assign(this.object, {
      [key ?? 'put']: useMutationFactory,
    });

    return this as any;
  }

  post<ResType extends object, ReqType extends object, K extends string = 'post'>(args: {
    key?: K;
    ResDto: ClassConstructor<ResType>;
    ReqDto: ClassConstructor<ReqType>;
    keysToInvalidate?: (base: {
      entity: ReqType;
      standard: QueryKey;
      standardQueryKeyParams: StandardQueryKeyParams;
    }) => QueryKey[];
  }): EntityQueryBuilder<
    T & Record<K, () => UseMutationResult<ResType, Error, { entity: ReqType }, unknown>>,
    ConfigType
  >;
  post<
    ResType extends object,
    ReqType extends object,
    PathExtraParamsType,
    K extends string = 'post'
  >(
    args: {
      key?: K;
      ResDto: ClassConstructor<ResType>;
      ReqDto: ClassConstructor<ReqType>;
      keysToInvalidate?: (base: {
        entity: ReqType;
        standard: QueryKey;
        standardQueryKeyParams: StandardQueryKeyParams;
      }) => QueryKey[];
    },
    /** Applies after the standardized stem.
     *
     * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
     * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
     * override might be `applications/1/` or `applications/1/reset-credentials/`. If
     * you want to override the entire path after `/api/`, just instantiate some
     * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
     */
    path: (
      base: {
        entity: ReqType;
      },
      extras: PathExtraParamsType
    ) => string
  ): EntityQueryBuilder<
    T &
      Record<
        K,
        () => UseMutationResult<
          ResType,
          unknown,
          { entity: ReqType; pathParams: PathExtraParamsType },
          unknown
        >
      >,
    ConfigType
  >;
  post(extraConfig: any, pathConfig?: any) {
    const { key, ResDto, ReqDto, keysToInvalidate } = extraConfig;
    const { classNamePlural: name } = this.baseConfig;
    const path = pathConfig;
    const kebabCaseName = kebabCase(name);
    const useMutationFactory = () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: ({ entity, pathParams }: any) => {
          const pathOverride = path ? path({ entity }, pathParams) : undefined;
          return methods.post(
            standardPath({
              kebabCaseName,
              pathOverride,
            }),
            ReqDto,
            ResDto,
            entity
          );
        },
        onSuccess: (data, { entity, pathParams }: any) => {
          const pathOverride = path ? path({ entity }, pathParams) : undefined;
          // TODO: optionally configure cache update instead of invalidation
          const standardQueryKeyParams: StandardQueryKeyParams = {
            kebabCaseName,
            pathOverride,
            id: undefined,
          };
          const standard = queryKeyNew(standardQueryKeyParams);
          if (keysToInvalidate) {
            keysToInvalidate({ entity, standard, standardQueryKeyParams }).forEach(
              (key: QueryKey) => {
                queryClient.invalidateQueries({
                  queryKey: key,
                });
              }
            );
          } else {
            queryClient.invalidateQueries({
              queryKey: standard,
            });
          }
        },
      });
    };

    Object.assign(this.object, {
      [key ?? 'post']: useMutationFactory,
    });

    return this as any;
  }

  delete<K extends string = 'delete'>(args?: {
    key?: K;
    keysToInvalidate?: (base: {
      id: string | number;
      standard: QueryKey;
      standardQueryKeyParams: StandardQueryKeyParams;
    }) => QueryKey[];
  }): EntityQueryBuilder<
    T &
      Record<
        K,
        () => UseMutationResult<
          AxiosResponse<unknown, any>,
          unknown,
          { id: string | number },
          unknown
        >
      >,
    ConfigType
  >;
  delete<PathExtraParamsType, K extends string = 'delete'>(
    args: {
      key?: K;
      keysToInvalidate?: (base: {
        id: string | number;
        standard: QueryKey;
        standardQueryKeyParams: StandardQueryKeyParams;
      }) => QueryKey[];
    },
    /** Applies after the standardized stem.
     *
     * Stem is up to and including `https://host:port/api/as/1/edfi-tenants/1/admin-api/v1/`,
     * depending on whether `teamId`, `edfiTenant`, and `adminApi` are present. So
     * override might be `applications/1/` or `applications/1/reset-credentials/`. If
     * you want to override the entire path after `/api/`, just instantiate some
     * queries that don't include any of `teamId`, `edfiTenant`, or `adminApi`.
     */
    path: (
      base: {
        id: string | number;
      },
      extras: PathExtraParamsType
    ) => string
  ): EntityQueryBuilder<
    T &
      Record<
        K,
        () => UseMutationResult<
          AxiosResponse<unknown, any>,
          unknown,
          { id: string | number; pathParams: PathExtraParamsType },
          unknown
        >
      >,
    ConfigType
  >;
  delete(extraConfig?: any, pathConfig?: any) {
    const { classNamePlural: name } = this.baseConfig;
    const { key, keysToInvalidate } = extraConfig || {};
    const path = pathConfig && 'path' in pathConfig ? pathConfig.path : undefined;
    const kebabCaseName = kebabCase(name);
    const useMutationFactory = () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: ({ id, pathParams }: any) => {
          const pathOverride = path ? path({ id }, pathParams) : undefined;
          return methods.delete(
            standardPath({
              kebabCaseName,
              pathOverride,
              id,
            })
          );
        },
        onSuccess: (data, { id, pathParams }: any) => {
          const pathOverride = path ? path({ id }, pathParams) : undefined;
          // TODO: optionally configure cache update instead of invalidation
          const standardQueryKeyParams: StandardQueryKeyParams = {
            kebabCaseName,
            pathOverride,
            id: undefined,
          };
          const standard = queryKeyNew(standardQueryKeyParams);
          if (keysToInvalidate) {
            keysToInvalidate({ id, standard, standardQueryKeyParams }).forEach((key: QueryKey) => {
              queryClient.invalidateQueries({
                queryKey: key,
              });
            });
          } else {
            queryClient.invalidateQueries({
              queryKey: standard,
            });
          }
        },
      });
    };

    Object.assign(this.object, {
      [key ?? 'delete']: useMutationFactory,
    });

    return this as any;
  }

  build(): T {
    return this.object;
  }
}

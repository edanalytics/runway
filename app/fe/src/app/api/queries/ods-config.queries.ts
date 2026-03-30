import {
  GetOdsConfigDto,
  GetOdsConfigWithSecretDto,
  Id,
  PostOdsConfigDto,
  PutOdsConfigDto,
} from '@edanalytics/models';
import { EntityQueryBuilder } from './builder';
import { schoolYearWithConfigQueries } from './school-year-with-config.queries';

export const odsConfigQueries = new EntityQueryBuilder({ classNamePlural: 'OdsConfigs' })
  .getAll({ ResDto: GetOdsConfigDto })
  .getOne({ ResDto: GetOdsConfigWithSecretDto })
  .put({
    ReqDto: PutOdsConfigDto,
    ResDto: GetOdsConfigWithSecretDto,
    keysToInvalidate: ({ standard }) => [standard, schoolYearWithConfigQueries.queryKey],
  })
  .post({
    ReqDto: PostOdsConfigDto,
    ResDto: GetOdsConfigWithSecretDto,
    keysToInvalidate: ({ standard }) => [standard, schoolYearWithConfigQueries.queryKey],
  })
  .delete({
    keysToInvalidate: ({ standard }) => [standard, schoolYearWithConfigQueries.queryKey],
  })
  .post(
    {
      key: 'testConnection',
      ReqDto: GetOdsConfigDto,
      ResDto: GetOdsConfigDto,
      keysToInvalidate: () => [['ods-configs', 'list']],
    },
    ({ entity }) => `/ods-configs/${entity.id}/test-connection`
  )
  .build();

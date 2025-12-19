import {
  GetOdsConfigDto,
  GetOdsConfigWithSecretDto,
  Id,
  PostOdsConfigDto,
  PutOdsConfigDto,
} from '@edanalytics/models';
import { EntityQueryBuilder } from './builder';

export const odsConfigQueries = new EntityQueryBuilder({ classNamePlural: 'OdsConfigs' })
  .getAll({ ResDto: GetOdsConfigDto })
  .getOne({ ResDto: GetOdsConfigWithSecretDto })
  .put({ ReqDto: PutOdsConfigDto, ResDto: GetOdsConfigWithSecretDto })
  .post({ ReqDto: PostOdsConfigDto, ResDto: GetOdsConfigWithSecretDto })
  .delete()
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

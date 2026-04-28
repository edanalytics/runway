import {
  GetOdsConfigDto,
  GetOdsConfigWithSecretDto,
  PostOdsConfigDto,
  PutOdsConfigDto,
} from '@edanalytics/models';
import { QueryKey } from '@tanstack/react-query';
import { EntityQueryBuilder } from './builder';

// School year config exposes ODS counts (`odsCount`, `hasOds`), so any ODS write
// must invalidate it alongside the ODS list. Prefix-matches the tenant variant too.
const invalidateOnOdsWrite = ({ standard }: { standard: QueryKey }) => [
  standard,
  ['school-year-config'],
];

export const odsConfigQueries = new EntityQueryBuilder({ classNamePlural: 'OdsConfigs' })
  .getAll({ ResDto: GetOdsConfigDto })
  .getOne({ ResDto: GetOdsConfigWithSecretDto })
  .put({
    ReqDto: PutOdsConfigDto,
    ResDto: GetOdsConfigWithSecretDto,
    keysToInvalidate: invalidateOnOdsWrite,
  })
  .post({
    ReqDto: PostOdsConfigDto,
    ResDto: GetOdsConfigWithSecretDto,
    keysToInvalidate: invalidateOnOdsWrite,
  })
  .delete({ keysToInvalidate: invalidateOnOdsWrite })
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

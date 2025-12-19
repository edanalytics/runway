import { GetUserDto, PostUserDto, PutUserDto } from '@edanalytics/models';
import { EntityQueryBuilder } from './builder';

export const userQueries = new EntityQueryBuilder({ classNamePlural: 'Users' })
  .getAll({ ResDto: GetUserDto })
  .getOne({ ResDto: GetUserDto })
  .put({ ReqDto: PutUserDto, ResDto: GetUserDto })
  .post({ ReqDto: PostUserDto, ResDto: GetUserDto })
  .delete()
  .build();

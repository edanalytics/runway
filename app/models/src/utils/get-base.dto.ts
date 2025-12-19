import type { IUser } from '../interfaces';
import { Expose, Type } from 'class-transformer';

/**
 * The naive way to type the class-transformer deserializer would be to expect the base object to include all relevant properties.
 * However, the getters should be omitted because they're supplied by the class prototype rather than the serialized values. So
 * this is just a typing utility to exclude getters from a GetDto typing annotation.
 */
export type GettersOmit =
  | 'displayName'
  | 'createdOn'
  | 'createdById'
  | 'modifiedOn'
  | 'modifiedById';

export type GetDto<EntityInterface extends object, ExcludeProperties extends string = never> = Omit<
  EntityInterface & {
    displayName: string;
    id: string | number;
  },
  ExcludeProperties
>;

export class DtoGetBase {
  @Expose()
  @Type(() => Date)
  createdOn: Date;

  @Expose()
  createdById: IUser['id'] | null;

  @Expose()
  @Type(() => Date)
  modifiedOn: Date;

  @Expose()
  modifiedById: IUser['id'] | null;
}

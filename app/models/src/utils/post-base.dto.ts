import { IEntityBase } from './entity-base.interface';

type DtoCreateOmit = 'id' | 'createdById' | 'modifiedById' | 'createdOn' | 'modifiedOn' | 'deleted';

/**
 * Type helper to create an interface typing for a Post DTO by omitting specific properties from the main entity interface.
 */
export type PostDto<
  EntityInterface extends object,
  ExcludeProperties extends string = never
> = Omit<EntityInterface, DtoCreateOmit | ExcludeProperties> & {
  createdById?: number | undefined;
};
export class DtoPostBase implements Partial<Omit<IEntityBase, DtoCreateOmit>> {}

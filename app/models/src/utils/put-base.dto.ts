import { IEntityBase } from './entity-base.interface';

/**
 * Exclude id because validation done on ID in the route.
 * Having it on the route and the object introduces potential for bugs
 */
type DtoWriteOmit = 'id' | 'createdById' | 'modifiedById' | 'createdOn' | 'modifiedOn';

export type PutDto<EntityInterface extends object, ExcludeProperties extends string = never> = Omit<
  EntityInterface,
  DtoWriteOmit | ExcludeProperties
>;

export class DtoPutBase implements Omit<IEntityBase, DtoWriteOmit> {}

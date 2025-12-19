import { IUser } from '../interfaces/user.interface';

export interface IEntityBase {
  id: number;
  createdOn: Date;
  createdById: IUser['id'] | null;
  modifiedOn: Date;
  modifiedById: IUser['id'] | null;
}

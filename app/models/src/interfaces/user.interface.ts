import type { User } from '@prisma/client';
import { IEntityBase } from '../utils';

export interface IUser extends User, IEntityBase {}

import { SetMetadata } from '@nestjs/common';
import { PrivilegeKey } from 'models/src/dtos/privileges';

export const ALLOW_METATENANT = 'allowMetatenant';
export const AllowMetatenant = (privilege: PrivilegeKey | null) => SetMetadata(ALLOW_METATENANT, privilege);

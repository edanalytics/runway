import { SetMetadata } from '@nestjs/common';
import { PrivilegeKey } from 'models/src/dtos/privileges';

export const AUTHORIZE_KEY = 'authorize_rule';

export const Authorize = (privilege: PrivilegeKey | null) => SetMetadata(AUTHORIZE_KEY, privilege);

import { Tenant, User } from '@prisma/client';
import { SessionData } from 'express-session';
import { WithoutAudit } from '../../fixtures/utils/created-modified';

export const sessionData = (
  user: WithoutAudit<User>,
  tenant: WithoutAudit<Tenant>
): SessionData => {
  return {
    cookie: {
      originalMaxAge: 1000 * 60 * 60 * 24 * 30,
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      httpOnly: true,
      secure: false,
    },
    passport: {
      user: {
        user: user as User,
        tenant: tenant as Tenant,
        idpSessionId: `${user.idpId}-${user.id}-${tenant.code}`,
        idToken: `id_token_${user.idpId}-${user.id}-${tenant.code}`,
        //Todo: update this when writing role tests
        roles: [],
      },
    },
  };
};

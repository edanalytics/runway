import { Tenant, User } from '@prisma/client';

/**
 * This interface describes the full session object stored in the DB
 * and that you can manipulate via req.session in controllers.
 */
export interface ISession {
  passport?: {
    user: IPassportSession;
  };
}

/**
 * This interface is the piece of the overall session that is managed
 * by passport. It is initially populated with the value passed to the
 * `done` callback in the passport strategy. NestJS makes it available
 * via req.user in controllers.
 */
export interface IPassportSession {
  user: User;
  tenant: Tenant;
  idpSessionId: string | null;
  idToken: string | null;
}

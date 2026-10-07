import { IPassportSession, ISession } from '@edanalytics/models';

declare module 'express-session' {
  interface SessionData extends ISession {}
}

// Nest puts the passport session in request.user, so let's give it a type.
// We augment the global Express.User interface (passport's own extension point)
// rather than express-serve-static-core's Request: @types/express v5 nests its
// own copy of express-serve-static-core, so augmenting the bare specifier lands
// on whichever copy npm happens to hoist rather than the one express.Request
// actually extends.
declare global {
  namespace Express {
    interface User extends IPassportSession {}
  }
}

export {};

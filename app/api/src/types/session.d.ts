import { IPassportSession, ISession } from '@edanalytics/models';

declare module 'express-session' {
  interface SessionData extends ISession {}
}

// Nest puts the passport session in request.user, so let's give it a type
declare module 'express-serve-static-core' {
  interface Request {
    user: IPassportSession;
  }
}

export {};

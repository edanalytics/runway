import { pool } from '../db/client';
import pgSession from 'connect-pg-simple';
import expressSession, { SessionData } from 'express-session';
import { once } from 'lodash';

// Call init from global setup to ensure there's no race condition
// on table-creation in parallel test running processes
const initSessionStore = once(async () => {
  const pgPool = pool();
  await pgPool.query('create schema if not exists appsession');

  // The session table is created lazily on the first query so
  // we set and remove a dummy session to create it. Note that we could
  // create the table ourselves, like we do the schema, but this way we
  // keep in synch with the definition connect-pg-simple uses. It's unlikely
  // to change and unlikely to cause an issue if it does, but in that unlikely
  // circumstance, it'd be a pain to debug.
  await upsertSession('touch-on-init', {} as SessionData);
  await destroySession('touch-on-init');
});

const sessionStore = once(
  () =>
    new (pgSession(expressSession))({
      createTableIfMissing: true,
      pool: pool(),
      schemaName: 'appsession',
    })
);

const getSession = async (sid: string) => {
  return new Promise<SessionData | null | undefined>((resolve, reject) => {
    sessionStore().get(sid, (err, session) => {
      if (err) {
        reject(err);
      } else {
        resolve(session);
      }
    });
  });
};

const upsertSession = async (sid: string, session: SessionData) => {
  return new Promise<SessionData>((resolve, reject) => {
    sessionStore().set(sid, session, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(session);
      }
    });
  });
};

const destroySession = async (sid: string) => {
  return new Promise((resolve, reject) => {
    sessionStore().destroy(sid, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(sid);
      }
    });
  });
};

export default {
  get: getSession,
  set: upsertSession,
  destroy: destroySession,
  init: initSessionStore,
  client: sessionStore,
};

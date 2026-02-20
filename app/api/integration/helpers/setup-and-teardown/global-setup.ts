import { loadEnvVars } from './tasks/load-env-vars';
import { db } from '../db/container';
import { runMigrations } from './tasks/run-migrations';
import { refreshSeed } from './tasks/seed-data';
import sessionStore from '../session/session-store';

// Jest expects commonjs modules.exports
module.exports = async () => {
  loadEnvVars();
  await db.up();
  await sessionStore.init();
  await runMigrations(); // seed data is refreshed before each test
};

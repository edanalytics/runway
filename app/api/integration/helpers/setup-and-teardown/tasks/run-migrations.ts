/* eslint-disable */
import { join } from 'path';
import type PostgratorConstructor from 'postgrator';
import { pool } from '../../db/client';

export const runMigrations = async () => {
  try {
    // Need a dynamic import here because postgrator is an ESM module while
    // jest runs in a CJS environment. Additionally, we need the weird Function
    // wrapper to prevent the dynamic import from getting compiled to a require, which
    // Postgrator won't respond to (and prevents the test suite from running)
    // Note that if we attempt to run migrations as part of setupFiles (vs. globalSetup),
    // we need the --experimental-vm-modules flag since setupFiles run in a vm context
    // (or we need to run migrations as a separate .mjs script)
    const Postgrator = (await new Function('path', 'return import(path)')('postgrator'))
      .default as typeof PostgratorConstructor;

    const pgClient = pool();
    const migrationPattern = join(__dirname, '/../../../../src/database/postgrator/migrations/*');

    const postgrator = new Postgrator({
      migrationPattern,
      driver: 'pg',
      database: process.env.POSTGRES_DB,
      schemaTable: 'schemaversion',
      execQuery: (query) => pgClient.query(query),
    });

    await postgrator.migrate();
  } catch (error: any) {
    console.error(error, error?.appliedMigrations);
    throw new Error('Migrations failed to run.');
  }
};

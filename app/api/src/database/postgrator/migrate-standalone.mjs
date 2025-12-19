import dotenv from 'dotenv';

if (!process.cwd().endsWith('/api')) process.chdir('./api/');
dotenv.config();

import pg from 'pg';
import Postgrator from 'postgrator';

const pgClient = new pg.Client({
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
  host: 'localhost',
});
pgClient.connect().then(async () => {
  try {
    const postgrator = new Postgrator({
      migrationPattern: import.meta.dirname + '/migrations/*',
      driver: 'pg',
      database: process.env.POSTGRES_DB,
      schemaTable: 'schemaversion',
      execQuery: (query) => pgClient.query(query),
    });

    console.log(`Found ${(await postgrator.getMigrations()).length} migrations.`);

    const appliedMigrations = await postgrator.migrate();
    console.log(`Ran ${appliedMigrations.length} migrations:`, appliedMigrations);
    await pgClient.end();
    process.exit(0);
  } catch (error) {
    console.log(error);
    pgClient.end();
    process.exit(1);
  }
});

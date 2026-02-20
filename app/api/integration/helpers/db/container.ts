/* eslint-disable */
import { execSync } from 'child_process';
import { join } from 'path';

const dockerComposePath = join(__dirname, './docker-compose.test.yml');
const projectArgs = '--project-name runway_app_test';

const up = async () => {
  console.log('Setting up test database...');

  const { POSTGRES_USER, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_DB) {
    throw new Error('.env.test must be loaded before running this script');
  }

  try {
    // Start the test database if not already running, and wait for it to be ready.
    // This is intentionally idempotent — if the container is already healthy it's a no-op.
    console.log('Starting test database container...');
    execSync(`docker compose ${projectArgs} -f ${dockerComposePath} up -d --wait`, {
      stdio: 'inherit',
      cwd: join(__dirname, '../..'),
    });

    console.log('Test database is ready!');
  } catch (error) {
    console.error('Failed to set up test database:', error);
    throw error;
  }
};

const down = async () => {
  try {
    console.log('Stopping test database container...');
    execSync(`docker compose ${projectArgs} -f ${dockerComposePath} down -v`, {
      stdio: 'inherit',
      cwd: join(__dirname, '../..'),
    });
    console.log('Test database stopped and cleaned up.\n');
  } catch (error) {
    console.error('Error stopping test database:', error);
  }
};

export const db = { up, down };

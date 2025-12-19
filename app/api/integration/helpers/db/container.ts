/* eslint-disable */
import { execSync } from 'child_process';
import { join } from 'path';

const dockerComposePath = join(__dirname, './docker-compose.test.yml');

const up = async () => {
  console.log('Setting up test database...');

  const { POSTGRES_USER, POSTGRES_DB } = process.env;
  if (!POSTGRES_USER || !POSTGRES_DB) {
    throw new Error('.env.test must be loaded before running this script');
  }

  try {
    // Stop any existing test database
    try {
      execSync(`docker compose -f ${dockerComposePath} down`, { stdio: 'pipe' });
      console.log('Removed existing test database container');
    } catch (e) {
      // Ignore if nothing to stop
    }

    // Start the test database and wait for it to be ready
    console.log('Starting test database container...');
    execSync(`docker compose -f ${dockerComposePath} up -d --wait`, {
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
    execSync(`docker compose -f ${dockerComposePath} down -v`, {
      stdio: 'inherit',
      cwd: join(__dirname, '../..'),
    });
    console.log('Test database stopped and cleaned up.\n');
  } catch (error) {
    console.error('Error stopping test database:', error);
  }
};

export const db = { up, down };

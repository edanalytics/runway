import { config } from 'dotenv';
import fs from 'fs';
import { join } from 'path';

export const loadEnvVars = () => {
  try {
    const envPath = join(__dirname, '../../../../.env.test');
    // .env.test should always exist... but if we move files around it's
    // easy to forget to update the path in this file so we check for it here.
    if (!fs.existsSync(envPath)) {
      throw new Error('unable to read env file');
    }

    console.log('🔄 Loading env vars from', envPath);
    config({ path: envPath, override: true });
    console.log('✅ Env vars loaded');
  } catch (error) {
    console.error('❌ Failed to load env vars:', error);
    throw error;
  }
};

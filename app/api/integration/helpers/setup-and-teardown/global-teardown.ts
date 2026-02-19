/* eslint-disable */
import { db } from '../db/container';
import { pool } from '../db/client';

module.exports = async function () {
  try {
    console.log('🧹 Starting global teardown...');

    await pool().end();
    // Leave the container running when INTEGRATION_TEST_KEEP_DB_CONTAINER is set —
    // used by api:test:integration:local for faster local iteration.
    if (!process.env.INTEGRATION_TEST_KEEP_DB_CONTAINER) {
      await db.down();
    }

    console.log('✅ Global teardown complete');
  } catch (error) {
    console.error('❌ Error during teardown:', error);
    throw error;
  }
};

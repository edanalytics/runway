/* eslint-disable */
import { db } from '../db/container';
import { pool } from '../db/client';

module.exports = async function () {
  try {
    console.log('🧹 Starting global teardown...');

    await pool().end();
    await db.down();

    console.log('✅ Global teardown complete');
  } catch (error) {
    console.error('❌ Error during teardown:', error);
    throw error;
  }
};

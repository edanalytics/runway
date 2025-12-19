import { prismaClient, pool } from '../db/client';
import { initApp } from './tasks/init-app';

beforeAll(async () => {
  global.prisma = prismaClient();
  global.app = await initApp();
});

afterAll(async () => {
  await global.app.close();
  await global.prisma.$disconnect();
  await pool().end();
});

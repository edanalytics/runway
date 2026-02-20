import { prismaClient, pool } from '../db/client';
import { initApp } from './tasks/init-app';
import { refreshSeed } from './tasks/seed-data';

beforeAll(async () => {
  global.prisma = prismaClient();
  global.app = await initApp();
});

beforeEach(async () => {
  await refreshSeed();
});

afterAll(async () => {
  await global.app.close();
  await global.prisma.$disconnect();
  await pool().end();
});

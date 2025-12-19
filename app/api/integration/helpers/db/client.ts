import pg from 'pg';
import { once } from 'lodash';
import { PrismaClient } from '@prisma/client';

export const pool = once(
  () =>
    new pg.Pool({
      user: process.env.POSTGRES_USER,
      host: process.env.POSTGRES_HOST,
      database: process.env.POSTGRES_DB,
      password: process.env.POSTGRES_PASSWORD,
      port: Number(process.env.POSTGRES_PORT),
    })
);

export const prismaClient = once(() => {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB } =
    process.env;

  const url = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
  return new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
  });
});

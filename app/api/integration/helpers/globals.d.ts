import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Global type declarations for integration tests
declare global {
  var __TEARDOWN_MESSAGE__: string;
  var app: INestApplication;
  var prisma: PrismaClient;
}

// This export is required to make this file a module
export {};

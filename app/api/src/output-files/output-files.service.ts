import { Inject, Injectable } from '@nestjs/common';
import type { Job, PrismaClient } from '@prisma/client';
import { PRISMA_READ_ONLY } from '../database';

@Injectable()
export class OutputFilesService {
  constructor(@Inject(PRISMA_READ_ONLY) private prisma: PrismaClient) {}

  async findByJobId(jobId: Job['id']) {
    return this.prisma.runOutputFile.findMany({
      where: { run: { jobId } },
      orderBy: { runId: 'desc' },
    });
  }
}

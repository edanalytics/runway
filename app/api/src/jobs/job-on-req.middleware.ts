import {
  BadRequestException,
  Inject,
  Injectable,
  NestMiddleware,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction } from 'express';
import { Request, Response } from 'express';
import { PRISMA_READ_ONLY } from '../database';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AddJobToReqMiddleware implements NestMiddleware {

  constructor(@Inject(PRISMA_READ_ONLY) private prisma: PrismaClient) { }
  async use(req: Request, res: Response, next: NextFunction) {
    if (!req.isAuthenticated()) {
      throw new UnauthorizedException()
    }
    const id = parseInt(req.params.jobId, 10);
    if (!id) {
      throw new BadRequestException('Invalid parameter for :jobId');
    }

    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`No job found for ID: ${id}`);
    }

    req.job = job;
    next();
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { IdMatchingMode, PrismaClient } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';
import { IdrsReadinessService } from '../idrs/idrs-readiness.service';

@Injectable()
export class PartnerMatchingModeService {
  constructor(
    @Inject(PRISMA_APP_USER) private readonly prisma: PrismaClient,
    private readonly readiness: IdrsReadinessService
  ) {}

  async update(partnerId: string, idMatchingMode: IdMatchingMode) {
    if (idMatchingMode !== 'id_based') {
      const result = await this.readiness.checkPartner(partnerId);
      if (result.status === 'ERROR') return result;
    }
    const data = await this.prisma.partner.update({
      where: { id: partnerId },
      data: { idMatchingMode },
      select: { idMatchingMode: true },
    });
    return { status: 'SUCCESS', data } as const;
  }
}

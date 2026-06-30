import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Tenant } from '@prisma/client';
import { AppConfigService, UmConfig } from '../../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../../database/database.service';
import { PgBossService } from '../../pg-boss/pg-boss.service';
import { TenantUpsert, UserManagementPartner, UserManagementTenant } from './um-sync.types';
import { GetTenantDto } from 'models/src/dtos/tenant.dto';

@Injectable()
export class UmSyncHandler implements OnModuleInit {
  readonly sourceKey = 'user_management_sync';

  private readonly logger = new Logger(UmSyncHandler.name);
  private alToken: string | null = null;
  private alTokenExpiration: Date | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pgBoss: PgBossService,
    @Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient
  ) {}

  async onModuleInit() {
    const config = await this.appConfig.UmConfig();
    if (!config) {
      this.logger.warn(`${this.sourceKey} config not set — unscheduling any existing job`);
      await this.pgBoss.boss.unschedule(this.sourceKey);
      return;
    }

    await this.pgBoss.boss.createQueue(this.sourceKey);
    await this.pgBoss.boss.schedule(this.sourceKey, config.syncCron, null, {
      singletonKey: this.sourceKey,
    });
    await this.pgBoss.boss.work(this.sourceKey, () => this.sync());
    this.logger.log(`${this.sourceKey} sync scheduled: ${config.syncCron}`);
  }

  async sync(): Promise<void> {
    const config = await this.appConfig.UmConfig();
    if (!config) {
      this.logger.warn('UM sync config not set — skipping sync');
      return;
    }
    await this.runSync(config);
  }

  private async getToken(
    umConfig: UmConfig
  ): Promise<{ status: 'success' } | { status: 'failure' }> {
    try {
      const response = await fetch(`https://${umConfig.auth0Domain}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: umConfig.clientId,
          client_secret: umConfig.clientSecret,
          audience: umConfig.audience,
        }),
      });

      if (!response.ok) {
        this.logger.error(`Failed to get UM token: ${response.status} ${response.statusText}`);
        return { status: 'failure' };
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };
      this.alToken = data.access_token;
      this.alTokenExpiration = new Date(Date.now() + data.expires_in * 1000);
      return { status: 'success' };
    } catch (error) {
      this.logger.error('Error fetching UM token', error);
      return { status: 'failure' };
    }
  }

  private async ensureToken(
    umConfig: UmConfig
  ): Promise<{ status: 'success' } | { status: 'failure' }> {
    if (!this.alToken || !this.alTokenExpiration || this.alTokenExpiration < new Date()) {
      return this.getToken(umConfig);
    }
    return { status: 'success' };
  }

  private async umRequest(
    umConfig: UmConfig,
    path: string,
    searchParams?: Record<string, string>
  ): Promise<{ status: 'success'; data: unknown } | { status: 'failure' }> {
    const tokenResult = await this.ensureToken(umConfig);
    if (tokenResult.status === 'failure') {
      return { status: 'failure' };
    }

    const url = new URL(`${umConfig.url}/api/v1/${path}`);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => url.searchParams.append(key, value));
    }

    let response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.alToken}` },
    });

    if (response.status === 401) {
      const refreshResult = await this.getToken(umConfig);
      if (refreshResult.status === 'failure') {
        return { status: 'failure' };
      }
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.alToken}` },
      });
    }

    if (response.ok) {
      return { status: 'success', data: await response.json() };
    }

    this.logger.warn(`UM request to ${url} failed with ${response.status}: ${response.statusText}`);
    return { status: 'failure' };
  }

  private async getPartners(
    umConfig: UmConfig
  ): Promise<{ status: 'success'; partners: UserManagementPartner[] } | { status: 'failure' }> {
    const result = await this.umRequest(umConfig, 'partners');
    if (result.status !== 'success') {
      this.logger.error('Failed to fetch partners from AL');
      return { status: 'failure' };
    }
    return { status: 'success', partners: result.data as UserManagementPartner[] };
  }

  private async getTenants(
    umConfig: UmConfig,
    partnerCode: string
  ): Promise<{ status: 'success'; tenants: UserManagementTenant[] } | { status: 'failure' }> {
    const result = await this.umRequest(umConfig, 'tenants', { partnerCode });
    if (result.status !== 'success') {
      this.logger.error(`Failed to fetch tenants for partner ${partnerCode} from UM`);
      return { status: 'failure' };
    }
    return { status: 'success', tenants: result.data as UserManagementTenant[] };
  }

  private async runSync(umConfig: UmConfig): Promise<void> {
    try {
      this.logger.log('Starting UM sync');

      const [existingPartners, existingTenants] = await Promise.all([
        this.prisma.partner.findMany(),
        this.prisma.tenant.findMany(),
      ]);

      // Build tenant lookup: partnerId -> tenantCode -> tenant
      const tenantsByPartner = new Map<string, Map<string, GetTenantDto>>();
      for (const partner of existingPartners) {
        tenantsByPartner.set(partner.id, new Map());
      }
      for (const tenant of existingTenants) {
        if (!tenantsByPartner.has(tenant.partnerId)) {
          tenantsByPartner.set(tenant.partnerId, new Map());
        }
        tenantsByPartner.get(tenant.partnerId)!.set(tenant.code, tenant);
      }

      // --- Partner sync ---
      const partnersResult = await this.getPartners(umConfig);

      const partnerIdsToCreate: string[] = [];
      const partnerIdsToDelete: string[] = [];
      const partnerIdsToUndelete: string[] = [];

      if (partnersResult.status === 'success') {
        const existingById = new Map(existingPartners.map((p) => [p.id, p]));
        const apiPartnerCodes = new Set(partnersResult.partners.map((p) => p.partnerCode));

        for (const { partnerCode } of partnersResult.partners) {
          const existing = existingById.get(partnerCode);
          if (!existing) {
            partnerIdsToCreate.push(partnerCode);
            tenantsByPartner.set(partnerCode, new Map());
          } else if (existing.deletedOn) {
            partnerIdsToUndelete.push(partnerCode);
          }
        }

        for (const partner of existingPartners) {
          if (partner.managedBy === this.sourceKey && !partner.deletedOn && !apiPartnerCodes.has(partner.id)) {
            partnerIdsToDelete.push(partner.id);
          }
        }
      } else {
        this.logger.error('Failed to fetch partners from UM — aborting sync');
        return;
      }

      const deletingPartnerIds = new Set(partnerIdsToDelete);

      // --- Tenant sync ---
      const tenantsToCreate: TenantUpsert[] = [];
      const tenantsToDelete: { code: string; partnerId: string }[] = [];
      const tenantsToUndelete: TenantUpsert[] = [];
      const tenantsToUpdate: TenantUpsert[] = [];

      for (const partnerId of partnerIdsToDelete) {
        for (const tenant of tenantsByPartner.get(partnerId)?.values() ?? []) {
          if (!tenant.deletedOn) {
            tenantsToDelete.push({ code: tenant.code, partnerId: tenant.partnerId });
          }
        }
      }

      const partnerIdsForTenantSync = [
        ...existingPartners.filter((p) => p.managedBy === this.sourceKey && !deletingPartnerIds.has(p.id)).map((p) => p.id),
        ...partnerIdsToCreate,
      ];

      await Promise.all(
        partnerIdsForTenantSync.map(async (partnerId) => {
          const result = await this.getTenants(umConfig, partnerId);
          if (result.status !== 'success') {
            return;
          }

          const tenantMap: Map<string, Tenant> = tenantsByPartner.get(partnerId) ?? new Map();
          const umTenantCodes = new Set(result.tenants.map((t) => t.tenantCode));

          for (const apiTenant of result.tenants) {
            const existing = tenantMap.get(apiTenant.tenantCode);
            const isGlobal = apiTenant.isGlobal;
            if (!existing) {
              tenantsToCreate.push({ code: apiTenant.tenantCode, partnerId, isGlobal });
            } else if (existing.deletedOn) {
              tenantsToUndelete.push({ code: existing.code, partnerId: existing.partnerId, isGlobal });
            } else if (existing.isGlobal !== isGlobal) {
              tenantsToUpdate.push({ code: existing.code, partnerId: existing.partnerId, isGlobal });
            }
          }

          for (const [code, tenant] of tenantMap) {
            if (!umTenantCodes.has(code) && !tenant.deletedOn) {
              tenantsToDelete.push({ code: tenant.code, partnerId: tenant.partnerId });
            }
          }
        })
      );

      await this.prisma.$transaction(async (tx) => {
        let partnersCreated = 0;
        let partnersDeleted = 0;
        let partnersUndeleted = 0;
        let tenantsCreated = 0;
        let tenantsDeleted = 0;
        let tenantsUndeleted = 0;

        if (partnerIdsToCreate.length) {
          const r = await tx.partner.createMany({
            data: partnerIdsToCreate.map((id) => ({ id, name: id, managedBy: 'user_management_sync' })),
          });
          partnersCreated = r.count;
        }

        if (partnerIdsToDelete.length) {
          const r = await tx.partner.updateMany({
            where: { id: { in: partnerIdsToDelete } },
            data: { deletedOn: new Date() },
          });
          partnersDeleted = r.count;
        }

        if (partnerIdsToUndelete.length) {
          const r = await tx.partner.updateMany({
            where: { id: { in: partnerIdsToUndelete } },
            data: { deletedOn: null },
          });
          partnersUndeleted = r.count;
        }

        if (tenantsToCreate.length) {
          const r = await tx.tenant.createMany({
            data: tenantsToCreate.map((t) => ({ ...t})),
          });
          tenantsCreated = r.count;
        }

        if (tenantsToDelete.length) {
          const byPartner = new Map<string, string[]>();
          for (const { code, partnerId } of tenantsToDelete) {
            const codes = byPartner.get(partnerId) ?? [];
            codes.push(code);
            byPartner.set(partnerId, codes);
          }
          for (const [partnerId, codes] of byPartner) {
            const r = await tx.tenant.updateMany({
              where: { partnerId, code: { in: codes } },
              data: { deletedOn: new Date() },
            });
            tenantsDeleted += r.count;
          }
        }

        for (const { code, partnerId, isGlobal } of tenantsToUndelete) {
          await tx.tenant.update({
            where: { code_partnerId: { code, partnerId } },
            data: { deletedOn: null, isGlobal },
          });
          tenantsUndeleted++;
        }

        for (const { code, partnerId, isGlobal } of tenantsToUpdate) {
          await tx.tenant.update({
            where: { code_partnerId: { code, partnerId } },
            data: { isGlobal },
          });
        }

        this.logger.log(
          `UM sync: partners +${partnersCreated} -${partnersDeleted} ↑${partnersUndeleted} | ` +
            `tenants +${tenantsCreated} -${tenantsDeleted} ↑${tenantsUndeleted}`
        );
      });

      this.logger.log('UM sync complete');
    } catch (err) {
      this.logger.error('UM sync failed', err);
      throw err;
    }
  }
}

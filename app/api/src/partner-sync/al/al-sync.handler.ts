import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService, AlConfig } from '../../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../../database/database.service';
import { SyncHandler } from '../sync-handler.interface';
import { AlPartner, AlTenant } from './al-sync.types';

@Injectable()
export class AlSyncHandler implements SyncHandler {
  readonly sourceKey = 'al_sync';
  readonly channel = 'app-launcher-sync';

  private readonly logger = new Logger(AlSyncHandler.name);
  private alToken: string | null = null;
  private alTokenExpiration: Date | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    @Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient
  ) {}

  async sync(): Promise<void> {
    const config = this.appConfig.alConfig();
    if (!config) {
      this.logger.warn('AL sync config not set — skipping sync');
      return;
    }
    await this.runSync(config);
  }

  private async getToken(
    alConfig: AlConfig
  ): Promise<{ status: 'success' } | { status: 'failure' }> {
    try {
      const response = await fetch(`https://${alConfig.auth0Domain}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: alConfig.clientId,
          client_secret: alConfig.clientSecret,
          audience: alConfig.audience,
        }),
      });

      if (!response.ok) {
        this.logger.error(`Failed to get AL token: ${response.status} ${response.statusText}`);
        return { status: 'failure' };
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };
      this.alToken = data.access_token;
      this.alTokenExpiration = new Date(Date.now() + data.expires_in * 1000);
      return { status: 'success' };
    } catch (error) {
      this.logger.error('Error fetching AL token', error);
      return { status: 'failure' };
    }
  }

  private async ensureToken(
    alConfig: AlConfig
  ): Promise<{ status: 'success' } | { status: 'failure' }> {
    if (!this.alToken || !this.alTokenExpiration || this.alTokenExpiration < new Date()) {
      return this.getToken(alConfig);
    }
    return { status: 'success' };
  }

  private async alRequest(
    alConfig: AlConfig,
    path: string,
    searchParams?: Record<string, string>
  ): Promise<{ status: 'success'; data: unknown } | { status: 'failure' }> {
    const tokenResult = await this.ensureToken(alConfig);
    if (tokenResult.status === 'failure') {
      return { status: 'failure' };
    }

    const url = new URL(`${alConfig.url}/api/v1/${path}`);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => url.searchParams.append(key, value));
    }

    let response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.alToken}` },
    });

    if (response.status === 401) {
      const refreshResult = await this.getToken(alConfig);
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

    this.logger.warn(`AL request to ${url} failed with ${response.status}: ${response.statusText}`);
    return { status: 'failure' };
  }

  private async getPartners(
    alConfig: AlConfig
  ): Promise<{ status: 'success'; partners: AlPartner[] } | { status: 'failure' }> {
    const result = await this.alRequest(alConfig, 'partners');
    if (result.status !== 'success') {
      this.logger.error('Failed to fetch partners from AL');
      return { status: 'failure' };
    }
    return { status: 'success', partners: result.data as AlPartner[] };
  }

  private async getTenants(
    alConfig: AlConfig,
    partnerCode: string
  ): Promise<{ status: 'success'; tenants: AlTenant[] } | { status: 'failure' }> {
    const result = await this.alRequest(alConfig, 'tenants', { partnerCode });
    if (result.status !== 'success') {
      this.logger.error(`Failed to fetch tenants for partner ${partnerCode} from AL`);
      return { status: 'failure' };
    }
    return { status: 'success', tenants: result.data as AlTenant[] };
  }

  private async runSync(alConfig: AlConfig): Promise<void> {
    try {
      this.logger.log('Starting AL sync');

      const [existingPartners, existingTenants] = await Promise.all([
        this.prisma.partner.findMany(),
        this.prisma.tenant.findMany(),
      ]);

      // Build tenant lookup: partnerId -> tenantCode -> tenant
      const tenantsByPartner = new Map<string, Map<string, (typeof existingTenants)[0]>>();
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
      const partnersResult = await this.getPartners(alConfig);

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
          if (!!partner.managedBy && !partner.deletedOn && !apiPartnerCodes.has(partner.id)) {
            partnerIdsToDelete.push(partner.id);
          }
        }
      }

      const deletingPartnerIds = new Set(partnerIdsToDelete);

      // --- Tenant sync ---
      type TenantUpsert = {
        code: string;
        partnerId: string;
        isGlobal: boolean;
      };
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
        ...existingPartners.filter((p) => !deletingPartnerIds.has(p.id)).map((p) => p.id),
        ...partnerIdsToCreate,
      ];

      await Promise.all(
        partnerIdsForTenantSync.map(async (partnerId) => {
          const result = await this.getTenants(alConfig, partnerId);
          if (result.status !== 'success') {
            return;
          }

          const tenantMap = tenantsByPartner.get(partnerId) ?? new Map();
          const apiCodes = new Set(result.tenants.map((t) => t.tenantCode));

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
            if (!!tenant.managedBy && !apiCodes.has(code) && !tenant.deletedOn) {
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
            data: partnerIdsToCreate.map((id) => ({ id, name: id, managedBy: 'al_sync' })),
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
            data: tenantsToCreate.map((t) => ({ ...t, managedBy: 'al_sync' })),
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
          `AL sync: partners +${partnersCreated} -${partnersDeleted} ↑${partnersUndeleted} | ` +
            `tenants +${tenantsCreated} -${tenantsDeleted} ↑${tenantsUndeleted}`
        );
      });

      this.logger.log('AL sync complete');
    } catch (err) {
      this.logger.error('AL sync failed', err);
      throw err;
    }
  }
}

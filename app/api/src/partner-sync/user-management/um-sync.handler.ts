import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService, UmConfig } from '../../config/app-config.service';
import { PRISMA_ANONYMOUS } from '../../database/database.service';
import { PgBossService } from '../../pg-boss/pg-boss.service';
import { TenantUpsert, UserManagementPartner, UserManagementTenant } from './um-sync.types';

@Injectable()
export class UmSyncHandler implements OnModuleInit {
  readonly sourceKey = 'user_management_sync';

  private readonly logger = new Logger(UmSyncHandler.name);

  private umToken: string | null = null;
  private umTokenExpiration: Date | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pgBoss: PgBossService,
    @Inject(PRISMA_ANONYMOUS) private readonly prisma: PrismaClient
  ) {}

  async onModuleInit() {
    try {
      const config = await this.appConfig.umConfig();
      const syncCron = this.appConfig.get('UM_SYNC_CRON') ?? '0 2 * * *';

      if (!config) {
        this.logger.warn(`${this.sourceKey} config not set — unscheduling any existing job`);
        await this.pgBoss.boss.unschedule(this.sourceKey);
        return;
      }

      await this.pgBoss.boss.createQueue(this.sourceKey);
      await this.pgBoss.boss.schedule(this.sourceKey, syncCron, null, {
        singletonKey: this.sourceKey,
      });
      await this.pgBoss.boss.work(this.sourceKey, () => this.sync());
      this.logger.log(`${this.sourceKey} sync scheduled: ${syncCron}`);
    } catch (err) {
      this.logger.error(`Failed to schedule ${this.sourceKey} sync`, err);
    }
  }

  async sync(): Promise<void> {
    const umConfig = await this.appConfig.umConfig();
    if (!umConfig) {
      this.logger.warn('UM sync config not set — skipping sync');
      return;
    }

    this.logger.log('Starting UM sync');

    const allExistingParnters = await this.prisma.partner.findMany({
      include: { tenant: true },
    });
    const existingById = new Map(allExistingParnters.map((p) => [p.id, p]));

    // --- Partner sync ---
    const partnersResult = await this.umRequest<UserManagementPartner[]>(umConfig, 'partners');

    if (partnersResult.status !== 'success') {
      this.logger.error('Failed to fetch partners from UM — aborting sync');
      return;
    }
    const apiPartnerCodes = new Set(partnersResult.data.map((p) => p.partnerCode));

    const partnerIdsToCreate = partnersResult.data
      .filter((p) => !existingById.has(p.partnerCode))
      .map((p) => p.partnerCode);

    const partnerIdsToDelete: string[] = allExistingParnters
      .filter((p) => !apiPartnerCodes.has(p.id))
      .filter((p) => p.managedBy === this.sourceKey && !p.deletedOn)
      .map((p) => p.id);

    const partnerIdsToUndelete: string[] = partnersResult.data
      .filter((p) => existingById.has(p.partnerCode))
      .filter(
        (p) =>
          existingById.get(p.partnerCode)?.deletedOn &&
          existingById.get(p.partnerCode)?.managedBy === this.sourceKey
      )
      .map((p) => p.partnerCode);

    const deletingPartnerIds = new Set(partnerIdsToDelete);

    // --- Tenant sync ---
    const tenantsToCreate: TenantUpsert[] = [];
    const tenantsToUndelete: TenantUpsert[] = [];
    const tenantsToUpdate: TenantUpsert[] = [];

    const tenantsToDelete: { code: string; partnerId: string }[] = partnerIdsToDelete.flatMap(
      (partnerId) =>
        (existingById.get(partnerId)?.tenant ?? [])
          .filter((tenant) => !tenant.deletedOn)
          .map((tenant) => ({ code: tenant.code, partnerId: tenant.partnerId }))
    );

    const partnerIdsForTenantSync = [
      ...allExistingParnters
        .filter((p) => p.managedBy === this.sourceKey && !deletingPartnerIds.has(p.id))
        .map((p) => p.id),
      ...partnerIdsToCreate,
    ];

    const tenantFetchResults = await Promise.all(
      partnerIdsForTenantSync.map(async (partnerId) => ({
        partnerId,
        result: await this.umRequest<UserManagementTenant[]>(umConfig, 'tenants', {
          partnerCode: partnerId,
        }),
      }))
    );

    for (const { partnerId, result } of tenantFetchResults) {
      if (result.status !== 'success') {
        this.logger.error(`Failed to fetch tenants for partner ${partnerId} from UM`);
        continue;
      }

      const tenantMap = new Map(
        (existingById.get(partnerId)?.tenant ?? []).map((t) => [t.code, t])
      );
      const umTenantCodes = new Set(result.data.map((t) => t.tenantCode));

      for (const apiTenant of result.data) {
        const existing = tenantMap.get(apiTenant.tenantCode);
        const isGlobal = apiTenant.isGlobal;
        if (!existing) {
          tenantsToCreate.push({ code: apiTenant.tenantCode, partnerId, isGlobal });
        } else if (existing.deletedOn) {
          tenantsToUndelete.push({
            code: existing.code,
            partnerId: existing.partnerId,
            isGlobal,
          });
        } else if (existing.isGlobal !== isGlobal) {
          tenantsToUpdate.push({
            code: existing.code,
            partnerId: existing.partnerId,
            isGlobal,
          });
        }
      }

      for (const [code, tenant] of tenantMap) {
        if (!umTenantCodes.has(code) && !tenant.deletedOn) {
          tenantsToDelete.push({ code: tenant.code, partnerId: tenant.partnerId });
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      let partnersCreated = 0;
      let partnersDeleted = 0;
      let partnersUndeleted = 0;
      let tenantsCreated = 0;
      let tenantsDeleted = 0;
      let tenantsUndeleted = 0;

      if (partnerIdsToCreate.length) {
        const r = await tx.partner.createMany({
          data: partnerIdsToCreate.map((id) => ({
            id,
            name: id,
            managedBy: 'user_management_sync',
          })),
        });
        partnersCreated = r.count;
      }

      if (partnerIdsToDelete.length) {
        const r = await tx.partner.updateMany({
          where: { id: { in: partnerIdsToDelete }, managedBy: this.sourceKey },
          data: { deletedOn: new Date() },
        });
        partnersDeleted = r.count;
      }

      if (partnerIdsToUndelete.length) {
        const r = await tx.partner.updateMany({
          where: { id: { in: partnerIdsToUndelete }, managedBy: this.sourceKey },
          data: { deletedOn: null },
        });
        partnersUndeleted = r.count;
      }

      if (tenantsToCreate.length) {
        const r = await tx.tenant.createMany({
          data: tenantsToCreate.map((t) => ({ ...t })),
        });
        tenantsCreated = r.count;
      }

      if (tenantsToDelete.length) {
        for (const { partnerId, code } of tenantsToDelete) {
          const r = await tx.tenant.update({
            where: { code_partnerId: { code, partnerId } },
            data: { deletedOn: new Date() },
          });
          tenantsDeleted++;
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
      this.umToken = data.access_token;
      this.umTokenExpiration = new Date(Date.now() + data.expires_in * 1000);
      return { status: 'success' };
    } catch (error) {
      this.logger.error('Error fetching UM token', error);
      return { status: 'failure' };
    }
  }

  private async ensureToken(
    umConfig: UmConfig
  ): Promise<{ status: 'success' } | { status: 'failure' }> {
    // add 30 second buffer to avoid token expiration during request
    const expirationBufferMs = 30000;
    if (
      !this.umToken ||
      !this.umTokenExpiration ||
      this.umTokenExpiration.getTime() - expirationBufferMs < Date.now()
    ) {
      return this.getToken(umConfig);
    }
    return { status: 'success' };
  }

  private async umRequest<T>(
    umConfig: UmConfig,
    path: string,
    searchParams?: Record<string, string>
  ): Promise<{ status: 'success'; data: T } | { status: 'failure' }> {
    const tokenResult = await this.ensureToken(umConfig);
    if (tokenResult.status === 'failure') {
      return { status: 'failure' };
    }

    const url = new URL(`${umConfig.url}/api/v1/${path}`);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => url.searchParams.append(key, value));
    }

    let response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.umToken}` },
    });

    if (response.status === 401) {
      const refreshResult = await this.getToken(umConfig);
      if (refreshResult.status === 'failure') {
        return { status: 'failure' };
      }
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.umToken}` },
      });
    }

    if (response.ok) {
      return { status: 'success', data: (await response.json()) as T };
    }

    this.logger.warn(`UM request to ${url} failed with ${response.status}: ${response.statusText}`);
    return { status: 'failure' };
  }
}

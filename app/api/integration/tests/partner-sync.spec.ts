import {
  UserManagementTenant,
  UserManagementPartner,
} from 'api/src/partner-sync/user-management/um-sync.types';
import {
  syncPartner,
  gonePartner,
  returningPartner,
  doomedPartner,
  syncPartnerOldTenant,
  syncPartnerReturningTenant,
  syncPartnerReturningTenantWithChangedGlobal,
  syncPartnerUpdateableTenant,
  doomedTenant1,
  doomedTenant2,
} from '../fixtures/context-fixtures/partner-sync-fixtures';
import { UmSyncHandler } from 'api/src/partner-sync/user-management/um-sync.handler';
import { AppConfigService } from 'api/src/config/app-config.service';

const UM_CONFIG = {
  syncCron: '*/5 * * * *',
  url: 'https://um.example.com',
  auth0Domain: 'auth.example.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  audience: 'https://um.example.com',
};

function makeUmTenant(
  partnerCode: string,
  tenantCode: string,
  overrides: Partial<UserManagementTenant> = {}
): UserManagementTenant {
  return {
    partnerCode,
    tenantCode,
    displayName: tenantCode,
    isEnabled: true,
    isGlobal: false,
    ...overrides,
  };
}

function mockUmFetch({
  partners = [] as UserManagementPartner[],
  tenants = {} as Record<string, UserManagementTenant[]>,
  tokenFails = false,
  partnersFail = false,
} = {}): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = (input as RequestInfo | URL).toString();

    if (url.includes('/oauth/token')) {
      if (tokenFails) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    if (url.includes('/api/v1/partners')) {
      if (partnersFail) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(partners), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    if (url.includes('/api/v1/tenants')) {
      const partnerCode = new URL(url).searchParams.get('partnerCode') ?? '';
      return Promise.resolve(
        new Response(JSON.stringify(tenants[partnerCode] ?? []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch call: ${url}`));
  });
}

describe('PartnerSyncService.sync', () => {
  let service: UmSyncHandler;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = app.get(UmSyncHandler);
    // Reset cached token so each test starts with a fresh auth state
    (service as any).umToken = null;
    (service as any).umTokenExpiration = null;
    // UmSyncHandler's AppConfigService is injected via the global ServicesModule,
    // a separate instance from app.get(AppConfigService) — spy on the actual instance it holds.
    jest.spyOn((service as any).appConfig as AppConfigService, 'umConfig').mockResolvedValue(UM_CONFIG);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const sync = () => service.sync();

  describe('partner sync', () => {
    it('creates new partners returned by UM', async () => {
      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'new-partner' }],
        tenants: { 'new-partner': [] },
      });

      await sync();

      const created = await global.prisma.partner.findUnique({ where: { id: 'new-partner' } });
      expect(created).not.toBeNull();
      expect(created?.managedBy).not.toBeNull();
      expect(created?.deletedOn).toBeNull();
    });

    it('soft-deletes sync-managed partners absent from UM', async () => {
      await global.prisma.partner.create({ data: gonePartner });

      fetchSpy = mockUmFetch({ partners: [], tenants: {} });

      await sync();

      const partner = await global.prisma.partner.findUnique({ where: { id: 'gone-partner' } });
      expect(partner?.deletedOn).not.toBeNull();
    });

    it('does not delete non-sync-managed partners absent from UM', async () => {
      // seeded partnerA has managedBy: null — must not be touched
      fetchSpy = mockUmFetch({ partners: [], tenants: {} });

      await sync();

      const partner = await global.prisma.partner.findUnique({ where: { id: 'partner-a' } });
      expect(partner?.deletedOn).toBeNull();
    });

    it('undeletes a sync-managed partner that reappears in UM', async () => {
      await global.prisma.partner.create({ data: returningPartner });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'returning-partner' }],
        tenants: { 'returning-partner': [] },
      });

      await sync();

      const partner = await global.prisma.partner.findUnique({
        where: { id: 'returning-partner' },
      });
      expect(partner?.deletedOn).toBeNull();
    });
  });

  describe('tenant sync', () => {
    it('creates new tenants returned by UM', async () => {
      await global.prisma.partner.create({ data: syncPartner });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [
            makeUmTenant('sync-partner', 'new-tenant', {
              isGlobal: true,
            }),
          ],
        },
      });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'new-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant).not.toBeNull();
      expect(tenant?.isGlobal).toBe(true);
    });

    it('soft-deletes sync-managed tenants absent from UM', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerOldTenant });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: { 'sync-partner': [] },
      });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'old-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.deletedOn).not.toBeNull();
    });

    it('does not delete non-sync-managed tenants absent from UM', async () => {
      fetchSpy = mockUmFetch({ partners: [], tenants: {} });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'tenant-a', partnerId: 'partner-a' } },
      });
      expect(tenant?.deletedOn).toBeNull();
    });

    it('undeletes tenants that reappear in UM', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerReturningTenant });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [makeUmTenant('sync-partner', 'returning-tenant', { isGlobal: true })],
        },
      });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'returning-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.deletedOn).toBeNull();
      expect(tenant?.isGlobal).toBe(true);
    });

    it('updates isGlobal when undeleting a tenant whose isGlobal changed while deleted', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerReturningTenantWithChangedGlobal });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [
            makeUmTenant('sync-partner', 'stale-returning-tenant', { isGlobal: true }),
          ],
        },
      });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: {
          code_partnerId: { code: 'stale-returning-tenant', partnerId: 'sync-partner' },
        },
      });
      expect(tenant?.deletedOn).toBeNull();
      expect(tenant?.isGlobal).toBe(true);
    });

    it('updates isGlobal when it changes', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerUpdateableTenant });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [
            makeUmTenant('sync-partner', 'updateable-tenant', {
              isGlobal: true,
            }),
          ],
        },
      });

      await sync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'updateable-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.isGlobal).toBe(true);
    });

    it('soft-deletes all tenants when their sync-managed partner is deleted', async () => {
      await global.prisma.partner.create({ data: doomedPartner });
      await global.prisma.tenant.createMany({ data: [doomedTenant1, doomedTenant2] });

      // UM no longer knows about this partner
      fetchSpy = mockUmFetch({ partners: [], tenants: {} });

      await sync();

      const tenants = await global.prisma.tenant.findMany({
        where: { partnerId: 'doomed-partner' },
      });
      expect(tenants).toHaveLength(2);
      expect(tenants.every((t) => t.deletedOn !== null)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('makes no DB changes when the token fetch fails', async () => {
      await global.prisma.partner.create({ data: syncPartner });

      fetchSpy = mockUmFetch({ tokenFails: true });

      await sync();

      // sync-managed partner must not be soft-deleted when we cannot reach UM
      const partner = await global.prisma.partner.findUnique({ where: { id: 'sync-partner' } });
      expect(partner?.deletedOn).toBeNull();
    });

    it('makes no DB changes when the partners fetch fails', async () => {
      await global.prisma.partner.create({ data: syncPartner });

      fetchSpy = mockUmFetch({ partnersFail: true });

      await sync();

      // sync-managed partner must not be soft-deleted when we cannot reach UM
      const partner = await global.prisma.partner.findUnique({ where: { id: 'sync-partner' } });
      expect(partner?.deletedOn).toBeNull();
    });
  });
});

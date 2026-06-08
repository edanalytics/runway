import { PartnerSyncService } from '../../src/partner-sync/partner-sync.service';
import { AlPartner, AlTenant } from '../../src/partner-sync/app-launcher.types';
import {
  syncPartner,
  gonePartner,
  returningPartner,
  doomedPartner,
  syncPartnerOldTenant,
  syncPartnerReturningTenant,
  syncPartnerUpdateableTenant,
  doomedTenant1,
  doomedTenant2,
} from '../fixtures/context-fixtures/partner-sync-fixtures';

const AL_CONFIG = {
  syncCron: '*/5 * * * *',
  url: 'https://al.example.com',
  auth0Domain: 'auth.example.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  audience: 'https://al.example.com',
};

function makeAlTenant(
  partnerCode: string,
  tenantCode: string,
  overrides: Partial<AlTenant> = {}
): AlTenant {
  return {
    partnerCode,
    tenantCode,
    displayName: tenantCode,
    isEnabled: true,
    isGlobal: false,
    children: null,
    ...overrides,
  };
}

function mockAlFetch({
  partners = [] as AlPartner[],
  tenants = {} as Record<string, AlTenant[]>,
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
  let service: PartnerSyncService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = app.get(PartnerSyncService);
    // Reset cached token so each test starts with a fresh auth state
    (service as any).alToken = null;
    (service as any).alTokenExpiration = null;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  const runSync = () => (service as any).sync(AL_CONFIG);

  describe('partner sync', () => {
    it('creates new partners returned by AL', async () => {
      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'new-partner' }],
        tenants: { 'new-partner': [] },
      });

      await runSync();

      const created = await global.prisma.partner.findUnique({ where: { id: 'new-partner' } });
      expect(created).not.toBeNull();
      expect(created?.syncManaged).toBe(true);
      expect(created?.deletedOn).toBeNull();
    });

    it('soft-deletes sync-managed partners absent from AL', async () => {
      await global.prisma.partner.create({ data: gonePartner });

      fetchSpy = mockAlFetch({ partners: [], tenants: {} });

      await runSync();

      const partner = await global.prisma.partner.findUnique({ where: { id: 'gone-partner' } });
      expect(partner?.deletedOn).not.toBeNull();
    });

    it('does not delete non-sync-managed partners absent from AL', async () => {
      // seeded partnerA has syncManaged: false — must not be touched
      fetchSpy = mockAlFetch({ partners: [], tenants: {} });

      await runSync();

      const partner = await global.prisma.partner.findUnique({ where: { id: 'partner-a' } });
      expect(partner?.deletedOn).toBeNull();
    });

    it('undeletes a sync-managed partner that reappears in AL', async () => {
      await global.prisma.partner.create({ data: returningPartner });

      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'returning-partner' }],
        tenants: { 'returning-partner': [] },
      });

      await runSync();

      const partner = await global.prisma.partner.findUnique({
        where: { id: 'returning-partner' },
      });
      expect(partner?.deletedOn).toBeNull();
    });
  });

  describe('tenant sync', () => {
    it('creates new tenants returned by AL', async () => {
      await global.prisma.partner.create({ data: syncPartner });

      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [
            makeAlTenant('sync-partner', 'new-tenant', {
              isGlobal: true,
              children: [{ tenantCode: 'child-1' }],
            }),
          ],
        },
      });

      await runSync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'new-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant).not.toBeNull();
      expect(tenant?.syncManaged).toBe(true);
      expect(tenant?.isGlobal).toBe(true);
      expect(tenant?.children).toEqual(['child-1']);
    });

    it('soft-deletes sync-managed tenants absent from AL', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerOldTenant });

      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: { 'sync-partner': [] },
      });

      await runSync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'old-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.deletedOn).not.toBeNull();
    });

    it('does not delete non-sync-managed tenants absent from AL', async () => {
      // seeded tenantA has syncManaged: false — must not be touched
      fetchSpy = mockAlFetch({ partners: [], tenants: {} });

      await runSync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'tenant-a', partnerId: 'partner-a' } },
      });
      expect(tenant?.deletedOn).toBeNull();
    });

    it('undeletes tenants that reappear in AL', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerReturningTenant });

      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [makeAlTenant('sync-partner', 'returning-tenant', { isGlobal: true })],
        },
      });

      await runSync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'returning-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.deletedOn).toBeNull();
      expect(tenant?.isGlobal).toBe(true);
    });

    it('updates children and isGlobal when they change', async () => {
      await global.prisma.partner.create({ data: syncPartner });
      await global.prisma.tenant.create({ data: syncPartnerUpdateableTenant });

      fetchSpy = mockAlFetch({
        partners: [{ partnerCode: 'sync-partner' }],
        tenants: {
          'sync-partner': [
            makeAlTenant('sync-partner', 'updateable-tenant', {
              isGlobal: true,
              children: [{ tenantCode: 'new-child' }],
            }),
          ],
        },
      });

      await runSync();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'updateable-tenant', partnerId: 'sync-partner' } },
      });
      expect(tenant?.isGlobal).toBe(true);
      expect(tenant?.children).toEqual(['new-child']);
    });

    it('soft-deletes all tenants when their sync-managed partner is deleted', async () => {
      await global.prisma.partner.create({ data: doomedPartner });
      await global.prisma.tenant.createMany({ data: [doomedTenant1, doomedTenant2] });

      // AL no longer knows about this partner
      fetchSpy = mockAlFetch({ partners: [], tenants: {} });

      await runSync();

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

      fetchSpy = mockAlFetch({ tokenFails: true });

      await runSync();

      // sync-managed partner must not be soft-deleted when we cannot reach AL
      const partner = await global.prisma.partner.findUnique({ where: { id: 'sync-partner' } });
      expect(partner?.deletedOn).toBeNull();
    });

    it('makes no DB changes when the partners fetch fails', async () => {
      await global.prisma.partner.create({ data: syncPartner });

      fetchSpy = mockAlFetch({ partnersFail: true });

      await runSync();

      // sync-managed partner must not be soft-deleted when we cannot reach AL
      const partner = await global.prisma.partner.findUnique({ where: { id: 'sync-partner' } });
      expect(partner?.deletedOn).toBeNull();
    });
  });
});

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
  unmanagedDeletedPartner,
  allActionsPartner,
  allActionsTenantToDelete,
  allActionsTenantToUndelete,
  allActionsTenantToUpdate,
  allActionsTenantUnchanged,
  concurrentPartnerOne,
  concurrentPartnerTwo,
  partialFailurePartnerOk,
  partialFailurePartnerFail,
  partialFailureExistingTenant,
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
    isGlobal: false,
    ...overrides,
  };
}

function mockUmFetch({
  partners = [] as UserManagementPartner[],
  tenants = {} as Record<string, UserManagementTenant[]>,
  tokenFails = false,
  partnersFail = false,
  tenantsFail = [] as string[],
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
      if (tenantsFail.includes(partnerCode)) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
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

    it('does not touch a non-sync-managed partner returned by UM', async () => {
      // seeded partnerA has managedBy: null — UM returning its code must not create/modify it
      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'partner-a' }],
        tenants: {},
      });

      await sync();

      const partner = await global.prisma.partner.findUnique({ where: { id: 'partner-a' } });
      expect(partner?.managedBy).toBeNull();
      expect(partner?.deletedOn).toBeNull();
    });

    it('does not undelete a soft-deleted non-sync-managed partner returned by UM', async () => {
      await global.prisma.partner.create({ data: unmanagedDeletedPartner });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'unmanaged-deleted-partner' }],
        tenants: {},
      });

      await sync();

      const partner = await global.prisma.partner.findUnique({
        where: { id: 'unmanaged-deleted-partner' },
      });
      expect(partner?.managedBy).toBeNull();
      expect(partner?.deletedOn).not.toBeNull();
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

    it('creates tenants for a partner that UM returns as new in the same sync', async () => {
      // 'brand-new-partner' is not seeded — it's created by this same sync run
      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'brand-new-partner' }],
        tenants: {
          'brand-new-partner': [
            makeUmTenant('brand-new-partner', 'brand-new-tenant', { isGlobal: true }),
          ],
        },
      });

      await sync();

      const partner = await global.prisma.partner.findUnique({
        where: { id: 'brand-new-partner' },
      });
      expect(partner).not.toBeNull();

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'brand-new-tenant', partnerId: 'brand-new-partner' } },
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

    it('does not request or create tenants for a partner UM does not manage', async () => {
      // seeded partnerA has managedBy: null — its tenants must be untouched even if
      // UM's tenants endpoint would return some for it
      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'partner-a' }],
        tenants: {
          'partner-a': [makeUmTenant('partner-a', 'unwanted-tenant')],
        },
      });

      await sync();

      const tenantRequests = fetchSpy.mock.calls.filter(([input]: [RequestInfo | URL]) =>
        input.toString().includes('/api/v1/tenants?partnerCode=partner-a')
      );
      expect(tenantRequests).toHaveLength(0);

      const tenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'unwanted-tenant', partnerId: 'partner-a' } },
      });
      expect(tenant).toBeNull();
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

    it('handles creation, deletion, undeletion, and isGlobal updates together for one partner', async () => {
      await global.prisma.partner.create({ data: allActionsPartner });
      await global.prisma.tenant.createMany({
        data: [
          allActionsTenantToDelete,
          allActionsTenantToUndelete,
          allActionsTenantToUpdate,
          allActionsTenantUnchanged,
        ],
      });

      fetchSpy = mockUmFetch({
        partners: [{ partnerCode: 'all-actions-partner' }],
        tenants: {
          // 'all-actions-to-delete' is intentionally absent from the UM response
          'all-actions-partner': [
            makeUmTenant('all-actions-partner', 'all-actions-to-undelete', { isGlobal: true }),
            makeUmTenant('all-actions-partner', 'all-actions-to-update', { isGlobal: true }),
            makeUmTenant('all-actions-partner', 'all-actions-unchanged', { isGlobal: true }),
            makeUmTenant('all-actions-partner', 'all-actions-new', { isGlobal: false }),
          ],
        },
      });

      await sync();

      const tenants = await global.prisma.tenant.findMany({
        where: { partnerId: 'all-actions-partner' },
      });
      const byCode = new Map(tenants.map((t) => [t.code, t]));

      expect(byCode.get('all-actions-to-delete')?.deletedOn).not.toBeNull();

      expect(byCode.get('all-actions-to-undelete')?.deletedOn).toBeNull();
      expect(byCode.get('all-actions-to-undelete')?.isGlobal).toBe(true);

      expect(byCode.get('all-actions-to-update')?.deletedOn).toBeNull();
      expect(byCode.get('all-actions-to-update')?.isGlobal).toBe(true);

      expect(byCode.get('all-actions-unchanged')?.deletedOn).toBeNull();
      expect(byCode.get('all-actions-unchanged')?.isGlobal).toBe(true);

      expect(byCode.get('all-actions-new')).not.toBeUndefined();
      expect(byCode.get('all-actions-new')?.deletedOn).toBeNull();
      expect(byCode.get('all-actions-new')?.isGlobal).toBe(false);
    });

    it('syncs tenants independently for multiple partners in a single run', async () => {
      await global.prisma.partner.createMany({ data: [concurrentPartnerOne, concurrentPartnerTwo] });

      fetchSpy = mockUmFetch({
        partners: [
          { partnerCode: 'concurrent-partner-one' },
          { partnerCode: 'concurrent-partner-two' },
        ],
        tenants: {
          'concurrent-partner-one': [
            makeUmTenant('concurrent-partner-one', 'tenant-one', { isGlobal: true }),
          ],
          'concurrent-partner-two': [
            makeUmTenant('concurrent-partner-two', 'tenant-two', { isGlobal: false }),
          ],
        },
      });

      await sync();

      const tenantOne = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'tenant-one', partnerId: 'concurrent-partner-one' } },
      });
      const tenantTwo = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'tenant-two', partnerId: 'concurrent-partner-two' } },
      });
      const crossAssigned = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'tenant-one', partnerId: 'concurrent-partner-two' } },
      });

      expect(tenantOne).not.toBeNull();
      expect(tenantOne?.isGlobal).toBe(true);
      expect(tenantTwo).not.toBeNull();
      expect(tenantTwo?.isGlobal).toBe(false);
      expect(crossAssigned).toBeNull();
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

    it('continues syncing other partners when one partner\'s tenant fetch fails', async () => {
      await global.prisma.partner.createMany({
        data: [partialFailurePartnerOk, partialFailurePartnerFail],
      });
      await global.prisma.tenant.create({ data: partialFailureExistingTenant });

      fetchSpy = mockUmFetch({
        partners: [
          { partnerCode: 'partial-failure-partner-ok' },
          { partnerCode: 'partial-failure-partner-fail' },
        ],
        tenants: {
          'partial-failure-partner-ok': [
            makeUmTenant('partial-failure-partner-ok', 'ok-tenant', { isGlobal: true }),
          ],
          // UM no longer lists this tenant — if the fetch succeeded, it would be soft-deleted
          'partial-failure-partner-fail': [],
        },
        tenantsFail: ['partial-failure-partner-fail'],
      });

      await sync();

      const okTenant = await global.prisma.tenant.findUnique({
        where: { code_partnerId: { code: 'ok-tenant', partnerId: 'partial-failure-partner-ok' } },
      });
      expect(okTenant).not.toBeNull();
      expect(okTenant?.isGlobal).toBe(true);

      // the failing partner's tenant fetch never succeeded, so its existing tenant
      // must be left untouched rather than treated as absent-from-UM and deleted
      const untouchedTenant = await global.prisma.tenant.findUnique({
        where: {
          code_partnerId: {
            code: 'partial-failure-existing-tenant',
            partnerId: 'partial-failure-partner-fail',
          },
        },
      });
      expect(untouchedTenant?.deletedOn).toBeNull();
    });
  });
});

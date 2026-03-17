import { IdentityProvider, Partner, Tenant, User } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';

export const makePartnerUserTenantContext = (tag: string) => {
  const idp: WithoutAudit<IdentityProvider> = {
    id: `idp-${tag}`,
    feHome: `https://${tag}-test.com`,
    oidcConfigId: null,
  };

  const partner: WithoutAudit<Partner> = {
    id: `partner-${tag}`,
    name: `Partner ${tag}`,
    idpId: idp.id,
    descriptorNamespace: null,
  };

  const tenant: WithoutAudit<Tenant> = {
    code: `tenant-${tag}`,
    partnerId: partner.id,
  };

  const user: WithoutAudit<Omit<User, 'id'>> = {
    idpId: idp.id,
    email: `${tag}@test.com`,
    givenName: `given-${tag}`,
    familyName: `family-${tag}`,
    externalUserId: `${tag}-id`,
  };

  return {
    partner,
    idp,
    tenant,
    user,
  };
};

export const seedContext = async (
  context: ReturnType<typeof makePartnerUserTenantContext>
): Promise<{
  partner: Partner;
  idp: IdentityProvider;
  tenant: Tenant;
  user: User;
}> => {
  const idp = await prisma.identityProvider.create({
    data: context.idp,
  });
  const partner = await prisma.partner.create({
    data: context.partner,
  });
  const [tenant, user] = await Promise.all([
    prisma.tenant.create({
      data: context.tenant,
    }),
    prisma.user.create({
      data: context.user,
    }),
  ]);
  await prisma.userTenant.create({
    data: {
      userId: user.id,
      tenantCode: tenant.code,
      partnerId: tenant.partnerId,
    },
  });

  return {
    partner,
    idp,
    tenant,
    user,
  };
};


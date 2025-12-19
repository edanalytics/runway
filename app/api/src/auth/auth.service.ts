import { Inject, Injectable } from '@nestjs/common';
import { IdentityProvider, Partner, PrismaClient, Tenant, User } from '@prisma/client';
import { PRISMA_ANONYMOUS } from '../database';

@Injectable()
export class AuthService {
  constructor(@Inject(PRISMA_ANONYMOUS) private prismaAnon: PrismaClient) {}

  /**
   * This method is called on login. Its job is to find the appropriate
   * user and tenant or create them on-the-fly if they don't exist.
   *
   * A few things to note:
   * - Tenants are scoped to a partner. The tenant returned by this method is
   *   saved to the user's session. Resource access is scoped to this tenant
   *   across pretty much all endpoints.
   * - Users are scoped to an IdP. A given user can log into tenants owned
   *   by multiple partners and have the same user record. Also, we do user
   *   lookup based on `externalUserId` and `idpId`. In practice, `externalUserId`
   *   is configured to be a user's email. Someday we might remove it in favor of email.
   * - There is a UserTenantMembership. The app doesn't use this. It's maybe helpful
   *   for seeing which tenants a user has logged into, but doesn't drive functionality.
   */
  async findOrCreateUserAndTenantForIdp(
    user: Pick<User, 'externalUserId' | 'givenName' | 'familyName' | 'email'>,
    tenantCode: Tenant['code'],
    idp: IdentityProvider,
    partnerId: Partner['id']
  ): Promise<{ user: User; tenant: Tenant }> {
    const userTenantMembership = await this.prismaAnon.userTenant.findFirst({
      where: {
        user: {
          idpId: idp.id,
          externalUserId: user.externalUserId,
        },
        tenant: {
          partnerId: partnerId,
          code: tenantCode,
        },
      },
      include: {
        user: true,
        tenant: true,
      },
    });

    if (userTenantMembership) {
      return { user: userTenantMembership.user, tenant: userTenantMembership.tenant };
    }

    const newMembership = await this.prismaAnon.userTenant.create({
      data: {
        user: {
          connectOrCreate: {
            where: {
              externalUserId_idpId: {
                externalUserId: user.externalUserId,
                idpId: idp.id,
              },
            },
            create: {
              idpId: idp.id,
              ...user,
            },
          },
        },
        tenant: {
          connectOrCreate: {
            where: { code_partnerId: { code: tenantCode, partnerId: partnerId } },
            create: {
              code: tenantCode,
              partnerId: partnerId,
            },
          },
        },
      },
      include: {
        user: true,
        tenant: true,
      },
    });

    return {
      user: newMembership.user,
      tenant: newMembership.tenant,
    };
  }
}

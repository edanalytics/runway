import { prismaClient } from '../../db/client';
import { partnerA, partnerC, partnerX } from '../../../fixtures/context-fixtures/partner-fixtures';
import {
  bundleA,
  bundleB,
  bundleM,
  bundleX,
  bundleY,
  partnerABundles,
  partnerXBundles,
} from '../../../fixtures/em-bundle-fixtures';
import { allOdsConfigs, allOdsConnections } from '../../../fixtures/context-fixtures/ods-fixture';
import {
  idpA,
  oidcConfigA,
  oidcConfigX,
  idpX,
} from '../../../fixtures/context-fixtures/idp-fixtures';
import {
  tenantA,
  tenantB,
  tenantC,
  tenantX,
} from '../../../fixtures/context-fixtures/tenant-fixtures';
import schoolYears from '../../../fixtures/context-fixtures/school-year-fixtures';
import { userA, userB, userX } from '../../../fixtures/user-fixtures';

/**
 * This file contains the seed data for the integration tests.
 * It provides a baseline that individual test files can supplement
 * with additional data that's specific to whatever that file is
 * testing.
 *
 * This file should use fixtures defined in the fixtures directory
 * so that the same records can be referenced in test files.
 */

export const refreshSeed = async () => {
  await clear();
  await load();
};

const load = async () => {
  const prisma = prismaClient();
  await Promise.all([
    prisma.schoolYear.createMany({
      data: schoolYears,
    }),
    prisma.earthmoverBundle.createMany({
      data: [bundleA, bundleB, bundleM, bundleX, bundleY].map((b) => ({
        key: b.path,
      })),
    }),
    prisma.oidcConfig.createMany({
      data: [oidcConfigA, oidcConfigX],
    }),
  ]);

  await prisma.identityProvider.createMany({
    data: [idpA, idpX].map((idp) => {
      const { oidcConfig, ...idpForPrisma } = idp; // strip convenience property
      return idpForPrisma;
    }),
  });

  await prisma.partner.createMany({
    data: [partnerA, partnerC, partnerX],
  });
  // Depends on partner and oidcConfig
  await Promise.all([
    prisma.partnerEarthmoverBundle.createMany({
      data: [
        ...partnerABundles.map((b) => ({
          partnerId: partnerA.id,
          earthmoverBundleKey: b.path,
        })),
        ...partnerXBundles.map((b) => ({
          partnerId: partnerX.id,
          earthmoverBundleKey: b.path,
        })),
      ],
    }),
  ]);

  // Depend on idp
  await Promise.all([
    prisma.tenant.createMany({
      data: [tenantA, tenantB, tenantC, tenantX],
    }),
    prisma.user.createMany({
      data: [userA, userB, userX],
    }),
  ]);

  // Users A is in tenant A, B is in tenant B, X is in tenant X
  await prisma.userTenant.createMany({
    data: [
      {
        userId: userA.id,
        tenantCode: tenantA.code,
        partnerId: tenantA.partnerId,
      },
      {
        userId: userB.id,
        tenantCode: tenantB.code,
        partnerId: tenantB.partnerId,
      },
      {
        userId: userX.id,
        tenantCode: tenantX.code,
        partnerId: tenantX.partnerId,
      },
    ],
  });

  await prisma.odsConfig.createMany({
    data: allOdsConfigs.map((c) => ({ ...c, activeConnectionId: null })),
  });
  await prisma.odsConnection.createMany({
    data: allOdsConnections,
  });

  await Promise.all(
    allOdsConfigs.map(async (config) => {
      await prisma.odsConfig.update({
        where: { id: config.id },
        data: { activeConnectionId: config.activeConnectionId },
      });
    })
  );
};

const clear = async () => {
  const prisma = prismaClient();
  await prisma.userTenant.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.identityProvider.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.oidcConfig.deleteMany();
  await prisma.schoolYear.deleteMany();
  await prisma.earthmoverBundle.deleteMany();
  await prisma.partnerEarthmoverBundle.deleteMany();
  await prisma.odsConfig.deleteMany();
  await prisma.odsConnection.deleteMany();
};

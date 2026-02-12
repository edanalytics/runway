import { OdsConfig, OdsConnection } from '@prisma/client';
import { WithoutAudit } from '../fixtures/utils/created-modified';

export const seedOds = async ({
  config,
  connection,
}: {
  config: WithoutAudit<OdsConfig>;
  connection: WithoutAudit<OdsConnection>;
}) => {
  const odsConfig = await prisma.odsConfig.create({
    data: config,
  });
  const odsConnection = await prisma.odsConnection.create({
    data: { ...connection, odsConfigId: odsConfig.id },
  });

  return await prisma.odsConfig.update({
    where: { id: odsConfig.id },
    data: { activeConnectionId: odsConnection.id },
    include: { activeConnection: true },
  });
};

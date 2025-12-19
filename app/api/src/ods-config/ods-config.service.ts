import { Inject, Injectable, Logger } from '@nestjs/common';
import { OdsConfig, OdsConnection, PrismaClient, Tenant } from '@prisma/client';
import { PRISMA_READ_ONLY } from '../database';
import { PostOdsConfigDto, PutOdsConfigDto } from '@edanalytics/models';
import { EdfiService } from '../edfi/edfi.service';
import { EncryptionService } from '../encryption/encryption.service';

@Injectable()
export class OdsConfigService {
  constructor(
    @Inject(PRISMA_READ_ONLY) private prisma: PrismaClient,
    @Inject(EdfiService) private edfiService: EdfiService,
    @Inject(EncryptionService) private encryptionService: EncryptionService
  ) {}

  // Type guard since activeConnection is nullable
  private isCompleteConfig(
    odsConfig: OdsConfig & { activeConnection: OdsConnection | null }
  ): odsConfig is OdsConfig & { activeConnection: OdsConnection } {
    return odsConfig.activeConnection !== null;
  }

  private allAreCompleteConfigs(
    odsConfigs: Array<OdsConfig & { activeConnection: OdsConnection | null }>
  ): odsConfigs is Array<OdsConfig & { activeConnection: OdsConnection }> {
    return odsConfigs.every((config) => this.isCompleteConfig(config));
  }

  /**
   * Mutates OdsConfig object! We do this in order to preserve the Prisma instance and
   * because a helper function that accepts a full config object is a bit easier on
   * consumers than one that just takes the value to decrypt
   */
  private decryptSecret(odsConfig: (OdsConfig & { activeConnection: OdsConnection }) | null) {
    if (!odsConfig || !odsConfig.activeConnection) {
      return;
    }
    try {
      const decryptedSecret = this.encryptionService.decrypt(
        odsConfig.activeConnection.clientSecret
      );
      odsConfig.activeConnection.clientSecret = decryptedSecret;
    } catch (e) {
      Logger.error(`Failed to decrypt client secret for ODS config: ${odsConfig.id}`);
    }
  }

  async testConnection(connectionInfo: PostOdsConfigDto | PutOdsConfigDto) {
    const year = await this.prisma.schoolYear.findFirst({
      where: { id: connectionInfo.schoolYearId },
    });

    if (!year) {
      throw new Error(`School year not found while testing connection: ${connectionInfo}`);
    }

    return await this.edfiService.testConnection({
      host: connectionInfo.host,
      clientId: connectionInfo.clientId,
      clientSecret: connectionInfo.clientSecret,
      year: year.startYear,
    });
  }

  async findOne(id: number, prisma: PrismaClient = this.prisma) {
    const odsConfig = await prisma.odsConfig.findFirst({
      where: { id, retired: false },
      include: { activeConnection: true },
    });

    if (odsConfig && !this.isCompleteConfig(odsConfig)) {
      throw new Error(
        `Invalid ODS configuration: missing connection info for config ${odsConfig.id}`
      );
    }
    this.decryptSecret(odsConfig);
    return odsConfig;
  }

  async findAll(
    tenant: Tenant,
    prisma: PrismaClient = this.prisma
  ): Promise<Array<OdsConfig & { activeConnection: OdsConnection }>> {
    const odsConfigs = await prisma.odsConfig.findMany({
      where: { tenantCode: tenant.code, partnerId: tenant.partnerId, retired: false },
      include: { activeConnection: true },
    });

    if (!this.allAreCompleteConfigs(odsConfigs)) {
      throw new Error(
        `Invalid ODS configuration: missing connection info for config: ${odsConfigs
          .filter((c) => !this.isCompleteConfig(c))
          .map((c) => c.id)
          .join(', ')}`
      );
    }

    // odsConfigs.forEach((config) => this.decryptSecret(config));
    return odsConfigs;
  }

  async create(
    data: PostOdsConfigDto,
    tenant: Tenant,
    prisma: PrismaClient,
    status: OdsConnection['lastUseResult'] = 'success'
  ) {
    return prisma.$transaction(async (tx) => {
      const odsConfig = await tx.odsConfig.create({
        data: {
          tenantCode: tenant.code,
          partnerId: tenant.partnerId,
        },
      });

      const odsConnection = await tx.odsConnection.create({
        data: {
          odsConfigId: odsConfig.id,
          host: data.host,
          clientId: data.clientId,
          clientSecret: this.encryptionService.encrypt(data.clientSecret),
          schoolYearId: data.schoolYearId,
          lastUseOn: new Date(),
          lastUseResult: status,
        },
      });

      const newConfig = await tx.odsConfig.update({
        where: { id: odsConfig.id },
        data: {
          activeConnectionId: odsConnection.id,
        },
        include: { activeConnection: true },
      });

      if (!this.isCompleteConfig(newConfig)) {
        throw new Error(`Failed to create ODS config with connection info: ${newConfig.id}`);
      }

      return newConfig;
    });
  }

  async update(
    id: OdsConfig['id'],
    data: PutOdsConfigDto,
    prisma: PrismaClient,
    status: OdsConnection['lastUseResult'] = 'success'
  ) {
    /**
     * We treat ODS connections as immutable, so rather than do a simple update, we:
     * - create a new OdsConnection
     * - link the new OdsConnection to the OdsConfig
     * - retire the old OdsConnection
     */
    const existingConfig = await this.findOne(id);
    if (!existingConfig) {
      throw new Error(`ODS configuration not found: ${id}`);
    }

    const updatedConfig = await prisma.$transaction(async (tx) => {
      await tx.odsConnection.update({
        where: { id: existingConfig.activeConnection.id },
        data: {
          retiredOn: new Date(),
          retired: true,
        },
      });

      const newConnection = await tx.odsConnection.create({
        data: {
          odsConfigId: id,
          host: data.host,
          clientId: data.clientId,
          clientSecret: this.encryptionService.encrypt(data.clientSecret),
          schoolYearId: data.schoolYearId,
          lastUseOn: new Date(),
          lastUseResult: status,
        },
      });

      return tx.odsConfig.update({
        where: { id },
        data: {
          activeConnectionId: newConnection.id,
        },
        include: { activeConnection: true },
      });
    });

    if (!this.isCompleteConfig(updatedConfig)) {
      throw new Error(`Failed to update ODS config with new connection info: ${updatedConfig.id}`);
    }
    this.decryptSecret(updatedConfig);
    return updatedConfig;
  }

  async updateConnectionStatus(
    id: number,
    status: OdsConnection['lastUseResult'],
    prisma: PrismaClient
  ) {
    const updatedConfig = await prisma.odsConfig.update({
      where: { id },
      data: {
        activeConnection: {
          update: {
            lastUseResult: status,
            lastUseOn: new Date(),
          },
        },
      },
      include: { activeConnection: true },
    });

    if (!this.isCompleteConfig(updatedConfig)) {
      throw new Error(`Failed to update ODS config with new connection info: ${updatedConfig.id}`);
    }
    this.decryptSecret(updatedConfig);
    return updatedConfig;
  }

  async retire(id: OdsConfig['id'], prisma: PrismaClient) {
    return prisma.odsConfig.update({
      where: { id },
      data: {
        retired: true,
        retiredOn: new Date(),
      },
    });
  }
}

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PRISMA_READ_ONLY } from 'api/src/database';
import { AppConfigService } from 'api/src/config/app-config.service';
import type { Connection, Pool } from 'snowflake-sdk';

type PoolEntry = { pool: Pool<Connection> };

/**
 * Maintains one Snowflake connection pool per partner. Connecting takes ~20s,
 * so we warm pools at startup (fire-and-forget) and reuse connections across
 * requests. A request for a partner without a pool will create one on demand
 * and await its readiness.
 */
@Injectable()
export class EduSnowflakePoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EduSnowflakePoolService.name);
  private readonly pools = new Map<string, Promise<PoolEntry>>();
  // Partners for which createPool has already resolved successfully. Lets
  // canConnect answer instantly for warm partners without a fresh AWS fetch.
  private readonly resolvedPools = new Set<string>();

  constructor(
    @Inject(PRISMA_READ_ONLY)
    private readonly prisma: PrismaClient,
    private readonly configService: AppConfigService
  ) {}

  onModuleInit() {
    void this.warmPools();
  }

  /**
   * Drain and clear every pool on shutdown so Snowflake sockets don't outlive
   * the process during deploys (Beanstalk/ECS SIGTERM). Bounded per-pool to
   * stay well under the platform grace period.
   */
  async onModuleDestroy(): Promise<void> {
    const entries = Array.from(this.pools.entries());
    this.pools.clear();
    this.resolvedPools.clear();
    if (entries.length === 0) return;

    this.logger.log(`shutting down ${entries.length} EDU snowflake pool(s)`);
    const shutdownTimeoutMs = 10_000;
    await Promise.allSettled(
      entries.map(async ([partnerId, entryPromise]) => {
        try {
          const { pool } = await entryPromise;
          await Promise.race([
            pool.drain().then(() => pool.clear()),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`drain timed out after ${shutdownTimeoutMs}ms`)),
                shutdownTimeoutMs
              )
            ),
          ]);
        } catch (err) {
          this.logger.warn(`pool shutdown failed for partner ${partnerId}: ${err}`);
        }
      })
    );
  }

  /**
   * Acquires a connection from the partner's pool, runs the callback, and
   * releases the connection. Creates the pool on demand if none exists.
   */
  async use<T>(partnerId: string, callback: (connection: Connection) => Promise<T>): Promise<T> {
    const entry = await this.getOrCreatePool(partnerId);
    return entry.pool.use(callback);
  }

  /**
   * Answers "could we open an EDU connection for this partner if asked?"
   * - Already-established pool → instant true (no AWS call).
   * - Otherwise → fresh cred check via AppConfigService.
   * Errors are swallowed and logged so callers (e.g. job-payload assembly)
   * can degrade gracefully without breaking unrelated work.
   */
  async canConnect(partnerId: string): Promise<boolean> {
    if (this.resolvedPools.has(partnerId)) return true;
    try {
      return (await this.configService.getEduConnectionInfo(partnerId)) !== null;
    } catch (err) {
      this.logger.warn(
        `canConnect: cred check failed for partner ${partnerId}: ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`
      );
      return false;
    }
  }

  private getOrCreatePool(partnerId: string): Promise<PoolEntry> {
    let entry = this.pools.get(partnerId);
    if (!entry) {
      entry = this.createPool(partnerId);
      this.pools.set(partnerId, entry);
      // Evict failed creations so subsequent requests can retry. Guard against
      // racing with a concurrent insertion under the same key — only delete if
      // the map still points at this failed entry.
      const failedEntry = entry;
      entry.catch(() => {
        if (this.pools.get(partnerId) === failedEntry) {
          this.pools.delete(partnerId);
          this.resolvedPools.delete(partnerId);
        }
      });
    }
    return entry;
  }

  private async createPool(partnerId: string): Promise<PoolEntry> {
    const conn = await this.configService.getEduConnectionInfo(partnerId);
    if (!conn) {
      throw new Error(`No EDU connection info available for partner ${partnerId}`);
    }

    // Lazy import: snowflake-sdk has slow module-init side effects we don't
    // want to pay on every app boot.
    const snowflake = await import('snowflake-sdk');

    // The SDK writes a `snowflake.log` file to CWD by default. Silence it;
    // we surface failures through Nest's logger instead.
    snowflake.configure({ logLevel: 'OFF' });

    const pool = snowflake.createPool(
      {
        account: conn.account,
        username: conn.username,
        database: conn.database,
        schema: conn.schema,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: conn.privateKey.toString('utf-8'),
      },
      // Cap acquire waits so a saturated pool surfaces a clear timeout error
      // instead of hanging the request forever (generic-pool's default). 60s
      // is intentionally generous — JWT connect alone is ~20s, so this needs
      // headroom for cold-start + queue wait in a bursty 5+ concurrent run.
      { min: 1, max: 4, acquireTimeoutMillis: 60_000 }
    );

    this.logger.log(`created EDU snowflake pool for partner ${partnerId}`);
    this.resolvedPools.add(partnerId);
    return { pool };
  }

  private async warmPools(): Promise<void> {
    try {
      const partners = await this.prisma.partner.findMany({
        where: { crossYearMatchingEnabled: true },
        select: { id: true },
      });
      if (partners.length === 0) return;

      this.logger.log(`warming EDU snowflake pools for ${partners.length} partner(s)`);
      await Promise.allSettled(
        partners.map((p) =>
          this.getOrCreatePool(p.id).catch((err) =>
            this.logger.warn(`pool warm failed for partner ${p.id}: ${err}`)
          )
        )
      );
    } catch (err) {
      this.logger.warn(`pool warming aborted: ${err}`);
    }
  }
}

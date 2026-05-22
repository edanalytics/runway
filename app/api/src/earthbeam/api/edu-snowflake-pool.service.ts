import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from 'api/src/config/app-config.service';
import type { Connection, Pool } from 'snowflake-sdk';

/**
 * Maintains one Snowflake connection pool per partner, created on demand.
 * The first request for a partner pays the ~20s JWT connect cost; subsequent
 * requests reuse the pool until the evictor reaps idle connections.
 */
@Injectable()
export class EduSnowflakePoolService implements OnModuleDestroy {
  private readonly logger = new Logger(EduSnowflakePoolService.name);
  private readonly pools = new Map<string, Promise<Pool<Connection>>>();

  constructor(private readonly configService: AppConfigService) {}

  /**
   * Drain and clear every pool on shutdown so Snowflake sockets don't outlive
   * the process during deploys (Beanstalk/ECS SIGTERM). Bounded per-pool to
   * stay well under the platform grace period.
   */
  async onModuleDestroy(): Promise<void> {
    const entries = Array.from(this.pools.entries());
    this.pools.clear();
    if (entries.length === 0) return;

    this.logger.log(`shutting down ${entries.length} EDU snowflake pool(s)`);
    const shutdownTimeoutMs = 10_000;
    await Promise.allSettled(
      entries.map(async ([partnerId, poolPromise]) => {
        try {
          const pool = await poolPromise;
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
    const pool = await this.getOrCreatePool(partnerId);
    return pool.use(callback);
  }

  /**
   * Answers "could we open an EDU connection for this partner if asked?"
   * Fast path: an entry in `pools` means we've already started building a
   * pool, so creds existed at least once — return true without an AWS call.
   * (A racy in-flight failure is harmless: payload assembly would set
   * crossYearMatchAvailable=true, the executor's roster fetch would 500,
   * and the executor falls back to first-pass results.)
   * Otherwise: fresh cred check via AppConfigService. Errors are swallowed
   * and logged so callers (e.g. job-payload assembly) can degrade gracefully
   * without breaking unrelated work.
   */
  async canConnect(partnerId: string): Promise<boolean> {
    if (this.pools.has(partnerId)) return true;
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

  private getOrCreatePool(partnerId: string): Promise<Pool<Connection>> {
    const existing = this.pools.get(partnerId);
    if (existing) return existing;

    const pool = this.createPool(partnerId);
    this.pools.set(partnerId, pool);
    // Evict failed creations so subsequent requests can retry. Guard against
    // racing with a concurrent insertion under the same key — only delete if
    // the map still points at this entry.
    pool.catch(() => {
      if (this.pools.get(partnerId) === pool) {
        this.pools.delete(partnerId);
      }
    });
    return pool;
  }

  private async createPool(partnerId: string): Promise<Pool<Connection>> {
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
      //
      // Evictor runs every 60s and closes connections idle for 60s. Combined
      // with min: 0, this means a pool that hasn't served traffic for a minute
      // drops to zero connections, avoiding stale-session failures on the next
      // request (Snowflake server-side session timeout would otherwise kill
      // the idle connection silently).
      {
        min: 0,
        max: 4,
        acquireTimeoutMillis: 60_000,
        evictionRunIntervalMillis: 60_000,
        idleTimeoutMillis: 60_000,
      }
    );

    this.logger.log(`created EDU snowflake pool for partner ${partnerId}`);
    return pool;
  }
}

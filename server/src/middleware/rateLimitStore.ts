import type { Store, Options, ClientRateLimitInfo } from 'express-rate-limit';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * A rate-limit store every API instance shares, in Postgres.
 *
 * The default store is per process, so with two instances a sign-in limit of
 * ten was really twenty. Each bucket key is one row: the first hit in a window
 * starts it, later hits add one, and a hit after the window starts a new one —
 * all in one statement, so two instances counting at once cannot lose a hit.
 *
 * Times go in as UTC text and are compared as UTC, the way Prisma stores the
 * zoneless column; NOW() would be read in the session's time zone.
 */
const utc = (d: Date) => d.toISOString();

export class PostgresRateLimitStore implements Store {
  prefix: string;
  windowMs = 60_000;
  localKeys = false;
  constructor(prefix: string) {
    this.prefix = prefix;
  }
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private k(key: string) {
    return `${this.prefix}:${key}`.slice(0, 300);
  }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const reset = new Date(now.getTime() + this.windowMs);
    const rows = await platformPrisma.$queryRaw<Array<{ hits: number; resetAt: Date }>>`
      INSERT INTO "RateLimitHit" ("key", "hits", "resetAt")
      VALUES (${this.k(key)}, 1, (${utc(reset)}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitHit"."resetAt" <= (${utc(now)}::timestamptz AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimitHit"."hits" + 1 END,
        "resetAt" = CASE WHEN "RateLimitHit"."resetAt" <= (${utc(now)}::timestamptz AT TIME ZONE 'UTC') THEN (${utc(reset)}::timestamptz AT TIME ZONE 'UTC') ELSE "RateLimitHit"."resetAt" END
      RETURNING "hits", "resetAt"`;
    /* Now and then, clear windows long gone so the table stays small. */
    if (Math.random() < 0.01) {
      void platformPrisma.rateLimitHit.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 3_600_000) } } }).catch(() => undefined);
    }
    const r = rows[0];
    return { totalHits: Number(r?.hits ?? 1), resetTime: r?.resetAt ? new Date(r.resetAt) : reset };
  }
  async decrement(key: string) {
    await platformPrisma.$executeRaw`UPDATE "RateLimitHit" SET "hits" = GREATEST("hits" - 1, 0) WHERE "key" = ${this.k(key)}`;
  }
  async resetKey(key: string) {
    await platformPrisma.rateLimitHit.deleteMany({ where: { key: this.k(key) } });
  }
  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const r = await platformPrisma.rateLimitHit.findUnique({ where: { key: this.k(key) } });
    return r && r.resetAt > new Date() ? { totalHits: r.hits, resetTime: r.resetAt } : undefined;
  }
}

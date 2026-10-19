import { describe, it, expect, afterAll } from 'vitest';

/**
 * Credential rate limits are counted once for the whole deployment: two
 * instances (two stores with the same prefix) add to the same count, and a
 * new window starts again from one.
 */
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { PostgresRateLimitStore } = await import('../middleware/rateLimitStore.js');
afterAll(async () => { await platformPrisma.$disconnect(); });

describe('the shared rate-limit store', () => {
  it('adds hits from every instance to one count', async () => {
    const prefix = `t${Date.now()}`;
    const a = new PostgresRateLimitStore(prefix);
    const b = new PostgresRateLimitStore(prefix);
    a.init({ windowMs: 60_000 } as any);
    b.init({ windowMs: 60_000 } as any);
    expect((await a.increment('ip:1.2.3.4')).totalHits).toBe(1);
    expect((await b.increment('ip:1.2.3.4')).totalHits).toBe(2);
    expect((await a.increment('ip:1.2.3.4')).totalHits).toBe(3);
    const r = await a.increment('ip:5.6.7.8');
    expect(r.totalHits).toBe(1);
    expect(r.resetTime!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('starts again after the window, and can be reset or walked back', async () => {
    const s = new PostgresRateLimitStore(`w${Date.now()}`);
    s.init({ windowMs: 60_000 } as any);
    await s.increment('k');
    await s.increment('k');
    await platformPrisma.rateLimitHit.updateMany({ where: { key: { startsWith: s.prefix } }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await s.increment('k')).totalHits).toBe(1);
    await s.increment('k');
    await s.decrement('k');
    expect((await s.get('k'))?.totalHits).toBe(1);
    await s.resetKey('k');
    expect(await s.get('k')).toBeUndefined();
  });
});

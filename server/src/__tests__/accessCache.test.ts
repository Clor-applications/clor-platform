import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cachedAccess, clearAccessCache, accessCacheTtlMs } from '../utils/accessCache.js';

describe('accessCache', () => {
  beforeEach(() => {
    process.env.ACCESS_CACHE_TTL_MS = '60000';
    clearAccessCache();
  });
  afterEach(() => {
    delete process.env.ACCESS_CACHE_TTL_MS;
    clearAccessCache();
  });

  it('is off by default outside production', () => {
    delete process.env.ACCESS_CACHE_TTL_MS;
    expect(accessCacheTtlMs()).toBe(0);
  });

  it('runs the lookup once for repeated keys', async () => {
    let calls = 0;
    const load = async () => ++calls;
    expect(await cachedAccess('k', load)).toBe(1);
    expect(await cachedAccess('k', load)).toBe(1);
    expect(calls).toBe(1);
  });

  it('shares one in-flight lookup between concurrent callers', async () => {
    let calls = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++calls), 20));
    const results = await Promise.all(Array.from({ length: 25 }, () => cachedAccess('burst', load)));
    expect(new Set(results)).toEqual(new Set([1]));
    expect(calls).toBe(1);
  });

  it('does not cache results the caller rejects (denials)', async () => {
    let calls = 0;
    const load = async () => ({ denied: true, n: ++calls });
    await cachedAccess('deny', load, (v) => !v.denied);
    await cachedAccess('deny', load, (v) => !v.denied);
    expect(calls).toBe(2);
  });

  it('clearAccessCache forces a fresh lookup', async () => {
    let calls = 0;
    const load = async () => ++calls;
    await cachedAccess('c', load);
    clearAccessCache();
    expect(await cachedAccess('c', load)).toBe(2);
  });

  it('a clear during a lookup keeps that stale result out of the cache', async () => {
    let calls = 0;
    const load = () => new Promise<number>((r) => setTimeout(() => r(++calls), 20));
    const pending = cachedAccess('race', load);
    clearAccessCache();
    await pending;
    expect(await cachedAccess('race', load)).toBe(2);
  });

  it('expires entries after the TTL', async () => {
    process.env.ACCESS_CACHE_TTL_MS = '10';
    let calls = 0;
    const load = async () => ++calls;
    await cachedAccess('t', load);
    await new Promise((r) => setTimeout(r, 25));
    expect(await cachedAccess('t', load)).toBe(2);
  });
});

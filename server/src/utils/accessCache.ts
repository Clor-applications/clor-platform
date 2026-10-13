/**
 * A short-lived, per-instance memo for "who may do what" lookups.
 *
 * Every tenant request re-derived the same answers from the platform database —
 * membership, branches, warehouses, roles, permissions — about eight queries
 * in a row before the route did any work. The dashboard opens ~25 requests at
 * once, so the same eight queries ran ~25 times concurrently through a small
 * connection pool and queued.
 *
 * Two things make the cache safe enough:
 *
 * - **Any write clears it.** `clearAccessCacheOnWrite` drops everything when a
 *   POST/PUT/PATCH/DELETE finishes on this instance, so a role change, a new
 *   membership or a revoked branch takes effect on the next request here.
 * - **A short TTL bounds the rest.** Another instance (Cloud Run runs up to two)
 *   does not see this instance's writes; its entries expire within the TTL.
 *   A revoked permission can therefore survive for at most ACCESS_CACHE_TTL_MS
 *   on the other instance — the same window a short-lived access token has.
 *
 * Concurrent misses for the same key share one in-flight lookup, which is the
 * case the dashboard's burst of parallel requests produces.
 *
 * Off (TTL 0) outside production unless ACCESS_CACHE_TTL_MS is set, so tests
 * that change memberships straight in the database see the change at once.
 */
import type { Request, Response, NextFunction } from 'express';

const MAX_ENTRIES = 5000;

type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

export function accessCacheTtlMs() {
  const raw = process.env.ACCESS_CACHE_TTL_MS;
  if (raw !== undefined && raw !== '') return Math.max(0, Number(raw) || 0);
  return process.env.NODE_ENV === 'production' ? 30_000 : 0;
}

/**
 * Returns the cached value for `key`, or runs `load` and caches what it returns.
 * `keep` decides whether a result is worth caching (e.g. only grants, never denials).
 */
export async function cachedAccess<T>(key: string, load: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
  const ttl = accessCacheTtlMs();
  if (ttl <= 0) return load();

  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  // A clear that happens while this load runs must not be undone by it.
  const startedAt = generation;
  const p = load()
    .then((value) => {
      if (startedAt === generation && keep(value)) {
        if (store.size >= MAX_ENTRIES) store.clear();
        store.set(key, { value, expires: Date.now() + ttl });
      }
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function clearAccessCache() {
  generation++;
  store.clear();
  inflight.clear();
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Drops the whole cache after any request that may have written something. */
export function clearAccessCacheOnWrite(req: Request, res: Response, next: NextFunction) {
  if (!READ_METHODS.has(req.method)) res.on('finish', clearAccessCache);
  next();
}

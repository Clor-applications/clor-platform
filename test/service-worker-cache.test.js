/**
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The static cache has to stop growing.
 *
 * `neev-static-v1` is a fixed name, so the activate handler — which deletes
 * caches under any other name — never had anything to delete. Every deploy
 * renames every asset, so every deploy left a full set of dead files behind,
 * and nothing but the user clearing site data ever removed them.
 *
 * These drive the real `public/sw.js` against a fake Cache API rather than
 * asserting on its source text, so they hold the behaviour: what it evicts,
 * what it refuses to cache, and that a user never loses a file to a cache
 * problem.
 */

const SW = readFileSync('public/sw.js', 'utf8');

/** Insertion-ordered, like the real thing — `keys()` order is what eviction uses. */
class FakeCache {
  constructor() {
    this.store = new Map();
  }
  async put(request, response) {
    this.store.set(key(request), response);
  }
  async keys() {
    return [...this.store.keys()].map((k) => ({ url: k }));
  }
  async delete(request) {
    return this.store.delete(key(request));
  }
  async match(request) {
    return this.store.get(key(request));
  }
}

const key = (r) => (typeof r === 'string' ? r : r.url);

class FakeCaches {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
  async match(request) {
    for (const c of this.caches.values()) {
      const hit = await c.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** Loads the worker and returns its handlers plus the fakes it ran against. */
function loadWorker({ fetchImpl } = {}) {
  const listeners = {};
  const cacheStorage = new FakeCaches();
  const claimed = { done: false };
  const self = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: {
      claim: async () => {
        claimed.done = true;
      },
    },
  };
  const fetchFn = fetchImpl || (async () => ok());
  new Function('self', 'caches', 'fetch', 'URL', SW)(self, cacheStorage, fetchFn, URL);
  return { listeners, cacheStorage, claimed };
}

const ok = (body = 'x') => ({ ok: true, body, clone() { return { ...this }; } });

/** An event whose `waitUntil` work can be awaited, like the browser's. */
const event = (extra = {}) => {
  const waits = [];
  return {
    waitUntil: (p) => waits.push(p),
    settled: () => Promise.all(waits),
    ...extra,
  };
};

const fetchEvent = (url, method = 'GET') => {
  let responded;
  const e = event({
    request: { url, method },
    respondWith: (p) => {
      responded = p;
    },
  });
  e.response = () => responded;
  return e;
};

const CACHE = 'neev-static-v1';
let worker;
beforeEach(() => {
  worker = loadWorker();
});

describe('what the worker will cache at all', () => {
  it('keeps built assets, which are immutable because their names carry a hash', async () => {
    const e = fetchEvent('https://neev.test/assets/app-a1b2c3.js');
    worker.listeners.fetch(e);
    await e.response();
    await e.settled();
    const cache = await worker.cacheStorage.open(CACHE);
    expect((await cache.keys()).map((k) => k.url)).toEqual(['https://neev.test/assets/app-a1b2c3.js']);
  });

  it('never touches the books', async () => {
    /* An accounting app showing a stale figure is worse than a slow one. */
    const e = fetchEvent('https://neev.test/api/orgs/1/invoices');
    worker.listeners.fetch(e);
    expect(e.response()).toBeUndefined();
  });

  it('leaves navigations to the network, so a deploy is picked up', async () => {
    const e = fetchEvent('https://neev.test/');
    worker.listeners.fetch(e);
    expect(e.response()).toBeUndefined();
  });

  it('does not cache anything but a GET', async () => {
    const e = fetchEvent('https://neev.test/assets/app.js', 'POST');
    worker.listeners.fetch(e);
    expect(e.response()).toBeUndefined();
  });
});

describe('the bound on the cache', () => {
  const fill = async (n, from = 0) => {
    for (let i = from; i < from + n; i += 1) {
      const e = fetchEvent(`https://neev.test/assets/chunk-${i}.js`);
      worker.listeners.fetch(e);
      await e.response();
      await e.settled();
    }
  };

  it('stops the cache growing without limit across deploys', async () => {
    /* Two hundred files is a handful of deploys' worth of renamed assets. */
    await fill(200);
    const cache = await worker.cacheStorage.open(CACHE);
    expect((await cache.keys()).length).toBeLessThanOrEqual(120);
  });

  it('evicts what was seen longest ago, not what was seen last', async () => {
    await fill(130);
    const cache = await worker.cacheStorage.open(CACHE);
    const urls = (await cache.keys()).map((k) => k.url);
    expect(urls).not.toContain('https://neev.test/assets/chunk-0.js');
    expect(urls).toContain('https://neev.test/assets/chunk-129.js');
  });

  it('keeps a whole build comfortably, so a reload is still instant', async () => {
    /* A build is around 55 files; caching one must not evict any of it. */
    await fill(55);
    const cache = await worker.cacheStorage.open(CACHE);
    expect((await cache.keys()).length).toBe(55);
  });
});

describe('activation', () => {
  it('throws away caches left by an older worker', async () => {
    await worker.cacheStorage.open('neev-static-v0');
    await worker.cacheStorage.open(CACHE);
    const e = event();
    worker.listeners.activate(e);
    await e.settled();
    expect(await worker.cacheStorage.keys()).toEqual([CACHE]);
  });

  it('brings an over-full cache back inside its bound', async () => {
    /* The case this was written for: a browser that has been running the
       unbounded worker for months, updating to this one. */
    const cache = await worker.cacheStorage.open(CACHE);
    for (let i = 0; i < 400; i += 1) await cache.put(`https://neev.test/assets/old-${i}.js`, ok());
    const e = event();
    worker.listeners.activate(e);
    await e.settled();
    expect((await cache.keys()).length).toBe(120);
  });

  it('takes over the open pages', async () => {
    const e = event();
    worker.listeners.activate(e);
    await e.settled();
    expect(worker.claimed.done).toBe(true);
  });
});

describe('when the cache itself fails', () => {
  it('still gives the user the file', async () => {
    /* Storage full, or quota refused. The response is the point; caching it
       is an optimisation and must never be able to take it away. */
    const w = loadWorker();
    w.cacheStorage.open = async () => {
      throw new Error('QuotaExceededError');
    };
    const e = fetchEvent('https://neev.test/assets/app.js');
    w.listeners.fetch(e);
    await expect(e.response()).resolves.toMatchObject({ ok: true });
    await expect(e.settled()).resolves.toBeDefined();
  });
});

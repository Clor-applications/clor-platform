/**
 * Conservative service worker: precache nothing, cache-first only for built
 * static assets (hashed filenames make them immutable), network-only for
 * /api and navigations. An accounting app must never show stale books; the
 * win here is instant repeat loads of the app shell's JS/CSS, offline
 * tolerance for assets already seen, and installability.
 */
const CACHE = 'clor-static-v2';

/**
 * How many built files this cache may hold.
 *
 * It used to hold every file it had ever seen. The name is fixed, so the
 * activate handler below — which deletes caches under any *other* name — never
 * had anything to delete: the cache was never replaced, only added to. Each
 * deploy renames every asset (the hash is the point), so each deploy left a
 * full set of dead files behind forever, and the only thing that ever emptied
 * it was the user clearing site data.
 *
 * A build is around 55 files, so this is roughly two builds' worth: enough that
 * an ordinary reload after a deploy is still served from the cache, and bounded
 * so the tail of old builds cannot accumulate. Eviction is oldest-first, which
 * the Cache API gives directly — `keys()` is in insertion order — and the cost
 * of evicting something still wanted is one network fetch, because nothing is
 * ever served from here that the network could not serve again.
 */
const MAX_ENTRIES = 120;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => trim())
      .then(() => self.clients.claim())
  );
});

/**
 * Drop the oldest entries until the cache is inside its bound.
 *
 * Sequential on purpose: `keys()` is read once, and the deletions are the
 * entries that read named, so a request that adds an entry while this is
 * running cannot have it deleted out from under itself by a stale key list.
 */
async function trim() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  for (const request of keys.slice(0, excess)) {
    await cache.delete(request);
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // books are never cached
  const isStatic = url.pathname.startsWith('/assets/') || /\.(js|css|svg|png|woff2?)$/.test(url.pathname);
  if (!isStatic) return;

  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            /* The response is returned either way: a cache that is full, or
               failing, must never cost the user the file they asked for. */
            e.waitUntil(
              caches
                .open(CACHE)
                .then((c) => c.put(e.request, copy))
                .then(() => trim())
                .catch(() => {})
            );
          }
          return res;
        })
    )
  );
});

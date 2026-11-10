import { useEffect, useState } from 'react';
import { PRODUCTS, SITE } from './site.js';

/**
 * The products as CLOR staff list them in the operator console (Product, App
 * catalogue; API: GET /public/app-catalogue). The page is built from
 * PRODUCTS; once it is open in a browser, a product the console hid is taken
 * out, one it marked coming soon says so, and each one's line is the
 * console's. If the API cannot be reached, the built page stands as it is.
 */
let cache = null;
let pending = null;

function load() {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch(`${SITE.apiUrl}/public/app-catalogue`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (cache = Array.isArray(d?.apps) ? d.apps : null))
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

/** PRODUCTS with the console's catalogue applied. */
export function applyCatalogue(products, apps) {
  if (!apps) return products;
  const by = new Map(apps.map((a) => [a.code, a]));
  return products
    .filter((p) => by.has(p.slug))
    .map((p) => {
      const a = by.get(p.slug);
      return { ...p, status: a.status === 'AVAILABLE' ? 'available' : 'soon', line: a.blurb || p.line };
    });
}

export function useProducts() {
  const [apps, setApps] = useState(cache);
  useEffect(() => {
    let live = true;
    load().then((a) => live && setApps(a));
    return () => {
      live = false;
    };
  }, []);
  return applyCatalogue(PRODUCTS, apps);
}

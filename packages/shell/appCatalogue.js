import { useEffect, useState } from 'react';
import { apiFetch } from '@platform/http';

/**
 * The app catalogue CLOR staff keep in the operator console (Product, App
 * catalogue; server: routes/opsCatalogue.ts): for each app, Available,
 * Coming soon or Hidden, and its one line. More apps lists from it. Read once
 * per page load; if it cannot be read, each app keeps its own entry.
 */
let cache = null;
let pending = null;

export function loadAppCatalogue() {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = apiFetch('/public/app-catalogue', { skipAuth: true })
      .then((r) => (cache = Array.isArray(r?.apps) ? r.apps : null))
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

export function useAppCatalogue() {
  const [apps, setApps] = useState(cache);
  useEffect(() => {
    let live = true;
    loadAppCatalogue().then((a) => live && setApps(a));
    return () => {
      live = false;
    };
  }, []);
  return apps;
}

/**
 * How the catalogue lists one app: null when there is no catalogue (keep the
 * app's own entry); `HIDDEN` when the catalogue leaves it out.
 */
export const listingFor = (catalogue, appId) => (catalogue ? catalogue.find((a) => a.appId === appId) || { appId, status: 'HIDDEN' } : null);

import { useCallback, useEffect, useState } from 'react';

/**
 * Loads a master list from the server, falling back to whatever is in the local
 * database when the call fails.
 *
 * The fallback matters during the migration: customers, vendors and items still
 * exist in browser storage from before the server owned them, and a network
 * failure should degrade to the old behaviour rather than emptying a picker
 * in the middle of an invoice.
 */
export const useServerMasters = (loader, localRows, { enabled = true } = {}) => {
  const [rows, setRows] = useState(localRows || []);
  const [source, setSource] = useState('local');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    (search) => {
      if (!enabled) return Promise.resolve();
      setLoading(true);
      setError('');
      return Promise.resolve()
        .then(() => loader(search))
        .then((serverRows) => {
          setRows(Array.isArray(serverRows) ? serverRows : []);
          setSource('server');
        })
        .catch((e) => {
          setError(String(e?.message || e));
          setRows(localRows || []);
          setSource('local');
        })
        .finally(() => setLoading(false));
    },
    // localRows changes identity on every render of the parent, so depending on
    // it here would reload the list continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, loader]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { rows, source, loading, error, reload: load };
};

export default useServerMasters;

/**
 * Mirror server master rows into the local collection so pickers can speak a
 * single id space (local numeric ids), with backend ids carried alongside.
 *
 * Why: pickers used to swap wholesale to server rows on load. Server ids are
 * cuids; every `Number(id)`/`parseInt(id)` check downstream then failed —
 * "Party (Customer) is required" with a customer visibly selected, item lines
 * resolving the wrong SKU, and locally created ("dummy") masters vanishing
 * from lists the moment the server answered. One id space ends the class.
 *
 * Match order: backend id first, then case-insensitive name — a local row
 * created before write-through adopts its server twin instead of duplicating.
 */
export const mirrorServerRows = ({ setDb, collection, backendKey, serverRows, companyId, mapRow }) => {
  if (!Array.isArray(serverRows) || !serverRows.length) return;
  setDb((prev) => {
    const locals = Array.isArray(prev[collection]) ? prev[collection] : [];
    const byBackend = new Map(locals.map((r) => [String(r?.[backendKey] || ''), r]));
    const byName = new Map(
      locals
        .filter((r) => Number(r?.companyId) === Number(companyId))
        .map((r) => [String(r?.name || r?.companyName || '').trim().toLowerCase(), r])
    );
    let nextId = locals.reduce((m, r) => Math.max(m, Number(r?.id) || 0), 0);
    const additions = [];
    const adoptions = new Map(); // localId -> backendId

    for (const srv of serverRows) {
      const sid = String(srv?.id || '');
      if (!sid || byBackend.has(sid)) continue;
      const nameKey = String(srv?.name || '').trim().toLowerCase();
      const twin = nameKey ? byName.get(nameKey) : null;
      if (twin && !twin[backendKey]) {
        adoptions.set(twin.id, sid);
        continue;
      }
      if (twin) continue; // same name already linked to another server row
      additions.push({ id: ++nextId, companyId, [backendKey]: sid, ...mapRow(srv) });
    }

    if (!additions.length && !adoptions.size) return prev;
    return {
      ...prev,
      [collection]: [
        ...locals.map((r) => (adoptions.has(r.id) ? { ...r, [backendKey]: adoptions.get(r.id) } : r)),
        ...additions,
      ],
    };
  });
};

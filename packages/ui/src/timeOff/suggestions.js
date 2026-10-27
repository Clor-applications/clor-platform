import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';

/*
 * What the company already has, for a text field to suggest (SuggestInput):
 * leave reasons, request reasons, on-duty places. Served by the leave engine
 * (server: /attendance/suggestions), so a company with only Attendance gets
 * them too; shared vocabulary only, most used first.
 */
const FRESH_MS = 5 * 60_000;
const cache = new Map();

function load(field) {
  const hit = cache.get(field);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
  const promise = apiFetch(`/orgs/${encodeURIComponent(orgId())}/attendance/suggestions?field=${encodeURIComponent(field)}`, { skipWarehouseHeader: true })
    .then((r) => (r?.values || []).map((v) => ({ value: v.value, ...(v.hint ? { hint: v.hint } : {}) })))
    .catch(() => []);
  cache.set(field, { at: Date.now(), promise });
  return promise;
}

/** Forget cached values after a save, so what was just typed is offered next time. */
export const refreshSuggestions = () => cache.clear();

/** Suggestions for one field: the company's own values, most used first. */
export function useSuggestions(field) {
  const [own, setOwn] = useState([]);
  useEffect(() => {
    if (!field) return undefined;
    let live = true;
    load(field).then((v) => { if (live) setOwn(v); });
    return () => { live = false; };
  }, [field]);
  return useMemo(() => own, [own]);
}

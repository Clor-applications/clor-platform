import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';

/*
 * What the company already has, for a text field to suggest (SuggestInput).
 * The server returns shared vocabulary only, most used first; the lists below
 * add the words every Indian company uses, after the company's own.
 */
const FRESH_MS = 5 * 60_000;
const cache = new Map();

export const RELATIONS = ['Father', 'Mother', 'Spouse', 'Husband', 'Wife', 'Brother', 'Sister', 'Son', 'Daughter', 'Guardian', 'Friend'];
export const STATE_NAMES = [...new Set(Object.values(GST_STATE_BY_CODE).filter((s) => !/\(Old\)|Other Territory|Centre Jurisdiction/i.test(s)))].sort();
const STANDARD = { relation: RELATIONS, state: STATE_NAMES, country: ['India'] };

function load(field) {
  const hit = cache.get(field);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise;
  const promise = apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/suggestions?field=${encodeURIComponent(field)}`, { skipWarehouseHeader: true })
    .then((r) => (r?.values || []).map((v) => ({ value: v.value, ...(v.hint ? { hint: v.hint } : {}) })))
    .catch(() => []);
  cache.set(field, { at: Date.now(), promise });
  return promise;
}

/** Forget cached values after a save, so what was just typed is offered next time. */
export const refreshSuggestions = () => cache.clear();

/** Suggestions for one field: the company's own values first, then the standard words. */
export function useSuggestions(field) {
  const [own, setOwn] = useState([]);
  useEffect(() => {
    if (!field) return undefined;
    let live = true;
    load(field).then((v) => { if (live) setOwn(v); });
    return () => { live = false; };
  }, [field]);
  return useMemo(() => [...own, ...(STANDARD[field] || [])], [own, field]);
}

/**
 * Work email: the company's domain, after what is typed before the @, or built
 * from the name ("asha.rao@…", "asha@…") while the field is still empty.
 */
export function useEmailSuggestions(typed, firstName, lastName) {
  const domains = useSuggestions('emailDomain');
  return useMemo(() => {
    const ds = domains.map((d) => d.value).filter(Boolean);
    if (!ds.length) return [];
    const at = String(typed || '').indexOf('@');
    const clean = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (at > 0) {
      const local = typed.slice(0, at);
      const part = typed.slice(at + 1).toLowerCase();
      return ds.filter((d) => d.startsWith(part)).map((d) => ({ value: `${local}@${d}`, hint: 'Company domain' }));
    }
    if (typed) return ds.map((d) => ({ value: `${typed.trim()}@${d}`, hint: 'Company domain', always: true }));
    const f = clean(firstName);
    const l = clean(lastName);
    if (!f) return [];
    return ds.flatMap((d) => [...(l ? [`${f}.${l}@${d}`] : []), `${f}@${d}`]).map((value) => ({ value, hint: 'Company domain' }));
  }, [domains, typed, firstName, lastName]);
}

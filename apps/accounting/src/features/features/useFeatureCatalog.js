import { useEffect, useMemo, useState } from 'react';

import { getFeatureCatalog, setFeatures } from '@ui/api/features';
import { useFeatures } from '@ui/permissions/useFeatures';
import {
  FEATURE_GROUPS,
  DISPLAY_FEATURE_KEYS,
  TAX_FEATURES,
  groupForFeature,
  iconForFeature,
  settingsLinkFor,
} from '../settings/featureRegistry';

/**
 * Everything the catalogue needs to be drawn: the rows, the filters over them,
 * the unsaved edits and the one save. The frame that calls this decides where
 * the pieces sit; it does not get to decide what they mean.
 */
export const useFeatureCatalog = (currentCompany = null) => {
  const { reload: reloadFeatures } = useFeatures();

  const [catalog, setCatalog] = useState([]);
  const [values, setValues] = useState({});
  const [baseline, setBaseline] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [state, setState] = useState('all');

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(getFeatureCatalog)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.features) ? data.features : [];
        const current = {};
        for (const f of list) current[f.key] = Boolean(f.enabled);
        setCatalog(list);
        setValues(current);
        setBaseline(current);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message || e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => Object.keys(values).some((k) => values[k] !== baseline[k]),
    [values, baseline]
  );

  /*
   * A child cannot be on while its parent is off. The server resolves this on
   * save as well; showing it live is what explains why a control stopped
   * responding instead of leaving it looking broken.
   */
  const effective = useMemo(() => {
    const out = { ...values };
    for (const f of catalog) {
      if (f.dependsOn && out[f.dependsOn] === false) out[f.key] = false;
    }
    return out;
  }, [values, catalog]);

  /* The tax three are read from where they already live. This surface shows
     their state and points at the page that owns them; it never writes them. */
  const taxCompliances = currentCompany?.profile?.taxCompliances || null;
  const taxRows = useMemo(
    () =>
      TAX_FEATURES.map((t) => ({
        key: t.key,
        label: t.label,
        icon: t.icon,
        enabled: t.read(taxCompliances),
        config: t.config,
        readOnly: true,
      })),
    [taxCompliances]
  );

  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const rows = catalog.filter((f) => DISPLAY_FEATURE_KEYS.has(f.key)).map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      icon: iconForFeature(f.key),
      group: groupForFeature(f.key),
      locked: f.locked,
      lockedReason: f.lockedReason,
      notEntitled: f.entitled === false,
      upgradeHint: f.upgradeHint,
      dependsOn: f.dependsOn,
      config: settingsLinkFor(f.key)?.key || '',
      configLabel: settingsLinkFor(f.key)?.label || 'Configure',
      enabled: Boolean(effective[f.key]),
    }));

    const all = [...rows, ...taxRows.map((t) => ({ ...t, group: 'taxation', configLabel: 'Configure' }))];

    const matched = all.filter((r) => {
      if (group !== 'all' && r.group !== group) return false;
      if (state === 'on' && !r.enabled) return false;
      if (state === 'off' && r.enabled) return false;
      if (q && !`${r.label} ${r.key}`.toLowerCase().includes(q)) return false;
      return true;
    });

    const map = new Map();
    for (const r of matched) {
      if (!map.has(r.group)) map.set(r.group, []);
      map.get(r.group).push(r);
    }
    return FEATURE_GROUPS.filter((g) => map.has(g.key)).map((g) => ({ ...g, items: map.get(g.key) }));
  }, [catalog, effective, taxRows, group, state, q]);

  /*
   * Turning a parent off takes its children with it, and says so before the
   * save rather than after. Nothing is deleted either way — a feature that is
   * off hides its screens; the documents it raised stay in the book.
   */
  const toggle = (key, next) =>
    setValues((prev) => {
      const out = { ...prev, [key]: next };
      if (!next) for (const f of catalog) if (f.dependsOn === key) out[f.key] = false;
      return out;
    });

  const childrenOf = (key) => catalog.filter((f) => f.dependsOn === key && values[f.key]);

  const revert = () => setValues(baseline);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await setFeatures(values);
      const applied = res?.features || values;
      setValues(applied);
      setBaseline(applied);
      setSavedAt(Date.now());
      reloadFeatures();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return {
    catalog,
    values,
    effective,
    sections,
    loading,
    saving,
    error,
    dirty,
    savedAt,
    query,
    setQuery,
    group,
    setGroup,
    state,
    setState,
    toggle,
    childrenOf,
    revert,
    save,
  };
};

import { useEffect, useMemo, useState } from 'react';

import { getFeatureCatalog, setFeatures } from '@ui/api/features';
import { useFeatures } from '@ui/permissions/useFeatures';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { reconcilePartyCodes } from '@ui/utils/partyCodeSync';
import {
  FEATURE_GROUPS,
  DISPLAY_FEATURE_KEYS,
  TAX_FEATURES,
  groupForFeature,
  iconForFeature,
  labelForFeature,
  settingsLinkFor,
} from '../settings/featureRegistry';

/**
 * Everything the catalogue needs to be drawn: the rows, the filters over them,
 * the unsaved edits and the one save. The frame that calls this decides where
 * the pieces sit; it does not get to decide what they mean.
 */
export const useFeatureCatalog = (currentCompany = null, setDb = null) => {
  const { reload: reloadFeatures } = useFeatures();

  const [catalog, setCatalog] = useState([]);
  const [values, setValues] = useState({});
  const [baseline, setBaseline] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);
  const [confirmedCodeBackfill, setConfirmedCodeBackfill] = useState({});

  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [state, setState] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCatalog([]);
    setValues({});
    setBaseline({});
    setError('');
    setConfirmedCodeBackfill({});
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
  }, [currentCompany?.profile?.backendCompanyId]);

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
        label: labelForFeature(t.key, t.label),
        icon: t.icon,
        enabled: t.read(taxCompliances),
        config: t.config,
        readOnly: true,
      })),
    [taxCompliances]
  );
  const gstEnabled = taxRows.find((row) => row.key === 'gst')?.enabled === true;
  const inventoryEnabled = effective.inventory === true;

  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const rows = catalog.filter((f) => DISPLAY_FEATURE_KEYS.has(f.key)).map((f) => ({
      key: f.key,
      label: labelForFeature(f.key, f.label),
      description: f.description,
      icon: iconForFeature(f.key),
      group: groupForFeature(f.key),
      locked: f.locked || (['customerCodes', 'vendorCodes'].includes(f.key) && baseline[f.key] === true),
      lockedReason: f.lockedReason,
      notEntitled: f.entitled === false,
      upgradeHint: f.upgradeHint,
      dependsOn: f.dependsOn,
      config: settingsLinkFor(f.key)?.key || '',
      configLabel: settingsLinkFor(f.key)?.label || 'Configure',
      enabled: Boolean(effective[f.key]) && (f.key !== 'einvoice' || gstEnabled),
      taxBlocked: f.key === 'einvoice' && !gstEnabled,
    }));

    const all = [...rows, ...taxRows.map((t) => ({ ...t, group: 'taxation', configLabel: 'Configure' }))]
      .sort((a, b) => {
        const order = { gst: 0, tds: 1, tcs: 2, einvoice: 3, inventory: 0 };
        return (order[a.key] ?? 99) - (order[b.key] ?? 99);
      });

    const matched = all.filter((r) => {
      if (r.group === 'inventory' && r.key !== 'inventory' && !inventoryEnabled) return false;
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
  }, [catalog, effective, baseline, taxRows, gstEnabled, inventoryEnabled, group, state, q]);

  /*
   * Turning a parent off takes its children with it, and says so before the
   * save rather than after. Nothing is deleted either way — a feature that is
   * off hides its screens; the documents it raised stay in the book.
   */
  const toggle = async (key, next) => {
    if (['customerCodes', 'vendorCodes'].includes(key) && !next && baseline[key]) { notify.error(`${key === 'customerCodes' ? 'Customer' : 'Vendor'} Code Numbering cannot be disabled after it has been enabled.`); return; }
    if (['customerCodes', 'vendorCodes'].includes(key) && next && !baseline[key]) {
      const label = key === 'customerCodes' ? 'customer' : 'vendor';
      const accepted = await confirmDialog({
        title: `Enable ${label} codes?`,
        message: `Existing ${label}s without codes will be numbered automatically from oldest to newest by creation date. Existing codes will stay the same. If a branch is not recorded for an older record, its code will use the head office branch. Once enabled, this cannot be disabled.`,
        confirmLabel: `Enable ${label} codes`,
      });
      if (!accepted) return;
      setConfirmedCodeBackfill((previous) => ({ ...previous, [key]: true }));
    }
    if (key === 'periodLock') {
      if (!next && baseline.periodLock) { notify.error('Period Lock cannot be disabled after it has been enabled.'); return; }
      if (next) {
        const accepted = await confirmDialog({ title: 'Enable Period Lock?', message: 'Once enabled, Period Lock cannot be disabled. Configure each module and financial year on the Period Lock page.', confirmLabel: 'Enable Period Lock' });
        if (!accepted) return;
      }
    }
    setValues((prev) => {
      const out = { ...prev, [key]: next };
      if (!next) for (const f of catalog) if (f.dependsOn === key) out[f.key] = false;
      if (key === 'inventory' && !next) {
        for (const child of ['stockTransfers', 'batchSerial', 'batchExpiry', 'reorderAlerts']) out[child] = false;
      }
      return out;
    });
  };

  const childrenOf = (key) => catalog.filter((f) => f.dependsOn === key && values[f.key]);

  const revert = () => { setValues(baseline); setConfirmedCodeBackfill({}); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const nextValues = gstEnabled ? values : { ...values, einvoice: false };
      const enablingCodes = ['customerCodes', 'vendorCodes'].filter((key) => !baseline[key] && nextValues[key]);
      if (enablingCodes.some((key) => !confirmedCodeBackfill[key])) {
        setError('Confirm automatic numbering before enabling customer or vendor codes.');
        return;
      }
      const res = await setFeatures(nextValues, { confirmCodeBackfill: enablingCodes.length > 0 });
      const applied = res?.features || values;
      if (res?.backfilled?.length && typeof setDb === 'function') {
        setDb((previous) => reconcilePartyCodes(previous, currentCompany?.id,
          res.backfilled.filter((row) => row.kind === 'CUSTOMER'),
          res.backfilled.filter((row) => row.kind === 'VENDOR')));
      }
      setValues(applied);
      setBaseline(applied);
      setConfirmedCodeBackfill({});
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
    gstEnabled,
  };
};

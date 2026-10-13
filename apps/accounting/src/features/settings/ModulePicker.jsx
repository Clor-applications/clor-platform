import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';

import { getEntitlement, getFeatureCatalog, setFeatures } from '@ui/api/features';

/**
 * "What do you use?" — asked in the language a business owner speaks.
 *
 * The forty individual switches in Feature Settings are the right level for
 * someone tuning a working system and the wrong level for someone who has just
 * signed up. A shop owner cannot answer "do you want batchSerial"; they can
 * answer "do you hold stock". So the same settings are offered here as five
 * packs, and the fine-grained screen stays where it is for later.
 *
 * A pack the plan does not carry is shown, locked, with the plan that does.
 * Hiding it would read as a product that cannot do the thing — which is both
 * untrue and a lost sale — and showing it as an ordinary control that then
 * fails is worse.
 */

/*
 * A checkbox, not a card that behaves like one.
 *
 * The tick-in-a-circle read as decoration and left people unsure whether a pack
 * was on. A checkbox is the control everybody already knows means "include
 * this", which is exactly the question being asked.
 */
const PackRow = ({ pack, on, disabled, onToggle }) => {
  const locked = !pack.fullyEntitled;
  return (
    <label
      className={`ui-card ui-in flex items-start gap-3 p-4 ${
        locked ? 'opacity-70 cursor-not-allowed' : 'ui-hover-sunken cursor-pointer'
      }`}
      style={on && !locked ? { borderColor: 'rgb(var(--brand))' } : undefined}
    >
      <input
        type="checkbox"
        className="ui-checkbox mt-0.5"
        checked={on}
        disabled={disabled || locked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-describedby={`pack-${pack.key}-desc`}
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{pack.label}</span>
          {locked ? (
            <span className="ui-pill ui-pill-neutral">
              <Lock size={10} aria-hidden="true" /> {pack.upgradeHint || 'Not on your plan'}
            </span>
          ) : null}
        </span>
        <span id={`pack-${pack.key}-desc`} className="ui-caption mt-0.5 block">
          {pack.description}
        </span>
      </span>
    </label>
  );
};

/**
 * @param onDone called after a successful save, so onboarding can advance.
 * @param submitLabel the wizard says "Continue"; settings says "Save".
 */
export const ModulePicker = ({ onDone = null, submitLabel = 'Save' }) => {
  const [packs, setPacks] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEntitlement(), getFeatureCatalog()])
      .then(([ent, cat]) => {
        if (cancelled) return;
        const current = {};
        for (const f of cat?.features || []) current[f.key] = Boolean(f.enabled);
        setPacks(Array.isArray(ent?.packs) ? ent.packs : []);
        setValues(current);
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

  /*
   * A pack reads as on when every feature under it is on. Half a pack is not a
   * state a person chose — it is what the fine-grained screen leaves behind —
   * so the switch shows off and turning it on completes the set rather than
   * toggling each one.
   */
  const packOn = useMemo(() => {
    const map = {};
    for (const p of packs) map[p.key] = p.features.length > 0 && p.features.every((k) => values[k]);
    return map;
  }, [packs, values]);

  const toggle = (pack, next) =>
    setValues((prev) => {
      const out = { ...prev };
      for (const k of pack.features) out[k] = next;
      return out;
    });

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await setFeatures(values);
      onDone?.();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="ui-caption">Loading modules…</p>;

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {packs.map((p) => (
          <PackRow key={p.key} pack={p} on={Boolean(packOn[p.key])} disabled={saving} onToggle={(next) => toggle(p, next)} />
        ))}
      </div>

      <p className="ui-caption">
        Anything unticked is hidden from the menus and the forms. Master Data and Settings stay whatever you choose, and
        you can change this at any time in Settings &rsaquo; Modules.
      </p>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="ui-btn ui-btn-primary">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
};

export default ModulePicker;

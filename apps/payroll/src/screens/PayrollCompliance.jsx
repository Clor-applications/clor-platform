import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  listStatutorySchemes,
  seedStatutoryRates,
  setSchemeEnabled,
  addStatutoryRate,
  deleteStatutoryRate,
} from '../api/payrollStatutory';

/**
 * Provident fund, ESI, professional tax and income tax.
 *
 * These are the amounts a company does not get to decide, and the screen is
 * shaped by two facts about them.
 *
 * A scheme is off until somebody says it applies. A deduction nobody asked for
 * is money taken from a person's pay by default, so nothing here switches
 * itself on.
 *
 * A rate is never edited. Rates change on dates somebody else picks, and a
 * payslip records the version it was computed under — so changing one means
 * publishing a new version from the day it changes, and the history stays
 * visible underneath. The screen offers no edit button because there is no
 * honest one to offer.
 */

const money = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

/** What a rate means, in the words somebody configuring payroll would use. */
const describeRate = (scheme, rule) => {
  if (scheme === 'PT') {
    const slabs = Array.isArray(rule.config?.slabs) ? rule.config.slabs.length : 0;
    return slabs ? `${slabs} slab${slabs === 1 ? '' : 's'}` : 'No slabs set';
  }
  if (scheme === 'TDS') return 'Income tax bands';
  const parts = [`${rule.employeeRate}% employee`, `${rule.employerRate}% employer`];
  if (rule.wageCeiling) parts.push(`capped at ${money(rule.wageCeiling)}`);
  if (rule.eligibilityThreshold) parts.push(`up to ${money(rule.eligibilityThreshold)}`);
  return parts.join(' · ');
};

export default function PayrollCompliance() {
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [addingTo, setAddingTo] = useState(null);

  const load = useCallback(async () => {
    try {
      setSchemes(await listStatutorySchemes());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load the statutory schemes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seed = async () => {
    setBusy('seed');
    try {
      const out = await seedStatutoryRates();
      notify.success(out.count ? `${out.count} rate${out.count === 1 ? '' : 's'} added.` : 'Already up to date.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not add the rates.'));
    } finally {
      setBusy('');
    }
  };

  const toggle = async (scheme, next) => {
    setBusy(scheme.id);
    try {
      await setSchemeEnabled(scheme.id, next, scheme.registrationNumber || null);
      notify.success(`${scheme.name} ${next ? 'applies to this company' : 'no longer applies'}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not change that scheme.'));
    } finally {
      setBusy('');
    }
  };

  const removeRate = async (scheme, rule) => {
    const ok = await confirmDialog({
      title: `Remove this ${scheme.name} rate?`,
      message:
        'A rate no payslip has used can be removed. One that has produced a payslip is a permanent record and must be superseded instead.',
      confirmLabel: 'Yes, remove',
    });
    if (!ok) return;
    try {
      await deleteStatutoryRate(rule.id);
      notify.success('Rate removed.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not remove that rate.'));
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Compliance"
        description="Provident fund, ESI, professional tax and income tax — the rates payroll deducts under, and when each took effect."
        actions={
          <button type="button" className="ui-btn ui-btn-secondary" onClick={seed} disabled={busy === 'seed'}>
            {busy === 'seed' ? 'Adding…' : 'Add the standard rates'}
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {schemes.length === 0 ? (
        <EmptyState
          title="No statutory schemes set up"
          description="Add the standard Indian rates to start from — provident fund, ESI, professional tax and income tax. Nothing is switched on until you say it applies."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={seed} disabled={busy === 'seed'}>
              <Plus size={16} aria-hidden="true" /> Add the standard rates
            </button>
          }
        />
      ) : (
        <div className="space-y-6">
          {schemes.map((scheme) => (
            <section key={scheme.id} className="ui-card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="ui-t-sec">{scheme.name}</h3>
                    <span className={`ui-pill ${scheme.isEnabled ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                      {scheme.isEnabled ? 'Applies' : 'Not applied'}
                    </span>
                  </div>
                  {scheme.description ? <p className="ui-caption mt-0.5">{scheme.description}</p> : null}
                </div>
                <label className="flex items-center gap-2 text-sm" htmlFor={`scheme-${scheme.id}`}>
                  <input
                    id={`scheme-${scheme.id}`}
                    type="checkbox"
                    className="ui-checkbox"
                    checked={scheme.isEnabled}
                    disabled={busy === scheme.id}
                    onChange={(e) => toggle(scheme, e.target.checked)}
                  />
                  <span>Applies to this company</span>
                </label>
              </div>

              {scheme.rules.length === 0 ? (
                <div className="p-4 flex items-start gap-2">
                  <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
                  <p className="ui-caption">
                    No rates set, so this scheme would deduct nothing. Add one before switching it on.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto ui-table-scroll">
                  <table className="ui-table w-full">
                    <thead>
                      <tr>
                        <th scope="col" className="ui-th ui-col-h-center">From</th>
                        <th scope="col" className="ui-th ui-col-h-center">To</th>
                        <th scope="col" className="ui-th">Where</th>
                        <th scope="col" className="ui-th">Rate</th>
                        <th scope="col" className="ui-th ui-col-h-right">On payslips</th>
                        <th scope="col" className="ui-th ui-col-h-center">Status</th>
                        <th scope="col" className="ui-th ui-col-h-center w-10">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheme.rules.map((rule) => (
                        <tr key={rule.id}>
                          <td className="ui-col-date ui-col-h-center">{shownDate(rule.effectiveFrom)}</td>
                          <td className="ui-col-date ui-col-h-center">{rule.effectiveTo ? shownDate(rule.effectiveTo) : '—'}</td>
                          <td className="ui-col-meta">{rule.jurisdiction || 'Everywhere'}</td>
                          <td className="ui-col-meta">{describeRate(scheme.code, rule)}</td>
                          <td className="ui-col-amount">{rule.usedOnPayslips || 0}</td>
                          <td>
                            <span className={`ui-pill ${rule.status === 'ACTIVE' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                              {rule.status === 'ACTIVE' ? 'In force' : 'Superseded'}
                            </span>
                          </td>
                          <td>
                            {rule.usedOnPayslips ? null : (
                              <button
                                type="button"
                                className="ui-icon-btn"
                                aria-label={`Remove the ${scheme.name} rate from ${rule.effectiveFrom}`}
                                onClick={() => removeRate(scheme, rule)}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAddingTo(scheme)}>
                  <Plus size={14} aria-hidden="true" /> New rate from a date
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      <Drawer
        open={Boolean(addingTo)}
        onClose={() => setAddingTo(null)}
        title={addingTo ? `New ${addingTo.name} rate` : ''}
        description="From the day it applies. The rate before it closes the day prior, so no payslip already produced changes."
      >
        {addingTo ? (
          <RateForm
            scheme={addingTo}
            onClose={() => setAddingTo(null)}
            onSaved={() => {
              setAddingTo(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

const RateForm = ({ scheme, onClose, onSaved }) => {
  /* Pre-filled from the rate in force, because a new version is usually the
     old one with one number moved. */
  const current = scheme.rules.find((r) => r.status === 'ACTIVE') || scheme.rules[0] || null;
  const [form, setForm] = useState({
    jurisdiction: current?.jurisdiction || (scheme.code === 'PT' ? '' : 'IN'),
    effectiveFrom: new Date().toISOString().slice(0, 10),
    employeeRate: current?.employeeRate ?? 0,
    employerRate: current?.employerRate ?? 0,
    wageCeiling: current?.wageCeiling ?? '',
    eligibilityThreshold: current?.eligibilityThreshold ?? '',
    rounding: current?.rounding || 'NEAREST',
    config: JSON.stringify(current?.config ?? {}, null, 2),
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  /* PT and TDS carry their shape in the configuration rather than in a rate —
     slabs and bands — so the rate fields would be meaningless for them. */
  const ratesApply = scheme.code === 'PF' || scheme.code === 'ESI' || scheme.code === 'LWF';

  const save = async (e) => {
    e.preventDefault();
    let config;
    try {
      config = JSON.parse(form.config || '{}');
    } catch {
      notify.error('The configuration is not valid JSON.');
      return;
    }
    setSaving(true);
    try {
      await addStatutoryRate(scheme.id, {
        jurisdiction: form.jurisdiction?.trim() || null,
        effectiveFrom: form.effectiveFrom,
        employeeRate: Number(form.employeeRate) || 0,
        employerRate: Number(form.employerRate) || 0,
        wageCeiling: String(form.wageCeiling).trim() === '' ? null : Number(form.wageCeiling),
        eligibilityThreshold:
          String(form.eligibilityThreshold).trim() === '' ? null : Number(form.eligibilityThreshold),
        rounding: form.rounding,
        config,
      });
      notify.success(`New ${scheme.name} rate saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that rate.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="rate-from">Applies from</label>
          <input
            id="rate-from"
            type="date"
            className="ui-input w-full"
            value={form.effectiveFrom}
            onChange={(e) => set({ effectiveFrom: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="rate-where">Where it applies</label>
          <input
            id="rate-where"
            className="ui-input w-full"
            value={form.jurisdiction}
            onChange={(e) => set({ jurisdiction: e.target.value })}
            placeholder={scheme.code === 'PT' ? 'KARNATAKA' : 'IN'}
          />
          <span className="ui-caption">
            {scheme.code === 'PT' ? 'The state this applies in.' : 'Leave as IN unless it differs by place.'}
          </span>
        </div>
      </div>

      {ratesApply ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="ui-label" htmlFor="rate-employee">Employee share (%)</label>
            <input
              id="rate-employee"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="ui-input ui-num w-full"
              value={form.employeeRate}
              onChange={(e) => set({ employeeRate: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="rate-employer">Employer share (%)</label>
            <input
              id="rate-employer"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="ui-input ui-num w-full"
              value={form.employerRate}
              onChange={(e) => set({ employerRate: e.target.value })}
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="rate-ceiling">Wage ceiling</label>
            <input
              id="rate-ceiling"
              type="number"
              min="0"
              className="ui-input ui-num w-full"
              value={form.wageCeiling}
              onChange={(e) => set({ wageCeiling: e.target.value })}
            />
            <span className="ui-caption">Above this, the contribution stops growing.</span>
          </div>
          <div>
            <label className="ui-label" htmlFor="rate-threshold">Applies up to</label>
            <input
              id="rate-threshold"
              type="number"
              min="0"
              className="ui-input ui-num w-full"
              value={form.eligibilityThreshold}
              onChange={(e) => set({ eligibilityThreshold: e.target.value })}
            />
            <span className="ui-caption">Above this, the scheme does not apply at all.</span>
          </div>
        </div>
      ) : null}

      <div>
        <label className="ui-label" htmlFor="rate-rounding">Rounding</label>
        <select
          id="rate-rounding"
          className="ui-select w-full"
          value={form.rounding}
          onChange={(e) => set({ rounding: e.target.value })}
        >
          <option value="NEAREST">Nearest rupee</option>
          <option value="UP">Up</option>
          <option value="DOWN">Down</option>
          <option value="NONE">None</option>
        </select>
      </div>

      <div>
        <label className="ui-label" htmlFor="rate-config">
          {scheme.code === 'PT' ? 'Slabs' : scheme.code === 'TDS' ? 'Tax bands' : 'Scheme settings'}
        </label>
        <textarea
          id="rate-config"
          rows={10}
          className="ui-input ui-mono w-full text-sm"
          value={form.config}
          onChange={(e) => set({ config: e.target.value })}
        />
        <span className="ui-caption">
          {scheme.code === 'PT'
            ? 'A list of slabs, each with a from, a to and an amount. A slab may name the months it applies in.'
            : scheme.code === 'PF'
              ? 'The pension split — epsRate and epsWageCeiling — and whether to contribute on the whole wage.'
              : 'Anything the scheme needs beyond the rates above.'}
        </span>
      </div>

      <p className="ui-caption">
        Saving this closes the rate before it the day before {shownDate(form.effectiveFrom)}. Payslips already produced keep
        the rate they were computed under.
      </p>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save rate'}
        </button>
      </div>
    </form>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, PenLine, Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { todayIst } from '@ui/utils/dates';
import {
  getStatutoryOverview,
  seedStatutoryRates,
  setSchemeEnabled,
  addStatutoryRate,
  deleteStatutoryRate,
  confirmStatutoryRate,
  saveLwfSettings,
  adoptStatutoryRate,
} from '../api/payrollStatutory';

/**
 * Provident fund, ESI, professional tax, Labour Welfare Fund and income tax.
 *
 * These are the amounts a company does not get to decide, and the screen is
 * shaped by three facts about them.
 *
 * A scheme is off until somebody says it applies. A deduction nobody asked for
 * is money taken from a person's pay by default, so nothing here switches
 * itself on.
 *
 * A rate is never edited. Rates change on dates somebody else picks, and a
 * payslip records the version it was computed under — so changing one means
 * publishing a new version from a date ("Correct"), and the history stays
 * visible underneath.
 *
 * Some state figures CLOR could not confirm from an official notice. Those
 * say "Check before use" until somebody here has read the state's notice and
 * confirmed them, or corrected them with a new version.
 */

const money = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

/** "WEST BENGAL" → "West Bengal". */
const stateName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, 'and');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthsText = (months) => (Array.isArray(months) && months.length ? months.map((m) => MONTHS[m - 1] || m).join(', ') : 'every month');

/** What a rate means, in the words somebody configuring payroll would use. */
const describeRate = (scheme, rule) => {
  const c = rule.config || {};
  if (scheme === 'PT') {
    if (c.notLevied) return 'No professional tax';
    const slabs = Array.isArray(c.slabs) ? c.slabs.length : 0;
    if (!slabs) return 'No slabs set';
    const basis = c.basis === 'ANNUAL' ? ' a year' : c.basis === 'HALF_YEARLY' ? ' a half-year' : '';
    const taken = Array.isArray(c.collectMonths) && c.collectMonths.length ? `, taken in ${monthsText(c.collectMonths)}` : '';
    const women = Array.isArray(c.slabs) && c.slabs.some((s) => s.gender === 'FEMALE') ? ', women’s bands' : '';
    const feb = Array.isArray(c.slabs) && c.slabs.some((s) => s.monthAmounts && s.monthAmounts['2'] != null) ? ', February differs' : '';
    return `${slabs} slab${slabs === 1 ? '' : 's'}${basis}${taken}${women}${feb}`;
  }
  if (scheme === 'LWF') {
    const funds = Array.isArray(c.funds) && c.funds.length ? c.funds : [c];
    const one = (f) =>
      f.employeeAmount != null || f.employerAmount != null
        ? `${money(f.employeeAmount || 0)} + ${money(f.employerAmount || 0)}, ${monthsText(f.months)}`
        : `${rule.employeeRate}% + ${rule.employerRate}% of pay${f.employeeCap ? `, at most ${money(f.employeeCap)} + ${money(f.employerCap)}` : ''}, ${monthsText(f.months)}`;
    const size = c.minEmployees ? ` · from ${c.minEmployees} people` : '';
    return `${funds.map(one).join('; ')}${size}`;
  }
  if (scheme === 'TDS') return 'Income tax bands';
  const parts = [`${rule.employeeRate}% employee`, `${rule.employerRate}% employer`];
  if (rule.wageCeiling) parts.push(`capped at ${money(rule.wageCeiling)}`);
  if (rule.eligibilityThreshold) parts.push(`up to ${money(rule.eligibilityThreshold)}`);
  return parts.join(' · ');
};

const REG_LABEL = {
  TDS: 'TAN',
  PF: 'PF establishment code',
  ESI: 'ESI employer code',
  PT: 'PT registration number',
  LWF: 'LWF registration number',
};

const STATE_SCHEMES = ['PT', 'LWF'];

export default function PayrollCompliance() {
  const [schemes, setSchemes] = useState([]);
  const [checks, setChecks] = useState([]);
  const [offers, setOffers] = useState([]);
  const [states, setStates] = useState([]);
  const [lwf, setLwf] = useState({ coverage: 'BY_HEADCOUNT', managerDesignations: [], supervisorDesignations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(null);
  /* Per state scheme: the states with people in payroll, or every state. */
  const [showAll, setShowAll] = useState({});

  const load = useCallback(async () => {
    try {
      const out = await getStatutoryOverview();
      setSchemes(out.schemes);
      setChecks(out.checks);
      setOffers(out.offers);
      setStates(out.states);
      setLwf(out.lwf);
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

  const peopleIn = useMemo(() => new Map(states.map((s) => [s.state, s.people])), [states]);

  const seed = async () => {
    setBusy('seed');
    try {
      const out = await seedStatutoryRates();
      const kept = Array.isArray(out.kept) ? out.kept.length : 0;
      notify.success(
        out.count
          ? `${out.count} rate${out.count === 1 ? '' : 's'} added.${kept ? ` Your own rates in ${kept} place${kept === 1 ? '' : 's'} were kept.` : ''}`
          : 'Already up to date.'
      );
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

  /* The number each return is filed under: TAN for TDS, the establishment codes for PF and ESI. */
  const saveNumber = async (scheme, value) => {
    const next = value.trim();
    if (next === (scheme.registrationNumber || '')) return;
    setBusy(scheme.id);
    try {
      await setSchemeEnabled(scheme.id, scheme.isEnabled, next || null);
      notify.success(`${REG_LABEL[scheme.code] || 'Registration number'} saved.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not save that number.'));
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

  const confirmRate = async (check) => {
    const ok = await confirmDialog({
      title: `Confirm ${check.state} ${check.scheme === 'LWF' ? 'Labour Welfare Fund' : 'professional tax'}?`,
      message: `Only once you have read ${check.state}’s current notice and the figures match. This clears the warning for this version; a later version is checked again.`,
      confirmLabel: 'The figures match',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(check.ruleId);
    try {
      await confirmStatutoryRate(check.ruleId);
      notify.success(`${check.state} confirmed.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not confirm that rate.'));
    } finally {
      setBusy('');
    }
  };

  const adopt = async (offer) => {
    const ok = await confirmDialog({
      title: `Use CLOR’s ${offer.state} figures?`,
      message: `They apply from ${shownDate(offer.effectiveFrom)}. Your own rate closes the day before and stays on record; payslips already produced keep the rate they used.`,
      confirmLabel: 'Use these figures',
      tone: 'primary',
    });
    if (!ok) return;
    setBusy(offer.ruleId);
    try {
      await adoptStatutoryRate(offer.ruleId);
      notify.success(`${offer.state} now uses CLOR’s figures.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not adopt those figures.'));
    } finally {
      setBusy('');
    }
  };

  const keepMine = async (offer) => {
    setBusy(offer.ruleId);
    try {
      await deleteStatutoryRate(offer.ruleId);
      notify.success(`Your own ${offer.state} rate stays. CLOR will not offer these figures again.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not dismiss those figures.'));
    } finally {
      setBusy('');
    }
  };

  const correct = (ruleId) => {
    for (const scheme of schemes) {
      const rule = scheme.rules.find((r) => r.id === ruleId);
      if (rule) return setAdding({ scheme, from: rule });
    }
    return null;
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="compliance"
        title="Compliance"
        description="Provident fund, ESI, professional tax, Labour Welfare Fund and income tax — the rates payroll deducts under, and when each took effect."
        actions={
          <button type="button" className="ui-btn ui-btn-secondary" onClick={seed} disabled={busy === 'seed'}>
            {busy === 'seed' ? 'Adding…' : 'Add the standard rates'}
          </button>
        }
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4">

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {checks.length ? (
        <section className="ui-card overflow-hidden" aria-labelledby="check-before-use">
          <div className="flex items-start gap-2 px-4 py-3" style={{ background: 'rgb(var(--warn-soft))', borderBottom: '1px solid rgb(var(--border))' }}>
            <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
            <div className="min-w-0">
              <h3 id="check-before-use" className="ui-t-sec">Check before use</h3>
              <p className="ui-caption">
                CLOR could not confirm these figures from an official notice. Check each against the state’s current notice, then confirm it, or correct it with the right figures.
              </p>
            </div>
          </div>
          <ul>
            {checks.map((c, i) => (
              <li key={c.ruleId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid rgb(var(--border))' : 'none' }}>
                <div className="min-w-0 max-w-3xl">
                  <div className="text-sm font-medium">
                    {c.state} — {c.scheme === 'LWF' ? 'Labour Welfare Fund' : 'Professional tax'}, from {shownDate(c.effectiveFrom)}
                  </div>
                  <div className="ui-caption">
                    {c.people} {c.people === 1 ? 'person' : 'people'} in payroll there
                    {c.usedOnPayslips ? ` · on ${c.usedOnPayslips} payslip line${c.usedOnPayslips === 1 ? '' : 's'}` : ''}
                  </div>
                  {c.note ? <p className="ui-caption mt-1">{c.note}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => correct(c.ruleId)}>
                    <PenLine size={14} aria-hidden="true" /> Correct
                  </button>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => confirmRate(c)} disabled={busy === c.ruleId}>
                    <Check size={14} aria-hidden="true" /> Confirm
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {offers.length ? (
        <section className="ui-card overflow-hidden" aria-labelledby="clor-newer">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            <h3 id="clor-newer" className="ui-t-sec">CLOR has newer figures</h3>
            <p className="ui-caption">
              You set your own rate for these states, so CLOR’s newer figures are not used until you choose them. Your rate stays in force meanwhile.
            </p>
          </div>
          <ul>
            {offers.map((o, i) => (
              <li key={o.ruleId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderTop: i ? '1px solid rgb(var(--border))' : 'none' }}>
                <div className="min-w-0 max-w-3xl">
                  <div className="text-sm font-medium">
                    {o.state} — {o.scheme === 'LWF' ? 'Labour Welfare Fund' : 'Professional tax'}, from {shownDate(o.effectiveFrom)}
                  </div>
                  {o.yours ? <div className="ui-caption">In force now: your rate from {shownDate(o.yours.effectiveFrom)}</div> : null}
                  {o.note ? <p className="ui-caption mt-1">{o.note}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => keepMine(o)} disabled={busy === o.ruleId}>
                    Keep mine
                  </button>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => adopt(o)} disabled={busy === o.ruleId}>
                    <Check size={14} aria-hidden="true" /> Use CLOR’s
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {schemes.length === 0 ? (
        <EmptyState
          title="No statutory schemes set up"
          description="Add the standard Indian rates to start from — provident fund, ESI, professional tax and Labour Welfare Fund for every state that levies them, and income tax. Nothing is switched on until you say it applies."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={seed} disabled={busy === 'seed'}>
              <Plus size={16} aria-hidden="true" /> Add the standard rates
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {schemes.map((scheme) => {
            const byState = STATE_SCHEMES.includes(scheme.code);
            const all = !byState || showAll[scheme.code] || !states.length;
            const rules = byState
              ? [...scheme.rules]
                  /* CLOR's offered figures are listed above until adopted, not as rates. */
                  .filter((r) => r.status !== 'DRAFT')
                  .filter((r) => all || peopleIn.has(String(r.jurisdiction || '').toUpperCase()))
                  .sort((a, b) => String(a.jurisdiction).localeCompare(String(b.jurisdiction)) || (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
              : scheme.rules;
            return (
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
                    {REG_LABEL[scheme.code] ? (
                      <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className="ui-caption">{REG_LABEL[scheme.code]}</span>
                        <input
                          key={scheme.registrationNumber || ''}
                          className="ui-input w-52 uppercase"
                          maxLength={60}
                          defaultValue={scheme.registrationNumber || ''}
                          disabled={busy === scheme.id}
                          onBlur={(e) => saveNumber(scheme, e.target.value.toUpperCase())}
                        />
                      </label>
                    ) : null}
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

                {byState && states.length ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
                    <span className="ui-caption">
                      {all ? 'Every state' : `The ${states.length === 1 ? 'state' : `${states.length} states`} you have people in: ${states.map((s) => s.label).join(', ')}`}
                    </span>
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setShowAll((p) => ({ ...p, [scheme.code]: !all }))}>
                      {all ? 'Only states with people' : 'Show every state'}
                    </button>
                  </div>
                ) : null}

                {scheme.rules.length === 0 ? (
                  <div className="p-4 flex items-start gap-2">
                    <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
                    <p className="ui-caption">
                      No rates set, so this scheme would deduct nothing. Add one before switching it on.
                    </p>
                  </div>
                ) : rules.length === 0 ? (
                  <p className="ui-caption p-4">No rate for the states you have people in. Show every state, or add one.</p>
                ) : (
                  <div className="ui-table-scroll">
                    <table className="ui-table ui-table-sticky w-full">
                      <thead>
                        <tr>
                          <th scope="col" className="ui-col-h-center">From</th>
                          <th scope="col" className="ui-col-h-center">To</th>
                          <th scope="col">Where</th>
                          <th scope="col">Rate</th>
                          <th scope="col" className="ui-col-h-right">On payslips</th>
                          <th scope="col" className="ui-col-h-center">Status</th>
                          <th scope="col" className="ui-col-h-center w-20">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="ui-rows">
                        {rules.map((rule) => (
                          <tr key={rule.id}>
                            <td className="ui-col-date ui-col-h-center">{shownDate(rule.effectiveFrom)}</td>
                            <td className="ui-col-date ui-col-h-center">{rule.effectiveTo ? shownDate(rule.effectiveTo) : '—'}</td>
                            <td className="ui-col-meta">
                              {rule.jurisdiction ? (byState ? stateName(rule.jurisdiction) : rule.jurisdiction) : 'Everywhere'}
                              {rule.config?.localBody ? <span className="ui-caption block">{rule.config.localBody}</span> : null}
                            </td>
                            <td className="ui-col-meta">
                              {describeRate(scheme.code, rule)}
                              {byState && rule.note ? <span className="ui-caption block max-w-xl whitespace-normal">{rule.note}</span> : null}
                            </td>
                            <td className="ui-col-amount">{rule.usedOnPayslips || 0}</td>
                            <td>
                              <div className="flex flex-col items-center gap-1">
                                <span className={`ui-pill ${rule.status === 'ACTIVE' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                                  {rule.status === 'ACTIVE' ? 'In force' : 'Superseded'}
                                </span>
                                {rule.needsCheck ? <span className="ui-pill ui-pill-warn">Check before use</span> : null}
                              </div>
                            </td>
                            <td>
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  className="ui-icon-btn"
                                  aria-label={`Correct the ${scheme.name} rate${rule.jurisdiction ? ` for ${stateName(rule.jurisdiction)}` : ''} from ${rule.effectiveFrom}`}
                                  title="Correct: a new version from a date"
                                  onClick={() => setAdding({ scheme, from: rule })}
                                >
                                  <PenLine size={16} aria-hidden="true" />
                                </button>
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
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAdding({ scheme, from: null })}>
                    <Plus size={14} aria-hidden="true" /> New rate from a date
                  </button>
                </div>

                {scheme.code === 'LWF' ? <LwfSettings value={lwf} onSaved={(next) => setLwf(next)} /> : null}
              </section>
            );
          })}
        </div>
      )}

      <Drawer
        open={Boolean(adding)}
        onClose={() => setAdding(null)}
        /* Short enough for a phone: the state is what matters. */
        title={adding ? (adding.from ? `Correct rate${adding.from.jurisdiction ? ` · ${STATE_SCHEMES.includes(adding.scheme.code) ? stateName(adding.from.jurisdiction) : adding.from.jurisdiction}` : ''}` : `New ${adding.scheme.name} rate`) : ''}
      >
        {adding ? (
          <RateForm
            scheme={adding.scheme}
            from={adding.from}
            onClose={() => setAdding(null)}
            onSaved={() => {
              setAdding(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
      </div>
    </div>
  );
}

/**
 * What LWF cannot read from payroll: whether a state's size threshold is
 * met, and who is a manager or supervisor. Both default to the safe side —
 * the headcount payroll has, and nobody left out.
 */
const LwfSettings = ({ value, onSaved }) => {
  const lines = (list) => (list || []).join('\n');
  const [coverage, setCoverage] = useState(value.coverage || 'BY_HEADCOUNT');
  const [managers, setManagers] = useState(lines(value.managerDesignations));
  const [supervisors, setSupervisors] = useState(lines(value.supervisorDesignations));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCoverage(value.coverage || 'BY_HEADCOUNT');
    setManagers(lines(value.managerDesignations));
    setSupervisors(lines(value.supervisorDesignations));
  }, [value]);

  const list = (text) =>
    text
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean);
  const save = async () => {
    setSaving(true);
    try {
      const next = await saveLwfSettings({ coverage, managerDesignations: list(managers), supervisorDesignations: list(supervisors) });
      notify.success('LWF settings saved.');
      onSaved(next);
    } catch (e) {
      notify.error(String(e?.message || 'Could not save the LWF settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-3 space-y-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
      <h4 className="ui-sec-head">Who LWF covers</h4>
      <fieldset className="space-y-2">
        <legend className="ui-label">Size of each establishment</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="lwf-coverage" className="mt-1" checked={coverage === 'BY_HEADCOUNT'} onChange={() => setCoverage('BY_HEADCOUNT')} />
          <span>
            Count the people in payroll in each state
            <span className="ui-caption block">Most states start LWF at a size — Karnataka at 10, Andhra Pradesh at 20. Below it, nothing is deducted.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="lwf-coverage" className="mt-1" checked={coverage === 'ALWAYS'} onChange={() => setCoverage('ALWAYS')} />
          <span>
            We are covered in every state where we have staff
            <span className="ui-caption block">For example, contract staff not paid through CLOR take you over the size.</span>
          </span>
        </label>
      </fieldset>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        <div>
          <label className="ui-label" htmlFor="lwf-managers">Managers</label>
          <textarea id="lwf-managers" rows={3} className="ui-input w-full text-sm" value={managers} onChange={(e) => setManagers(e.target.value)} placeholder={'Branch Manager\nGeneral Manager'} />
          <span className="ui-caption block">Left out of LWF wherever the state’s Act leaves managers out, whatever they earn.</span>
        </div>
        <div>
          <label className="ui-label" htmlFor="lwf-supervisors">Supervisors</label>
          <textarea id="lwf-supervisors" rows={3} className="ui-input w-full text-sm" value={supervisors} onChange={(e) => setSupervisors(e.target.value)} placeholder={'Supervisor\nShift In-charge'} />
          <span className="ui-caption block">Left out only above the state’s pay limit for supervisors (₹3,500 in Maharashtra, ₹15,000 in Tamil Nadu). Where a state sets none, they contribute.</span>
        </div>
      </div>
      <p className="ui-caption max-w-xl">
        One designation per line, as written on People records. CLOR cannot tell who is a manager or a supervisor from a title alone, so with none listed, LWF is deducted for everybody.
      </p>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save LWF settings'}
      </button>
    </div>
  );
};


const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A professional tax rule's settings, as the plain bands editor holds them. Anything it does not show is kept as it was. */
const ptFormFrom = (config = {}) => {
  const { slabs, basis, collectMonths, localBody, needsCheck, ...rest } = config || {};
  void needsCheck;
  return {
    basis: basis === 'ANNUAL' || basis === 'HALF_YEARLY' ? basis : 'MONTHLY',
    collectMonths: Array.isArray(collectMonths) ? collectMonths.map(Number) : [],
    localBody: localBody || '',
    rest,
    bands: (Array.isArray(slabs) ? slabs : []).map((s) => {
      const special = Object.entries(s.monthAmounts || {})[0] || null;
      return {
        from: s.from ?? 0,
        to: s.to == null ? '' : s.to,
        amount: s.amount ?? 0,
        gender: s.gender || '',
        specialMonth: special ? String(special[0]) : '',
        specialAmount: special ? String(special[1]) : '',
        /* An older way of writing a month's amount; kept as it was. */
        months: Array.isArray(s.months) ? s.months : null,
      };
    }),
  };
};

const ptConfigOf = (pt) => ({
  ...pt.rest,
  ...(pt.basis !== 'MONTHLY' ? { basis: pt.basis } : {}),
  ...(pt.basis !== 'MONTHLY' && pt.collectMonths.length ? { collectMonths: [...pt.collectMonths].sort((a, b) => a - b) } : {}),
  ...(pt.localBody.trim() ? { localBody: pt.localBody.trim() } : {}),
  slabs: pt.bands.map((b) => ({
    from: Number(b.from) || 0,
    to: String(b.to).trim() === '' ? null : Number(b.to),
    amount: Number(b.amount) || 0,
    ...(b.gender ? { gender: b.gender } : {}),
    ...(b.specialMonth && String(b.specialAmount).trim() !== '' ? { monthAmounts: { [b.specialMonth]: Number(b.specialAmount) } } : {}),
    ...(b.months ? { months: b.months } : {}),
  })),
});

/**
 * A new band starts a paisa above the last band's "up to". A last band left
 * open ("No limit") is closed first, at its own "from", for HR to set.
 */
const addBand = (bands) => {
  const last = bands[bands.length - 1];
  if (!last) return [{ from: 0, to: '', amount: 0, gender: '', specialMonth: '', specialAmount: '', months: null }];
  const upTo = String(last.to).trim() === '' ? Number(last.from) || 0 : Number(last.to);
  const closed = bands.map((b, i) => (i === bands.length - 1 ? { ...b, to: upTo } : b));
  return [...closed, { from: Math.round((upTo + 0.01) * 100) / 100, to: '', amount: 0, gender: last.gender || '', specialMonth: '', specialAmount: '', months: null }];
};

/**
 * Professional tax bands, in plain fields: from, to and the amount, who a
 * band is for, and a different amount in one month (February, in
 * Karnataka and Maharashtra). Yearly and half-yearly states say what the
 * bands are measured in and when the tax is taken.
 */
const PtBandsEditor = ({ value, onChange }) => {
  const set = (patch) => onChange({ ...value, ...patch });
  const setBand = (i, patch) => set({ bands: value.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const per = value.basis === 'ANNUAL' ? 'a year' : value.basis === 'HALF_YEARLY' ? 'a half-year' : 'a month';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="pt-basis">Bands are for pay</label>
          <select id="pt-basis" className="ui-select w-full" value={value.basis} onChange={(e) => set({ basis: e.target.value })}>
            <option value="MONTHLY">Per month</option>
            <option value="ANNUAL">Per year</option>
            <option value="HALF_YEARLY">Per half-year</option>
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="pt-local">Corporation or municipality</label>
          <input id="pt-local" className="ui-input w-full" value={value.localBody} onChange={(e) => set({ localBody: e.target.value })} />
          <span className="ui-caption">Only where the tax is set locally, as in Tamil Nadu and Kerala.</span>
        </div>
      </div>

      {value.basis !== 'MONTHLY' ? (
        <fieldset>
          <legend className="ui-label">Taken in</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {MONTH_NAMES.map((name, i) => (
              <label key={name} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={value.collectMonths.includes(i + 1)}
                  onChange={(e) => set({ collectMonths: e.target.checked ? [...value.collectMonths, i + 1] : value.collectMonths.filter((m) => m !== i + 1) })}
                />
                {name.slice(0, 3)}
              </label>
            ))}
          </div>
          <span className="ui-caption">None ticked: spread over every month, with the balance in March.</span>
        </fieldset>
      ) : null}

      <div className="ui-table-scroll">
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col" className="ui-col-h-right">Pay from (₹)</th>
              <th scope="col" className="ui-col-h-right">Up to (₹)</th>
              <th scope="col" className="ui-col-h-right">Tax {per} (₹)</th>
              <th scope="col">For</th>
              <th scope="col">Different in</th>
              <th scope="col" className="ui-col-h-right">Amount (₹)</th>
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {value.bands.map((b, i) => (
              <tr key={i}>
                <td><input aria-label={`Band ${i + 1}: pay from`} type="number" min="0" step="0.01" className="ui-input ui-num w-28" value={b.from} onChange={(e) => setBand(i, { from: e.target.value })} /></td>
                <td><input aria-label={`Band ${i + 1}: up to`} type="number" min="0" step="0.01" className="ui-input ui-num w-28" value={b.to} placeholder="No limit" onChange={(e) => setBand(i, { to: e.target.value })} /></td>
                <td><input aria-label={`Band ${i + 1}: tax`} type="number" min="0" step="0.01" className="ui-input ui-num w-24" value={b.amount} onChange={(e) => setBand(i, { amount: e.target.value })} /></td>
                <td>
                  <select aria-label={`Band ${i + 1}: for`} className="ui-select w-36" value={b.gender} onChange={(e) => setBand(i, { gender: e.target.value })}>
                    <option value="">Everyone</option>
                    <option value="FEMALE">Women</option>
                    <option value="MALE">Men and others</option>
                  </select>
                </td>
                <td>
                  <select aria-label={`Band ${i + 1}: different amount in`} className="ui-select w-32" value={b.specialMonth} onChange={(e) => setBand(i, { specialMonth: e.target.value })}>
                    <option value="">No month</option>
                    {MONTH_NAMES.map((name, m) => (
                      <option key={name} value={String(m + 1)}>{name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input aria-label={`Band ${i + 1}: amount in that month`} type="number" min="0" step="0.01" className="ui-input ui-num w-24" value={b.specialAmount} disabled={!b.specialMonth} onChange={(e) => setBand(i, { specialAmount: e.target.value })} />
                </td>
                <td>
                  <button type="button" className="ui-icon-btn" aria-label={`Remove band ${i + 1}`} onClick={() => set({ bands: value.bands.filter((_, j) => j !== i) })}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="ui-btn ui-btn-secondary ui-btn-sm"
        onClick={() => set({ bands: addBand(value.bands) })}
      >
        <Plus size={14} aria-hidden="true" /> Add a band
      </button>
      <p className="ui-caption">
        Each band runs from its first figure up to and including the second; leave the last one open. Take the figures from the state’s current notice.
      </p>
    </div>
  );
};

const RateForm = ({ scheme, from, onClose, onSaved }) => {
  /* Pre-filled from the rate being corrected, or the one in force, because a
     new version is usually the old one with one number moved. */
  const current = from || scheme.rules.find((r) => r.status === 'ACTIVE') || scheme.rules[0] || null;
  const [form, setForm] = useState({
    /* A state as people write it ("Tamil Nadu"); the server stores one spelling. */
    jurisdiction: current?.jurisdiction ? (STATE_SCHEMES.includes(scheme.code) ? stateName(current.jurisdiction) : current.jurisdiction) : STATE_SCHEMES.includes(scheme.code) ? '' : 'IN',
    /* Today in India, not in UTC: before 5:30 am the UTC date is still yesterday. */
    effectiveFrom: todayIst(),
    employeeRate: current?.employeeRate ?? 0,
    employerRate: current?.employerRate ?? 0,
    wageCeiling: current?.wageCeiling ?? '',
    eligibilityThreshold: current?.eligibilityThreshold ?? '',
    rounding: current?.rounding || 'NEAREST',
    /* Without CLOR's "check before use" flag: figures somebody saves are their own reading. */
    config: JSON.stringify(Object.fromEntries(Object.entries(current?.config ?? {}).filter(([k]) => k !== 'needsCheck')), null, 2),
  });
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  /* Professional tax: plain bands rather than the settings text. */
  const [pt, setPt] = useState(() => ptFormFrom(current?.config));
  const isPt = scheme.code === 'PT';

  /* PT and TDS carry their shape in the configuration rather than in a rate —
     slabs and bands — so the rate fields would be meaningless for them. */
  const ratesApply = scheme.code === 'PF' || scheme.code === 'ESI' || scheme.code === 'LWF';

  const save = async (e) => {
    e.preventDefault();
    let config;
    if (isPt) config = ptConfigOf(pt);
    else {
      try {
        config = JSON.parse(form.config || '{}');
      } catch {
        notify.error('The scheme settings could not be read. Check the brackets and commas.');
        return;
      }
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
    <form onSubmit={save} className="space-y-4">
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
            placeholder={STATE_SCHEMES.includes(scheme.code) ? 'Karnataka' : 'IN'}
          />
          <span className="ui-caption">
            {scheme.code === 'PT' || scheme.code === 'LWF' ? 'The state this applies in.' : 'Leave as IN unless it differs by place.'}
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

      {isPt ? (
        <PtBandsEditor value={pt} onChange={setPt} />
      ) : (
        <div>
          <label className="ui-label" htmlFor="rate-config">
            {scheme.code === 'TDS' ? 'Tax bands' : 'Scheme settings'}
          </label>
          <textarea
            id="rate-config"
            rows={10}
            className="ui-input ui-mono w-full text-sm"
            value={form.config}
            onChange={(e) => set({ config: e.target.value })}
          />
          <span className="ui-caption">
            {scheme.code === 'LWF'
              ? 'Copied from the rate you are correcting: change only the figures — the amounts from pay and from the employer, the months it is collected in, and the number of people it starts at — to match the state’s current notice.'
              : scheme.code === 'PF'
                ? 'Copied from the rate you are correcting: the pension share and its wage ceiling, and whether the company contributes on the whole wage.'
                : 'Copied from the rate you are correcting: change only the figures.'}
          </span>
        </div>
      )}

      <p className="ui-caption">
        Saving this closes the rate before it the day before {shownDate(form.effectiveFrom)}. Payslips already produced keep
        the rate they were computed under. Rates you save count as checked.
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

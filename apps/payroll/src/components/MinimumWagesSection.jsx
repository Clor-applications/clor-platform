import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Trash2, Upload } from '@ui/components/ui/lineIcons';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';
import { formatDateIn, todayIst } from '@ui/utils/dates';
import { moneyCell } from '@ui/utils/money';
import { requestOpenScreen } from '@platform/context';
import { inForceIds, SKILL_LEVELS } from './minimumWageText';
import { addMinimumWage, getMinimumWages, importMinimumWages, removeMinimumWage } from '../api/payrollMinimumWages';
import { errorWords } from '@ui/utils/errorWords';

const STATES = [...new Set(Object.values(GST_STATE_BY_CODE).filter((s) => !/\(Old\)/.test(s)))].sort((a, b) => a.localeCompare(b));
const TEMPLATE = 'state,zone,skill,effective_from,monthly_rate,note\n';
const BLANK = { state: '', zone: '', skill: 'UNSKILLED', effectiveFrom: '', monthlyRate: '', note: '' };

/**
 * Round 66 "minwage": minimum wages per state, entered or imported by HR from
 * the state's notification. CLOR ships no rates. Pay runs and salaries are
 * checked against them for each person's state, zone and skill level.
 */
export default function MinimumWagesSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState('');
  const [importErrors, setImportErrors] = useState([]);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    getMinimumWages()
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load minimum wages')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const today = todayIst();
  const rates = useMemo(() => data?.rates || [], [data]);
  const live = useMemo(() => inForceIds(rates, today), [rates, today]);

  const save = async (e) => {
    e.preventDefault();
    setBusy('add');
    try {
      const r = await addMinimumWage({ ...form, monthlyRate: Number(String(form.monthlyRate).replace(/[,\s]/g, '')) });
      notify.success(r?.replaced ? 'Rate replaced.' : 'Rate added.');
      setForm(BLANK);
      setAdding(false);
      load();
    } catch (err) {
      notify.error(errorWords(err, 'add that rate'));
    } finally {
      setBusy('');
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('import');
    setImportErrors([]);
    try {
      const text = await file.text();
      const r = await importMinimumWages(text);
      notify.success(`Imported: ${r.added} added, ${r.replaced} replaced.`);
      load();
    } catch (err) {
      setImportErrors(Array.isArray(err?.data?.errors) ? err.data.errors : []);
      notify.error(errorWords(err, 'import that file'));
    } finally {
      setBusy('');
    }
  };

  const remove = async (r) => {
    const ok = await confirmDialog({
      title: 'Remove this rate?',
      message: `${r.stateLabel}${r.zone ? ` (${r.zone})` : ''}, ${r.skillLabel}, from ${formatDateIn(r.effectiveFrom)}. Pay is no longer checked against it.`,
      confirmLabel: 'Remove rate',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removeMinimumWage(r.id);
      notify.success('Rate removed.');
      load();
    } catch (err) {
      notify.error(errorWords(err, 'remove that rate'));
    }
  };

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section id="scheme-section-MINWAGE" className="ui-list-surface overflow-hidden" aria-labelledby="minimum-wages-title">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
        <div className="min-w-0">
          <h3 id="minimum-wages-title" className="ui-t-sec">Minimum wages</h3>
          <p className="ui-caption max-w-2xl">
            A month’s minimum wage per state and skill level, by zone where the state sets zones. Pay runs and salaries are checked against the rate for each person’s state, zone and skill level.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="ui-link ui-caption" href={templateHref} download="minimum-wages.csv">CSV template</a>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="Import minimum wages from a CSV file" tabIndex={-1} />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => fileRef.current?.click()} disabled={busy === 'import'}>
            <Upload size={14} aria-hidden="true" /> {busy === 'import' ? 'Importing…' : 'Import CSV'}
          </button>
        </div>
      </div>

      {data?.reminder ? (
        <div className="flex items-start gap-2 px-4 py-3" role="note" style={{ background: 'rgb(var(--warn-soft))', borderBottom: '1px solid rgb(var(--border))' }}>
          <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
          <p className="ui-caption">{data.reminder.message}</p>
        </div>
      ) : null}

      {importErrors.length ? (
        <div className="px-4 py-3" role="alert" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <p className="ui-caption">Nothing was saved. Fix these lines and import again:</p>
          <ul className="ui-caption mt-1 space-y-0.5">
            {importErrors.map((x) => (
              <li key={`${x.line}-${x.error}`}>Line {x.line}: {x.error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="ui-caption p-4" role="alert">{error}</p> : null}

      {data && !rates.length ? (
        <div className="p-4 space-y-1">
          <p className="ui-caption">
            No rates yet, so nobody’s pay is checked. CLOR does not supply minimum wage rates: take them from your state labour department’s latest minimum wages notification, for each skill level (and zone, if the state has zones), and add or import them here.
          </p>
          <p className="ui-caption">
            Rates in the central sphere are notified by the{' '}
            <a className="ui-link" href="https://clc.gov.in/" target="_blank" rel="noreferrer noopener">Chief Labour Commissioner</a>. States revise the dearness part in April and October.
          </p>
        </div>
      ) : null}

      {rates.length ? (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-phone w-full">
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col">Zone</th>
                <th scope="col">Skill level</th>
                <th scope="col" className="ui-col-h-center">From</th>
                <th scope="col" className="ui-col-h-right">A month</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col" className="ui-col-h-center w-16"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-meta" data-phone="name">
                    {r.stateLabel}
                    {r.note ? <span className="ui-caption block max-w-xs whitespace-normal">{r.note}</span> : null}
                  </td>
                  <td className="ui-col-meta">{r.zone || 'Whole state'}</td>
                  <td className="ui-col-meta" data-phone="sub">{r.skillLabel.charAt(0).toUpperCase() + r.skillLabel.slice(1)}</td>
                  <td className="ui-col-date ui-col-h-center">{formatDateIn(r.effectiveFrom)}</td>
                  <td className="ui-col-amount" data-phone="key">{moneyCell(r.monthlyRate)}</td>
                  <td className="text-center" data-phone="tag">
                    <span className={`ui-pill ${live.has(r.id) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                      {live.has(r.id) ? 'In force' : r.effectiveFrom > today ? 'Upcoming' : 'Earlier'}
                    </span>
                  </td>
                  <td className="text-center" data-phone="act">
                    <button type="button" className="ui-icon-btn" onClick={() => remove(r)} aria-label={`Remove the ${r.stateLabel} ${r.skillLabel} rate from ${r.effectiveFrom}`}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {adding ? (
        <form className="ui-minwage-form px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }} onSubmit={save} aria-label="Add a minimum wage rate">
          <div>
            <label className="ui-label" htmlFor="mw-state">State</label>
            <select id="mw-state" className="ui-select w-full" value={form.state} onChange={set('state')} required>
              <option value="">Choose a state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="mw-zone">Zone</label>
            <input id="mw-zone" className="ui-input w-full" value={form.zone} onChange={set('zone')} placeholder="Whole state" maxLength={60} />
          </div>
          <div>
            <label className="ui-label" htmlFor="mw-skill">Skill level</label>
            <select id="mw-skill" className="ui-select w-full" value={form.skill} onChange={set('skill')}>
              {SKILL_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="mw-from">Applies from</label>
            <input id="mw-from" type="date" className="ui-input w-full" value={form.effectiveFrom} onChange={set('effectiveFrom')} required />
          </div>
          <div>
            <label className="ui-label" htmlFor="mw-rate">Monthly rate</label>
            <input id="mw-rate" inputMode="decimal" className="ui-input w-full tabular-nums text-right" value={form.monthlyRate} onChange={set('monthlyRate')} required />
          </div>
          <div className="ui-minwage-note">
            <label className="ui-label" htmlFor="mw-note">Notification</label>
            <input id="mw-note" className="ui-input w-full" value={form.note} onChange={set('note')} placeholder="Notification number or link" maxLength={300} />
          </div>
          <div className="ui-minwage-actions flex items-center gap-2">
            <button type="submit" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === 'add'}>{busy === 'add' ? 'Saving…' : 'Save rate'}</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setAdding(false); setForm(BLANK); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgb(var(--border))' }}>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" /> Add a rate
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Round 66: the April and October reminder on the Payroll overview. Quiet when
 * there is nothing to say, and when the rates cannot be read (no settings view).
 */
export function MinimumWageReminder() {
  const [reminder, setReminder] = useState(null);
  useEffect(() => {
    let live = true;
    getMinimumWages()
      .then((r) => live && setReminder(r?.reminder || null))
      .catch(() => live && setReminder(null));
    return () => {
      live = false;
    };
  }, []);
  if (!reminder) return null;
  return (
    <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3" role="note">
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
        <div className="min-w-0">
          <div className="ui-sec-head">Update minimum wages</div>
          <p className="ui-caption">{reminder.message}</p>
        </div>
      </div>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => requestOpenScreen('compliance', { scheme: 'MINWAGE' })}>
        Update rates
      </button>
    </div>
  );
}

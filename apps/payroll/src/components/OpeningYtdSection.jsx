import React, { useEffect, useState } from 'react';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { deleteOpeningYtd, getOpeningYtd, saveOpeningYtd } from '../api/payrollTaxDeclarations';

/**
 * One person's pay earlier in the financial year, before CLOR ran payroll
 * (opening year-to-date figures). Income tax for the rest of the year counts
 * it as pay and tax so far; Form 16 adds it in. Saved on its own, apart from
 * the declaration, and open even once the proofs are verified.
 */
const FIELDS = [
  ['grossPay', 'Gross pay', 'Everything paid in those months.'],
  ['taxablePay', 'Taxable pay', 'Left blank, the gross is used.'],
  ['tds', 'Income tax deducted', ''],
  ['professionalTax', 'Professional tax', ''],
  ['employeePf', 'Employee PF', 'Their own share, for 80C.'],
];

const empty = { grossPay: '', taxablePay: '', tds: '', professionalTax: '', employeePf: '', throughMonth: '', note: '' };
const formOf = (o) => (o ? Object.fromEntries(Object.keys(empty).map((k) => [k, o[k] ?? ''])) : empty);

export default function OpeningYtdSection({ employeeId, fy, onChanged }) {
  const [saved, setSaved] = useState(undefined);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getOpeningYtd(employeeId, fy)
      .then((o) => {
        if (!live) return;
        setSaved(o);
        setForm(formOf(o));
      })
      .catch(() => live && setSaved(null));
    return () => {
      live = false;
    };
  }, [employeeId, fy]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const start = Number(String(fy).slice(0, 4));

  const save = async () => {
    setBusy(true);
    try {
      const o = await saveOpeningYtd(employeeId, fy, form);
      setSaved(o);
      setForm(formOf(o));
      notify.success('Saved. The next payroll counts it.');
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: 'Remove these figures?', message: 'The next payroll will treat this year as if nothing was paid before CLOR.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteOpeningYtd(employeeId, fy);
      setSaved(null);
      setForm(empty);
      notify.success('Removed.');
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not removed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-3" aria-labelledby={`opening-${employeeId}`}>
      <div>
        {/* Same weight as the Form 12B heading above it in the drawer. */}
        <span id={`opening-${employeeId}`} className="ui-label">Earlier this year, before CLOR</span>
        <p className="ui-caption">
          What this company paid them from April {start} until payroll moved to CLOR, and the tax taken from it. Tax for the rest of the year starts from here. Enter nil if they were
          paid nothing.
        </p>
      </div>
      <fieldset disabled={busy || saved === undefined} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FIELDS.map(([key, label, hint]) => (
          <div key={key}>
            <label className="ui-label" htmlFor={`op-${key}`}>{label}</label>
            <input id={`op-${key}`} type="number" min="0" step="1" inputMode="decimal" className="ui-input ui-num w-full" value={form[key]} onChange={(e) => set({ [key]: e.target.value })} />
            {hint ? <span className="ui-caption">{hint}</span> : null}
          </div>
        ))}
        <div>
          <label className="ui-label" htmlFor="op-through">Up to</label>
          <input id="op-through" type="month" min={`${start}-04`} max={`${start + 1}-03`} className="ui-input w-full" value={form.throughMonth} onChange={(e) => set({ throughMonth: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <label className="ui-label" htmlFor="op-note">Note</label>
          <SuggestInput id="op-note" value={form.note} onChange={(v) => set({ note: v })} maxLength={300} placeholder="e.g. From the old payroll's September register" suggestions={[]} aria-label="Note" />
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        {saved ? (
          <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={remove}>Remove</button>
        ) : null}
        <button type="button" className="ui-btn ui-btn-secondary" disabled={busy || saved === undefined} onClick={save}>
          {saved ? 'Save changes' : 'Save these figures'}
        </button>
      </div>
    </section>
  );
}

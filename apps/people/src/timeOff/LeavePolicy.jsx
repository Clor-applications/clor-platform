import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CircleSlash, Plus, Wallet } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { ACCRUAL_LABEL, MONTH_NAMES, colorOf, createLeaveType, creditText, deleteLeaveType, getLeaveSettings, listLeaveTypes, saveLeaveSettings, updateLeaveType } from './api';

/**
 * People → Settings → Leave Policy (founder, 22 Oct 2026: the full leave
 * module in HR). Each type says what it gives, who it is for, how it is asked
 * for, and what happens to what is left. The same types Attendance uses.
 */
const BLANK = {
  name: '', code: '', description: '', color: '', isPaid: true, isActive: true,
  annualDays: 12, accrual: 'YEARLY', creditOn: 'START', creditDay: '', prorateForJoiners: true, carryForwardMax: '',
  gender: '', employeeTypeIds: [], availableAfterDays: '',
  allowHalfDay: true, minNoticeDays: '', maxDaysPerRequest: '', backdatedDays: '', sandwich: false,
  negativeDays: 0, encashable: false, maxEncashDays: '',
};
const TEMPLATES = [
  { name: 'Casual Leave', code: 'CL', annualDays: 12, accrual: 'MONTHLY', creditOn: 'START', minNoticeDays: 1, maxDaysPerRequest: 3, color: '#2563eb' },
  { name: 'Sick Leave', code: 'SL', annualDays: 6, backdatedDays: 7, color: '#16a34a' },
  { name: 'Earned Leave', code: 'EL', annualDays: 15, accrual: 'MONTHLY', carryForwardMax: 30, encashable: true, maxEncashDays: 15, minNoticeDays: 7, availableAfterDays: 180, color: '#d97706' },
  { name: 'Maternity Leave', code: 'ML', annualDays: 182, gender: 'FEMALE', allowHalfDay: false, prorateForJoiners: false, color: '#db2777' },
  { name: 'Paternity Leave', code: 'PL', annualDays: 5, gender: 'MALE', allowHalfDay: false, color: '#0891b2' },
  { name: 'Loss of Pay', code: 'LOP', isPaid: false, annualDays: 0, color: '#64748b' },
];
const num = (v) => (v === '' || v == null ? null : Number(v));
const plural = (n, w) => `${n} ${w}${Number(n) === 1 ? '' : 's'}`;

/** One line per rule that is on, so the list reads as the policy. */
function rulesOf(t, typeNames = new Map()) {
  const r = [];
  if (t.isPaid) {
    r.push(`${t.annualDays} a year: ${creditText(t)}`);
    r.push(t.carryForwardMax != null ? `carry up to ${t.carryForwardMax}` : 'lapses at year end');
  } else r.push('unpaid: loss of pay');
  if (t.gender) r.push(t.gender === 'FEMALE' ? 'women' : 'men');
  if (t.employeeTypeIds?.length) r.push(t.employeeTypeIds.map((i) => typeNames.get(i) || 'a type').join(', '));
  if (t.availableAfterDays) r.push(`after ${plural(t.availableAfterDays, 'day')} of joining`);
  if (t.minNoticeDays) r.push(`${plural(t.minNoticeDays, 'day')} notice`);
  if (t.maxDaysPerRequest != null) r.push(`at most ${t.maxDaysPerRequest} at a time`);
  if (t.backdatedDays != null) r.push(t.backdatedDays ? `up to ${plural(t.backdatedDays, 'day')} late` : 'not after the day');
  if (t.allowHalfDay === false) r.push('whole days');
  if (t.sandwich) r.push('sandwich rule');
  if (t.negativeDays) r.push(`${t.negativeDays} in advance`);
  if (t.encashable) r.push(t.maxEncashDays != null ? `pay out up to ${t.maxEncashDays}` : 'paid out');
  return r;
}

export default function LeavePolicy() {
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [kind, setKind] = useState('');
  const [empTypes, setEmpTypes] = useState([]);
  const [period, setPeriod] = useState(null);
  const [editingPeriod, setEditingPeriod] = useState(false);

  const load = useCallback(() => {
    listLeaveTypes().then((v) => { setAll(v); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load the leave policy.')));
  }, []);
  useEffect(() => {
    load();
    listStructure('employee-types').then(setEmpTypes).catch(() => setEmpTypes([]));
    getLeaveSettings().then(setPeriod).catch(() => setPeriod(null));
  }, [load]);

  const typeNames = useMemo(() => new Map(empTypes.map((t) => [t.id, t.name])), [empTypes]);
  const counts = useMemo(() => {
    const list = all || [];
    const paid = list.filter((t) => t.isPaid).length;
    return { '': list.length, PAID: paid, UNPAID: list.length - paid };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((t) => !kind || (kind === 'PAID') === Boolean(t.isPaid)), [all, kind]);
  const search = useListSearch(inTab, ['name', 'code', 'description']);
  const open = (t) => setEditing({ ...BLANK, ...t, code: t.code || '', description: t.description || '', color: t.color || '', gender: t.gender || '', employeeTypeIds: t.employeeTypeIds || [], creditOn: t.creditOn || 'START', creditDay: t.creditDay ?? '' });
  const missing = TEMPLATES.filter((x) => !(all || []).some((t) => t.name.toLowerCase() === x.name.toLowerCase()));

  return (
    <DocumentListShell
      entity="leave"
      title="Leave Policy"
      description="Each kind of leave: what it gives, who it is for, how it is asked for, and what happens to what is left."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search leave types…', label: 'Search leave types' }}
      primary={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ ...BLANK })}><Plus size={16} aria-hidden="true" /> New leave type</button>}
      cards={[
        { label: 'Paid types', value: counts.PAID, count: true, tone: 'paid', Icon: Wallet, onSelect: () => setKind('PAID') },
        { label: 'Unpaid types', value: counts.UNPAID, count: true, tone: 'outstanding', Icon: CircleSlash, onSelect: () => setKind('UNPAID') },
        { label: 'Requests', value: (all || []).reduce((a, t) => a + Number(t.requests || 0), 0), count: true, tone: 'sent', Icon: CalendarCheck },
      ]}
      tabs={[{ value: '', label: 'All', tone: 'all' }, { value: 'PAID', label: 'Paid', tone: 'paid' }, { value: 'UNPAID', label: 'Unpaid', tone: 'outstanding' }]}
      statusValue={kind}
      statusCounts={counts}
      onStatusChange={setKind}
      tabsLabel="Paid or unpaid"
    >
      {all && missing.length ? (
        <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
          <span className="ui-caption">Add a usual type, then change what differs:</span>
          {missing.map((x) => (
            <button key={x.name} type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing({ ...BLANK, ...x })}><Plus size={14} aria-hidden="true" /> {x.name}</button>
          ))}
        </div>
      ) : null}
      {period ? (
        <div className="px-4 pt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>Leave period: <strong>{period.current.label}</strong></span>
          <span className="ui-caption">starts {period.startDay} {MONTH_NAMES[period.startMonth - 1]} every year; unused days carry or lapse then.</span>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setEditingPeriod(true)}>Change</button>
        </div>
      ) : null}
      {editingPeriod ? <PeriodForm initial={period} onClose={() => setEditingPeriod(false)} onSaved={(p) => { setEditingPeriod(false); setPeriod((x) => ({ ...x, ...p })); getLeaveSettings().then(setPeriod).catch(() => {}); }} /> : null}
      {error ? <p role="alert" className="p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : !search.filtered.length ? (
        <EmptyState
          icon={CalendarCheck}
          title={all.length ? 'No leave types match' : 'No leave types yet'}
          description="Start from the usual Indian set and change what differs, or make your own."
        />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Leave type</th>
                <th scope="col">Code</th>
                <th scope="col" className="ui-col-grow">Policy</th>
                <th scope="col" className="ui-num">Requests</th>
                <th scope="col" className="ui-col-h-center">Active</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {search.filtered.map((t) => (
                <tr key={t.id} className="ui-row-click" onClick={() => open(t)}>
                  <td className="ui-col-entity">
                    <span className="inline-flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(t) }} aria-hidden="true" />{t.name}</span>
                  </td>
                  <td className="ui-col-meta">{t.code || '—'}</td>
                  <td className="ui-col-meta ui-col-grow whitespace-normal">{rulesOf(t, typeNames).join('; ')}</td>
                  <td className="ui-num">{t.requests}</td>
                  <td className="ui-col-h-center">{t.isActive ? 'Yes' : <span className="ui-caption">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <PolicyForm initial={editing} empTypes={empTypes} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </DocumentListShell>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="sm:col-span-2 grid gap-4 sm:grid-cols-2 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} aria-label={title}>
      <div className="sm:col-span-2">
        <h3 className="ui-t-sec">{title}</h3>
        {note ? <p className="ui-caption">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, placeholder, hint, step = 1 }) {
  return (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input type="number" min={0} max={3650} step={step} className="ui-input w-full" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </label>
  );
}

function Check({ label, hint, checked, onChange, disabled }) {
  return (
    <label className="flex items-start gap-2 text-sm sm:col-span-2">
      <input type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint ? <span className="ui-caption block">{hint}</span> : null}</span>
    </label>
  );
}

function PolicyForm({ initial, empTypes, onClose, onSaved }) {
  const [form, setForm] = useState({ ...initial, carryForwardMax: initial.carryForwardMax ?? '', minNoticeDays: initial.minNoticeDays ?? '', maxDaysPerRequest: initial.maxDaysPerRequest ?? '', backdatedDays: initial.backdatedDays ?? '', availableAfterDays: initial.availableAfterDays ?? '', maxEncashDays: initial.maxEncashDays ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const paid = Boolean(form.isPaid);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      description: form.description.trim() || null,
      color: form.color || null,
      isPaid: paid,
      isActive: Boolean(form.isActive),
      annualDays: paid ? Number(form.annualDays) || 0 : 0,
      accrual: form.accrual || 'YEARLY',
      creditOn: form.creditOn || 'START',
      creditDay: form.creditOn === 'DAY' ? num(form.creditDay) : null,
      prorateForJoiners: Boolean(form.prorateForJoiners),
      carryForwardMax: paid ? num(form.carryForwardMax) : null,
      gender: form.gender || null,
      employeeTypeIds: form.employeeTypeIds || [],
      availableAfterDays: num(form.availableAfterDays),
      allowHalfDay: Boolean(form.allowHalfDay),
      minNoticeDays: num(form.minNoticeDays),
      maxDaysPerRequest: num(form.maxDaysPerRequest),
      backdatedDays: num(form.backdatedDays),
      sandwich: Boolean(form.sandwich),
      negativeDays: paid ? Number(form.negativeDays) || 0 : 0,
      encashable: paid && Boolean(form.encashable),
      maxEncashDays: paid && form.encashable ? num(form.maxEncashDays) : null,
    };
    try {
      if (form.id) await updateLeaveType(form.id, body);
      else await createLeaveType(body);
      notify.success('Leave type saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a type nobody has used can be deleted; a used one can be made inactive.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteLeaveType(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  const toggleType = (typeId) => set('employeeTypeIds')(form.employeeTypeIds.includes(typeId) ? form.employeeTypeIds.filter((x) => x !== typeId) : [...form.employeeTypeIds, typeId]);

  return (
    <Drawer
      widthClass="w-[min(44rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? form.name : 'New leave type'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leave-policy" className="ui-btn ui-btn-primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="leave-policy" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={60} value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="e.g. Casual Leave" /></label>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="block"><span className="ui-label">Code</span><input className="ui-input w-full" maxLength={10} value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="e.g. CL" /></label>
          <label className="block"><span className="ui-label">Colour</span><input type="color" className="ui-input h-[38px] w-14 p-1" value={form.color || colorOf(form)} onChange={(e) => set('color')(e.target.value)} aria-label="Colour on the leave calendar" /></label>
        </div>
        <label className="block sm:col-span-2"><span className="ui-label">What it is for</span><input className="ui-input w-full" maxLength={300} value={form.description} onChange={(e) => set('description')(e.target.value)} placeholder="Shown to employees when they choose it" /></label>
        <Check label="Paid leave" hint={paid ? 'Each day comes out of a balance.' : 'Unpaid: no balance, and each day is loss of pay in payroll.'} checked={paid} onChange={set('isPaid')} />

        {paid ? (
          <Section title="What it gives" note="Change one person’s days in Leave Balances.">
            <NumberField label="Days a year" value={form.annualDays} onChange={set('annualDays')} step={0.5} />
            <label className="block">
              <span className="ui-label">Credited</span>
              <select className="ui-select w-full" value={form.accrual || 'YEARLY'} onChange={(e) => set('accrual')(e.target.value)}>
                {Object.entries(ACCRUAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="ui-label">On</span>
              <select className="ui-select w-full" value={form.creditOn || 'START'} onChange={(e) => set('creditOn')(e.target.value)}>
                <option value="START">The first day of each part</option>
                <option value="END">The last day of each part</option>
                <option value="DAY">A day of the month I choose</option>
              </select>
            </label>
            {form.creditOn === 'DAY' ? <NumberField label="Day of the month (1–28)" value={form.creditDay} onChange={set('creditDay')} placeholder="e.g. 10" /> : <div />}
            <p className="ui-caption sm:col-span-2">Automatically: {creditText({ ...form, creditDay: Number(form.creditDay) || null })}, counted from the start of the leave period. Nobody has to run anything.</p>
            <Check label="Joiners get only the part of the year they work" hint="A month counts when joined by its 15th. Monthly leave always starts from joining." checked={form.prorateForJoiners || form.accrual === 'MONTHLY'} disabled={form.accrual === 'MONTHLY'} onChange={set('prorateForJoiners')} />
          </Section>
        ) : null}

        <Section title="Who it is for" note="Leave it open for everyone, or narrow it.">
          <label className="block">
            <span className="ui-label">Gender</span>
            <select className="ui-select w-full" value={form.gender} onChange={(e) => set('gender')(e.target.value)}>
              <option value="">Everyone</option>
              <option value="FEMALE">Women (e.g. maternity)</option>
              <option value="MALE">Men (e.g. paternity)</option>
            </select>
          </label>
          <NumberField label="Usable after joining, days" value={form.availableAfterDays} onChange={set('availableAfterDays')} placeholder="From the first day" hint="e.g. 180 for after probation." />
          <fieldset className="sm:col-span-2">
            <legend className="ui-label">Employee types</legend>
            {empTypes.length ? (
              <div className="flex flex-wrap gap-3">
                {empTypes.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.employeeTypeIds.includes(t.id)} onChange={() => toggleType(t.id)} /> {t.name}</label>
                ))}
              </div>
            ) : <p className="ui-caption">No employee types yet; add them in Settings → Employee Types to narrow by type.</p>}
            <span className="ui-caption">None ticked: every type.</span>
          </fieldset>
        </Section>

        <Section title="How it is asked for" note="Notice and how late apply to people asking for themselves; HR can always enter leave.">
          <NumberField label="Notice, days ahead" value={form.minNoticeDays} onChange={set('minNoticeDays')} placeholder="Any time" />
          <NumberField label="Longest request, days" value={form.maxDaysPerRequest} onChange={set('maxDaysPerRequest')} placeholder="No limit" step={0.5} />
          <NumberField label="Asked for after the day, up to" value={form.backdatedDays} onChange={set('backdatedDays')} placeholder="No limit" hint="0: only before the day, e.g. not for sick leave." />
          <div />
          <Check label="Half days allowed" checked={form.allowHalfDay} onChange={set('allowHalfDay')} />
          <Check label="Sandwich rule" hint="Weekly offs and holidays between two leave days count as leave. Friday and Monday off makes four days." checked={form.sandwich} onChange={set('sandwich')} />
        </Section>

        {paid ? (
          <Section title="What happens to the balance" note="At year end, and when it runs out.">
            <NumberField label="Carry into next year, up to" value={form.carryForwardMax} onChange={set('carryForwardMax')} placeholder="Nothing: unused days lapse" step={0.5} />
            <NumberField label="Days allowed in advance" value={form.negativeDays} onChange={set('negativeDays')} hint="The balance may go this far below zero." step={0.5} />
            <Check label="Unused days can be paid out (encashment)" checked={form.encashable} onChange={set('encashable')} />
            {form.encashable ? <NumberField label="Paid out at most, days a year" value={form.maxEncashDays} onChange={set('maxEncashDays')} placeholder="No limit" step={0.5} /> : null}
          </Section>
        ) : null}

        <Check label="Active: people can ask for it" checked={form.isActive} onChange={set('isActive')} />
      </form>
    </Drawer>
  );
}

function PeriodForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ startMonth: initial?.startMonth || 1, startDay: initial?.startDay || 1 });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const changed = form.startMonth !== initial?.startMonth || form.startDay !== initial?.startDay;
    if (changed) {
      const ok = await confirmDialog({
        title: 'Change the leave period?',
        message: 'Balances, carry-forward and the register are worked out again for the new period. Balances set or changed by hand stay with the period they were given for.',
        confirmLabel: 'Change it',
        tone: 'default',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const out = await saveLeaveSettings(form);
      notify.success(`Leave period: ${out.current.label}.`);
      onSaved(out);
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(30rem,96vw)]"
      title="Leave period"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leave-period" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="leave-period" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <p className="ui-caption sm:col-span-2">The year leave is counted in. Credits start from it, and at its end unused days carry forward or lapse. Most Indian companies use 1 January or 1 April.</p>
        <label className="block">
          <span className="ui-label">Starts on day</span>
          <input type="number" min={1} max={28} className="ui-input w-full" value={form.startDay} onChange={(e) => setForm({ ...form, startDay: Number(e.target.value) || 1 })} />
        </label>
        <label className="block">
          <span className="ui-label">Of</span>
          <select className="ui-select w-full" value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: Number(e.target.value) })}>
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
      </form>
    </Drawer>
  );
}

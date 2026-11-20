import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarRange, Check, Download, FileText, HardHat, Plus, Printer, RefreshCw, Trash2, Undo2, Wallet } from '@ui/components/ui/lineIcons';

import DocumentListShell from '@ui/components/list/DocumentListShell';
import { EmptyState, PageHeader, SkeletonCard, StatusPill } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { rupees as money, moneyCell } from '@ui/utils/money';
import { listPayGroups } from '../api/payrollCalendar';
import { listEmployees } from '../api/payrollPeople';
import {
  approveWageSheet,
  bankFileCsv,
  bankFileSummary,
  deleteWageSheet,
  editWageLine,
  getWageSheet,
  listWageRates,
  listWageSheets,
  makeWageSheet,
  markWageSheetPaid,
  nextSheetStart,
  refreshWageSheet,
  reopenWageSheet,
  saveText,
  saveWageRate,
  wageMonth,
  wageMonthFile,
  wageSlip,
} from '../api/payrollWeeklyWages';
import { errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';

/**
 * Weekly wages (round 66): workers paid by the day, every week or fortnight.
 *
 * Three views. Wage sheets: one per week of a pay group, days × rate plus
 * overtime, less PF, ESI, professional tax, canteen and any advance; approved,
 * paid from a bank file and marked paid. Daily rates: who is paid this way and
 * at what rate. The month: every sheet ending in a month added up per worker,
 * which is what PF, ESI and PT returns are filed from — the returns stay
 * monthly even when wages do not.
 */

const VIEWS = [
  { value: '', label: 'Wage sheets', tone: 'all' },
  { value: 'RATES', label: 'Daily rates', tone: 'sent' },
  { value: 'MONTH', label: 'The month', tone: 'paid' },
];
const STATUS_WORDS = { DRAFT: 'Draft', APPROVED: 'Approved', PAID: 'Paid' };
const dayWords = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const span = (s) => `${dayWords(s.startDate)} – ${dayWords(s.endDate)} ${s.endDate.slice(0, 4)}`;
const monthWords = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const thisMonth = () => new Date().toISOString().slice(0, 7);
const nextMonday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const isWeekly = (g) => g.frequency === 'WEEKLY' || g.frequency === 'FORTNIGHTLY';

export default function WeeklyWages() {
  const [view, setView] = useState('');
  const [groups, setGroups] = useState(null);
  const [groupsRefused, setGroupsRefused] = useState(false);
  const [sheets, setSheets] = useState(null);
  const [rates, setRates] = useState(null);
  const [error, setError] = useState('');
  const [openSheet, setOpenSheet] = useState(null);
  const [making, setMaking] = useState(false);
  const [rateForm, setRateForm] = useState(null);

  const load = useCallback(() => {
    /* Pay groups are a settings read some roles do not have: the sheets still list, and making one says why it cannot start. */
    Promise.all([listPayGroups().catch(() => null), listWageSheets(), listWageRates()])
      .then(([g, s, r]) => {
        setGroupsRefused(!g);
        setGroups((g || []).filter(isWeekly));
        setSheets(s);
        setRates(r);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load weekly wages')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => ({ '': sheets?.length || 0, RATES: rates?.filter((r) => r.isActive).length || 0, MONTH: 0 }), [sheets, rates]);

  if (openSheet) {
    return <SheetPage sheetId={openSheet} onBack={() => { setOpenSheet(null); load(); }} />;
  }

  const primary =
    view === 'RATES' ? (
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => setRateForm({})} disabled={!groups?.length}>
        <Plus size={16} aria-hidden="true" /> Add worker
      </button>
    ) : view === '' ? (
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => setMaking(true)} disabled={!groups?.length}>
        <Plus size={16} aria-hidden="true" /> Make wage sheet
      </button>
    ) : null;

  const draft = (sheets || []).filter((s) => s.status === 'DRAFT').length;
  const unpaid = (sheets || []).filter((s) => s.status === 'APPROVED');

  return (
    <DocumentListShell
      entity="payroll"
      title="Weekly wages"
      description="Workers paid by the day, every week or fortnight. PF, ESI and professional tax still add up by the month."
      compact
      tight
      primary={primary}
      countLine={countItems([
        { label: 'Workers on a daily rate', value: counts.RATES, count: true, tone: 'sent', onSelect: () => setView('RATES') },
        { label: 'Draft sheets', value: draft, count: true, tone: 'draft', onSelect: () => setView('') },
        { label: 'Approved, not paid', value: money(unpaid.reduce((t, s) => t + s.net, 0)), tone: 'outstanding' },
        { label: 'Weekly pay groups', value: groups?.length || 0, count: true, tone: 'paid' },
      ])}
      tabs={VIEWS}
      statusValue={view}
      statusCounts={counts}
      onStatusChange={setView}
      tabsLabel="Weekly wages views"
    >
      <LoadFailed message={error} onRetry={load} />
      {groupsRefused ? <p role="note" className="ui-caption">Could not load the pay groups, so new sheets and daily rates cannot be added from here.</p> : null}
      {!groups ? (
        error ? null : <SkeletonCard lines={4} />
      ) : !groups.length && !groupsRefused && !sheets?.length ? (
        <EmptyState
          icon={CalendarRange}
          title="No weekly pay group yet"
          description="Weekly wages are paid to a weekly or fortnightly pay group. Add one under Settings → Pay groups, then give its workers a daily rate."
        />
      ) : view === 'RATES' ? (
        <RatesTable rates={rates || []} onEdit={(r) => setRateForm(r)} />
      ) : view === 'MONTH' ? (
        <MonthView />
      ) : (
        <SheetsTable sheets={sheets || []} onOpen={setOpenSheet} onMake={() => setMaking(true)} />
      )}

      <Drawer open={making} onClose={() => setMaking(false)} title="Make wage sheet" description="Days come from Attendance where it is on; otherwise you type them in.">
        {making ? (
          <MakeSheetForm
            groups={groups || []}
            onClose={() => setMaking(false)}
            onMade={(sheet) => {
              setMaking(false);
              setOpenSheet(sheet.id);
            }}
          />
        ) : null}
      </Drawer>
      <Drawer open={Boolean(rateForm)} onClose={() => setRateForm(null)} title={rateForm?.id ? `Daily rate of ${rateForm.name}` : 'Add worker'} description="Who is paid by the day, at what rate, and what comes out each week.">
        {rateForm ? (
          <RateForm
            initial={rateForm}
            groups={groups || []}
            onClose={() => setRateForm(null)}
            onSaved={() => {
              setRateForm(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

function SheetsTable({ sheets, onOpen, onMake }) {
  if (!sheets.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No wage sheets yet"
        description="A wage sheet is one week (or fortnight) of a pay group: days worked × the daily rate, plus overtime."
        routes={[{ label: 'Make wage sheet', description: 'Start with the first week to pay.', onSelect: onMake }]}
      />
    );
  }
  return (
    <div className="ui-table-scroll">
      <table className="ui-table ui-table-sticky ui-table-phone w-full">
        <thead>
          <tr>
            <th scope="col">Days</th>
            <th scope="col">Pay group</th>
            <th scope="col">Wage month</th>
            <th scope="col" className="ui-col-h-right">Workers</th>
            <th scope="col" className="ui-col-h-right">Gross</th>
            <th scope="col" className="ui-col-h-right">Net pay</th>
            <th scope="col" className="ui-col-h-center">Status</th>
          </tr>
        </thead>
        <tbody className="ui-rows">
          {sheets.map((s) => (
            <tr key={s.id} className="ui-row-click" onClick={() => onOpen(s.id)}>
              <td className="ui-col-entity" data-phone="name">
                <button type="button" className="ui-link" onClick={(e) => { e.stopPropagation(); onOpen(s.id); }}>{span(s)}</button>
              </td>
              <td className="ui-col-meta" data-phone="sub">{s.payGroupName}</td>
              <td className="ui-col-meta">{monthWords(s.wageMonth)}{s.lastOfMonth ? <span className="ui-caption block">Last of the month</span> : null}</td>
              <td className="ui-col-amount">{s.workers ?? '—'}</td>
              <td className="ui-col-amount">{moneyCell(s.gross)}</td>
              <td className="ui-col-amount" data-phone="key">{moneyCell(s.net)}</td>
              <td className="ui-col-h-center" data-phone="tag"><StatusPill status={s.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatesTable({ rates, onEdit }) {
  if (!rates.length) {
    return <EmptyState icon={HardHat} title="Nobody on a daily rate yet" description="Add each worker paid by the day with their pay group and daily rate. A wage sheet pays everyone in the group who has one." />;
  }
  return (
    <div className="ui-table-scroll">
      <table className="ui-table ui-table-sticky ui-table-phone w-full">
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Pay group</th>
            <th scope="col" className="ui-col-h-right">Daily rate</th>
            <th scope="col" className="ui-col-h-right">Canteen a day</th>
            <th scope="col" className="ui-col-h-right">Advance left</th>
            <th scope="col" className="ui-col-h-right">Recovered per sheet</th>
            <th scope="col" className="ui-col-h-center">Status</th>
          </tr>
        </thead>
        <tbody className="ui-rows">
          {rates.map((r) => (
            <tr key={r.id} className="ui-row-click" onClick={() => onEdit(r)}>
              <td className="ui-col-entity" data-phone="name">
                <button type="button" className="ui-link" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>{r.name}</button>
                {r.code ? <span className="ui-caption ml-2 ui-mono">{r.code}</span> : null}
              </td>
              <td className="ui-col-meta" data-phone="sub">{r.payGroupName}</td>
              <td className="ui-col-amount" data-phone="key">{moneyCell(r.dailyRate)}</td>
              <td className="ui-col-amount">{r.canteenPerDay ? money(r.canteenPerDay) : '—'}</td>
              <td className="ui-col-amount">{r.advanceBalance ? money(r.advanceBalance) : '—'}</td>
              <td className="ui-col-amount">{r.advancePerSheet ? money(r.advancePerSheet) : '—'}</td>
              <td className="ui-col-h-center" data-phone="tag">{r.isActive ? <StatusPill status="active" /> : <span className="ui-caption">Not paid now</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MakeSheetForm({ groups, onClose, onMade }) {
  const [payGroupId, setPayGroupId] = useState(groups[0]?.id || '');
  const [startDate, setStartDate] = useState(nextMonday());
  const [fixedStart, setFixedStart] = useState(null);
  const [paysWeeklyOff, setPaysWeeklyOff] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!payGroupId) return;
    let live = true;
    nextSheetStart(payGroupId)
      .then((d) => {
        if (!live) return;
        setFixedStart(d);
        if (d) setStartDate(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [payGroupId]);

  const group = groups.find((g) => g.id === payGroupId);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const sheet = await makeWageSheet({ payGroupId, startDate, paysWeeklyOff });
      notify.success(`Wage sheet for ${span(sheet)} made.`);
      onMade(sheet);
    } catch (err) {
      notify.error(errorWords(err, 'make that wage sheet'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="ui-label" htmlFor="ww-group">Pay group</label>
        <select id="ww-group" className="ui-select w-full" value={payGroupId} onChange={(e) => setPayGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({g.frequency === 'WEEKLY' ? 'weekly' : 'fortnightly'})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="ui-label" htmlFor="ww-start">First day</label>
        <input id="ww-start" type="date" className="ui-input w-full" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={Boolean(fixedStart)} required />
        <span className="ui-caption block mt-1">
          {fixedStart
            ? 'Straight after the last sheet of this group, so no day is missed or paid twice.'
            : `The sheet covers ${group?.frequency === 'FORTNIGHTLY' ? '14' : '7'} days from this day.`}
        </span>
      </div>
      <label className="flex items-start gap-2 text-sm" htmlFor="ww-weekly-off">
        <input id="ww-weekly-off" type="checkbox" className="ui-checkbox mt-0.5" checked={paysWeeklyOff} onChange={(e) => setPaysWeeklyOff(e.target.checked)} />
        <span>
          <span className="block">Pay the weekly off</span>
          <span className="ui-caption block">Holidays and paid leave are always paid. Leave this off where the weekly rest day is unpaid.</span>
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !payGroupId}>{busy ? 'Making…' : 'Make sheet'}</button>
      </div>
    </form>
  );
}

function RateForm({ initial, groups, onClose, onSaved }) {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({
    employeeId: initial.employeeId || '',
    payGroupId: initial.payGroupId || groups[0]?.id || '',
    dailyRate: initial.dailyRate ?? '',
    hoursPerDay: initial.hoursPerDay ?? 8,
    overtimeMultiplier: initial.overtimeMultiplier ?? 2,
    canteenPerDay: initial.canteenPerDay ?? 0,
    advanceBalance: initial.advanceBalance ?? 0,
    advancePerSheet: initial.advancePerSheet ?? 0,
    isActive: initial.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  useEffect(() => {
    if (initial.id) return;
    listEmployees({ status: 'ACTIVE' })
      .then(({ employees }) => setPeople(employees.map((e) => e.employee || e)))
      .catch(() => setPeople([]));
  }, [initial.id]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveWageRate({
        ...form,
        dailyRate: Number(form.dailyRate),
        hoursPerDay: Number(form.hoursPerDay),
        overtimeMultiplier: Number(form.overtimeMultiplier),
        canteenPerDay: Number(form.canteenPerDay || 0),
        advanceBalance: Number(form.advanceBalance || 0),
        advancePerSheet: Number(form.advancePerSheet || 0),
      });
      notify.success('Daily rate saved.');
      onSaved();
    } catch (err) {
      notify.error(errorWords(err, 'save that daily rate'));
    } finally {
      setBusy(false);
    }
  };
  const num = (key, label, hint, step = '0.01') => (
    <div>
      <label className="ui-label" htmlFor={`ww-${key}`}>{label}</label>
      <input id={`ww-${key}`} type="number" min="0" step={step} className="ui-input ui-num w-full" value={form[key]} onChange={(e) => set({ [key]: e.target.value })} />
      {hint ? <span className="ui-caption block mt-1">{hint}</span> : null}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      {initial.id ? null : (
        <div>
          <label className="ui-label" htmlFor="ww-person">Worker</label>
          <select id="ww-person" className="ui-select w-full" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} required>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="ww-rate-group">Pay group</label>
          <select id="ww-rate-group" className="ui-select w-full" value={form.payGroupId} onChange={(e) => set({ payGroupId: e.target.value })}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="ww-dailyRate">Daily rate</label>
          <input id="ww-dailyRate" type="number" min="1" step="0.01" className="ui-input ui-num w-full" value={form.dailyRate} onChange={(e) => set({ dailyRate: e.target.value })} required />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {num('hoursPerDay', 'Hours in a day', 'For the hourly rate overtime is paid at.', '0.5')}
        {num('overtimeMultiplier', 'Overtime pay, times the hourly rate', 'Twice, by law.', '0.25')}
      </div>
      {num('canteenPerDay', 'Canteen a day worked', 'Taken from each sheet for the days worked.')}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {num('advanceBalance', 'Advance still to recover')}
        {num('advancePerSheet', 'Recovered each sheet')}
      </div>
      <p className="ui-caption">Deductions never pass half a sheet's wages: PF, ESI and professional tax first, then canteen, then the advance.</p>
      <label className="flex items-start gap-2 text-sm" htmlFor="ww-active">
        <input id="ww-active" type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(form.isActive)} onChange={(e) => set({ isActive: e.target.checked })} />
        <span>
          <span className="block">Paid on wage sheets</span>
          <span className="ui-caption block">Turn off for someone who has left; their sheets stay as they were.</span>
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save daily rate'}</button>
      </div>
    </form>
  );
}

function SheetPage({ sheetId, onBack }) {
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [paying, setPaying] = useState(false);
  const [slip, setSlip] = useState(null);
  const [bank, setBank] = useState(null);

  const load = useCallback(() => {
    getWageSheet(sheetId)
      .then((s) => {
        setSheet(s);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load this wage sheet')));
  }, [sheetId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!sheet || sheet.status === 'DRAFT') return setBank(null);
    bankFileSummary(sheet.id).then(setBank).catch(() => setBank(null));
  }, [sheet]);

  const act = async (key, fn, done) => {
    setBusy(key);
    try {
      const next = await fn();
      if (next) setSheet(next);
      if (done) notify.success(done);
    } catch (e) {
      notify.error(errorWords(e, 'update this wage sheet'));
    } finally {
      setBusy('');
    }
  };

  if (error) return <div className="p-5"><LoadFailed message={error} onRetry={load} /></div>;
  if (!sheet) return <SkeletonCard lines={6} />;
  const draft = sheet.status === 'DRAFT';

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete the sheet for ${span(sheet)}?`, message: 'A draft can be deleted and made again.', confirmLabel: 'Delete sheet' });
    if (!ok) return;
    await act('delete', async () => {
      await deleteWageSheet(sheet.id);
      onBack();
    }, 'Wage sheet deleted.');
  };
  const downloadBank = () =>
    act('bank', async () => {
      saveText(await bankFileCsv(sheet.id), `${bank?.reference || 'wages'}.csv`);
    }, 'Bank file downloaded.');

  const primary = draft ? (
    <button type="button" className="ui-btn ui-btn-primary" onClick={() => act('approve', () => approveWageSheet(sheet.id), 'Wage sheet approved.')} disabled={Boolean(busy)}>
      <Check size={16} aria-hidden="true" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
    </button>
  ) : sheet.status === 'APPROVED' ? (
    <button type="button" className="ui-btn ui-btn-primary" onClick={() => setPaying(true)} disabled={Boolean(busy)}>
      <Wallet size={16} aria-hidden="true" /> Mark paid
    </button>
  ) : null;

  return (
    <div className="space-y-3">
      <PageHeader
        entity="payroll"
        title={`Wages for ${span(sheet)}`}
        description={`${sheet.payGroupName} · wage month ${monthWords(sheet.wageMonth)}${sheet.lastOfMonth ? ' · last sheet of the month: professional tax is taken here' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {primary}
          </div>
        }
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusPill status={sheet.status} />
          <Figure label="Gross" value={money(sheet.gross)} />
          <Figure label="Deductions" value={money(sheet.deductions)} />
          <Figure label="Net pay" value={money(sheet.net)} />
          {sheet.paidOn ? <span className="ui-caption">Paid on {dayWords(sheet.paidOn)} {sheet.paidOn.slice(0, 4)}{sheet.paymentReference ? <> · <span className="ui-mono">{sheet.paymentReference}</span></> : null}</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => act('refresh', () => refreshWageSheet(sheet.id), 'Days taken from Attendance again.')} disabled={Boolean(busy)}>
                <RefreshCw size={14} aria-hidden="true" /> Take days from Attendance
              </button>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={remove} disabled={Boolean(busy)}>
                <Trash2 size={14} aria-hidden="true" /> Delete draft sheet
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={downloadBank} disabled={Boolean(busy) || !bank?.bankCount}>
                <Download size={14} aria-hidden="true" /> Download bank file
              </button>
              {sheet.status === 'APPROVED' ? (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => act('reopen', () => reopenWageSheet(sheet.id), 'Back to draft. Advances recovered on it are back on the balance.')} disabled={Boolean(busy)}>
                  <Undo2 size={14} aria-hidden="true" /> Back to draft
                </button>
              ) : null}
            </>
          )}
        </div>
        {bank ? (
          <p className="ui-caption">
            The bank file pays {bank.bankCount} {bank.bankCount === 1 ? 'worker' : 'workers'} {money(bank.bankTotal)}.
            {bank.cash?.length ? ` No bank account for ${bank.cash.map((c) => `${c.name} (${money(c.amount)})`).join(', ')}: pay them in cash or by cheque.` : ''}
          </p>
        ) : null}

        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col" className="ui-col-h-right">Days</th>
                <th scope="col" className="ui-col-h-right">Daily rate</th>
                <th scope="col" className="ui-col-h-right">Overtime hours</th>
                <th scope="col" className="ui-col-h-right">Gross</th>
                <th scope="col" className="ui-col-h-right">PF</th>
                <th scope="col" className="ui-col-h-right">ESI</th>
                <th scope="col" className="ui-col-h-right">PT</th>
                <th scope="col" className="ui-col-h-right">Canteen</th>
                <th scope="col" className="ui-col-h-right">Advance</th>
                <th scope="col" className="ui-col-h-right">Net pay</th>
                <th scope="col"><span className="sr-only">Payslip</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {sheet.lines.map((l) => (
                <tr key={l.id}>
                  <td className="ui-col-entity">
                    {l.name}
                    {l.code ? <span className="ui-caption ml-2 ui-mono">{l.code}</span> : null}
                    {l.notes ? <span className="ui-caption block">{l.notes}</span> : null}
                    {!l.hasBankAccount ? <span className="ui-caption ui-text-warn block">No bank account</span> : null}
                  </td>
                  <td className="ui-col-amount">
                    {draft ? <LineNumber key={`d${l.daysWorked}`} label={`Days for ${l.name}`} value={l.daysWorked} step="0.5" onSave={(v) => act(`d${l.id}`, () => editWageLine(sheet.id, l.id, { daysWorked: v }))} /> : l.daysWorked}
                  </td>
                  <td className="ui-col-amount">{moneyCell(l.dailyRate)}</td>
                  <td className="ui-col-amount">
                    {draft ? <LineNumber key={`o${l.overtimeHours}`} label={`Overtime hours for ${l.name}`} value={l.overtimeHours} step="0.25" onSave={(v) => act(`o${l.id}`, () => editWageLine(sheet.id, l.id, { overtimeHours: v }))} /> : l.overtimeHours || '—'}
                  </td>
                  <td className="ui-col-amount">{moneyCell(l.gross)}</td>
                  <td className="ui-col-amount">{l.pfEmployee ? money(l.pfEmployee) : '—'}</td>
                  <td className="ui-col-amount">{l.esiEmployee ? money(l.esiEmployee) : '—'}</td>
                  <td className="ui-col-amount">{l.ptEmployee ? money(l.ptEmployee) : '—'}</td>
                  <td className="ui-col-amount">{l.canteen ? money(l.canteen) : '—'}</td>
                  <td className="ui-col-amount">{l.advanceRecovery ? money(l.advanceRecovery) : '—'}</td>
                  <td className="ui-col-amount">{moneyCell(l.net)}</td>
                  <td className="text-end">
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => wageSlip(sheet.id, l.employeeId).then(setSlip).catch((e) => notify.error(errorWords(e, 'open the payslip')))}>
                      Payslip<span className="sr-only"> for {l.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer open={paying} onClose={() => setPaying(false)} title="Mark paid" description={`Wages for ${span(sheet)}, ${money(sheet.net)}.`}>
        {paying ? (
          <PaidForm
            sheet={sheet}
            onClose={() => setPaying(false)}
            onPaid={(next) => {
              setPaying(false);
              setSheet(next);
              notify.success('Wage sheet marked paid.');
            }}
          />
        ) : null}
      </Drawer>
      <Drawer open={Boolean(slip)} onClose={() => setSlip(null)} title="Payslip" description={slip ? `${slip.line.name}, ${span(slip.sheet)}` : ''}>
        {slip ? <WageSlip slip={slip} /> : null}
      </Drawer>
    </div>
  );
}

const Figure = ({ label, value }) => (
  <div>
    <span className="ui-caption block">{label}</span>
    <span className="ui-num text-base">{value}</span>
  </div>
);

/** A number typed in a row, saved when the field is left. */
function LineNumber({ label, value, step, onSave }) {
  const [v, setV] = useState(String(value));
  const save = () => {
    const nv = Number(v);
    if (v === '' || Number.isNaN(nv) || nv === Number(value)) return setV(String(value));
    onSave(nv);
  };
  return (
    <input
      type="number"
      min="0"
      step={step}
      aria-label={label}
      className="ui-input ui-num w-20 text-end"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

function PaidForm({ sheet, onClose, onPaid }) {
  const [paidOn, setPaidOn] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return today < sheet.endDate ? sheet.endDate : today;
  });
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onPaid(await markWageSheetPaid(sheet.id, { paidOn, reference: reference || null }));
    } catch (err) {
      notify.error(errorWords(err, 'mark it paid'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="ui-label" htmlFor="ww-paid-on">Paid on</label>
        <input id="ww-paid-on" type="date" className="ui-input w-full" min={sheet.endDate} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
      </div>
      <div>
        <label className="ui-label" htmlFor="ww-ref">Bank reference</label>
        <input id="ww-ref" className="ui-input ui-mono w-full" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</button>
      </div>
    </form>
  );
}

/** The slip a worker is handed: earnings, what came out and why, the net. */
function WageSlip({ slip }) {
  const { sheet, line: l } = slip;
  const rows = [
    ['Days worked', `${l.daysWorked} × ${money(l.dailyRate)}`, money(l.pfWage)],
    l.overtimeAmount ? ['Overtime', `${l.overtimeHours} hours`, money(l.overtimeAmount)] : null,
  ].filter(Boolean);
  const cuts = [
    ['Provident fund', l.pfEmployee],
    ['ESI', l.esiEmployee],
    ['Professional tax', l.ptEmployee],
    ['Canteen', l.canteen],
    ['Advance recovered', l.advanceRecovery],
  ].filter(([, v]) => v);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm">{l.name}{l.code ? <span className="ui-caption ml-2 ui-mono">{l.code}</span> : null}</p>
        <p className="ui-caption">{sheet.payGroupName} · {span(sheet)} · {STATUS_WORDS[sheet.status]}{sheet.paidOn ? `, paid on ${dayWords(sheet.paidOn)}` : ''}</p>
      </div>
      <table className="ui-table w-full">
        <tbody className="ui-rows">
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}<span className="ui-caption block">{b}</span></td>
              <td className="ui-col-amount">{c}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Gross</strong></td>
            <td className="ui-col-amount"><strong>{money(l.gross)}</strong></td>
          </tr>
          {cuts.map(([a, v]) => (
            <tr key={a}>
              <td>{a}</td>
              <td className="ui-col-amount">−{money(v)}</td>
            </tr>
          ))}
          <tr>
            <td><strong>Net pay</strong></td>
            <td className="ui-col-amount"><strong>{money(l.net)}</strong></td>
          </tr>
        </tbody>
      </table>
      {l.explanations?.length ? (
        <ul className="ui-caption space-y-1">
          {l.explanations.map((x, i) => (
            <li key={i}>{x.text}</li>
          ))}
        </ul>
      ) : null}
      {l.bankAccount ? <p className="ui-caption">Paid to account <span className="ui-mono">{l.bankAccount}</span></p> : null}
      <div className="flex justify-end">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </button>
      </div>
    </div>
  );
}

function MonthView() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    wageMonth(month)
      .then((d) => live && (setData(d), setError('')))
      .catch((e) => live && setError(errorWords(e, 'load the month')));
    return () => {
      live = false;
    };
  }, [month, tries]);
  const download = async (format) => {
    try {
      const text = await wageMonthFile(month, format);
      saveText(text, format === 'ecr' ? `ecr-weekly-wages-${month}.txt` : `weekly-wages-${month}.csv`, format === 'ecr' ? 'text/plain' : 'text/csv');
    } catch (e) {
      notify.error(errorWords(e, 'download the month'));
    }
  };
  const shown = data?.month === month ? data : null;
  const t = shown?.totals;
  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="ui-label" htmlFor="ww-month">Wage month</label>
          <input id="ww-month" type="month" className="ui-input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => download('csv')} disabled={!shown?.rows?.length}>
          <Download size={16} aria-hidden="true" /> Download month summary
        </button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => download('ecr')} disabled={!t?.pfEmployee}>
          <Download size={16} aria-hidden="true" /> PF ECR file
        </button>
      </div>
      <LoadFailed message={error} onRetry={() => setTries((n) => n + 1)} />
      {!shown ? (
        error ? null : <SkeletonCard lines={3} />
      ) : (
        <>
          <p className="ui-caption">
            Every approved or paid sheet ending in {monthWords(month)}, added up per worker: file PF, ESI and professional tax for the month from these.
            {shown.drafts ? ` ${shown.drafts} draft ${shown.drafts === 1 ? 'sheet is' : 'sheets are'} not counted until approved.` : ''}
            {shown.missingUan?.length ? ` No UAN for ${shown.missingUan.map((m) => m.name).join(', ')}, so they are left out of the ECR file.` : ''}
          </p>
          {!shown.rows.length ? (
            <EmptyState icon={CalendarRange} title={`Nothing approved for ${monthWords(month)}`} description="Approve the month's wage sheets and their totals show here." />
          ) : (
            <div className="ui-table-scroll">
              <table className="ui-table ui-table-sticky w-full">
                <thead>
                  <tr>
                    <th scope="col">Worker</th>
                    <th scope="col" className="ui-col-h-right">Days</th>
                    <th scope="col" className="ui-col-h-right">Gross</th>
                    <th scope="col" className="ui-col-h-right">PF wages</th>
                    <th scope="col" className="ui-col-h-right">PF (worker)</th>
                    <th scope="col" className="ui-col-h-right">PF (company)</th>
                    <th scope="col" className="ui-col-h-right">ESI (worker)</th>
                    <th scope="col" className="ui-col-h-right">ESI (company)</th>
                    <th scope="col" className="ui-col-h-right">PT</th>
                    <th scope="col" className="ui-col-h-right">Net pay</th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {shown.rows.map((r) => (
                    <tr key={r.employeeId}>
                      <td className="ui-col-entity">{r.name}{r.uan ? <span className="ui-caption block ui-mono">UAN {r.uan}</span> : null}</td>
                      <td className="ui-col-amount">{r.daysWorked}</td>
                      <td className="ui-col-amount">{moneyCell(r.gross)}</td>
                      <td className="ui-col-amount">{moneyCell(r.pfWage)}</td>
                      <td className="ui-col-amount">{moneyCell(r.pfEmployee)}</td>
                      <td className="ui-col-amount">{moneyCell(r.pfEmployer)}</td>
                      <td className="ui-col-amount">{moneyCell(r.esiEmployee)}</td>
                      <td className="ui-col-amount">{moneyCell(r.esiEmployer)}</td>
                      <td className="ui-col-amount">{moneyCell(r.ptEmployee)}</td>
                      <td className="ui-col-amount">{moneyCell(r.net)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="ui-col-entity"><strong>{t.workers} {t.workers === 1 ? 'worker' : 'workers'}</strong></td>
                    <td />
                    <td className="ui-col-amount"><strong>{money(t.gross)}</strong></td>
                    <td />
                    <td className="ui-col-amount"><strong>{money(t.pfEmployee)}</strong></td>
                    <td className="ui-col-amount"><strong>{money(t.pfEmployer)}</strong></td>
                    <td className="ui-col-amount"><strong>{money(t.esiEmployee)}</strong></td>
                    <td className="ui-col-amount"><strong>{money(t.esiEmployer)}</strong></td>
                    <td className="ui-col-amount"><strong>{money(t.ptEmployee)}</strong></td>
                    <td className="ui-col-amount"><strong>{money(t.net)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

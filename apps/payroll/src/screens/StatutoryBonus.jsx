import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Download, SlidersHorizontal } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { fyLabel } from '@ui/picks/round34';
import { downloadCsv } from '@ui/utils/csv';
import { formatDateIn } from '@ui/utils/dates';
import { rupees as money } from '@ui/utils/money';
import { listPayrollPeriods } from '../api/payrollCalendar';
import { REGISTER_COLUMNS, yearOf, yearsBack } from '../components/bonusText';
import { approveBonus, cancelBonus, getBonusRegister, getBonusSettings, getBonusYear, saveBonusSettings, workOutBonus } from '../api/payrollBonus';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Statutory bonus (round 66 pick): the Payment of Bonus Act's yearly bonus.
 *
 * Pick the year and the share, work it out from the year's approved payslips,
 * check the list (who qualifies first, and why anybody does not), approve it
 * into the pay run of a month, download the Form C register. The Act's figures
 * are settings with the Act's numbers as defaults, each with a note to check
 * the current rule.
 */

const STATUS = {
  DRAFT: { label: 'Draft', pill: 'ui-pill-warn' },
  APPROVED: { label: 'Approved', pill: 'ui-pill-pos' },
  CANCELLED: { label: 'Cancelled', pill: 'ui-pill-neutral' },
};

const FIELDS = [
  { key: 'eligibilityCeiling', label: 'Counts up to (basic + DA a month)', step: '1' },
  { key: 'calculationCeiling', label: 'Worked out on at most (a month)', step: '1' },
  { key: 'minimumWage', label: 'Minimum wage (a month)', step: '1' },
  { key: 'minPercent', label: 'Lowest share (%)', step: '0.01' },
  { key: 'maxPercent', label: 'Highest share (%)', step: '0.01' },
  { key: 'minimumAmount', label: 'Lowest bonus a year', step: '1' },
  { key: 'minDays', label: 'Days worked to qualify', step: '1' },
];

export default function StatutoryBonus() {
  const thisYear = useMemo(() => yearOf(new Date()), []);
  /* The bonus is for a year that has ended, paid within eight months of it: last year first. */
  const years = useMemo(() => [yearsBack(thisYear, 1), thisYear, yearsBack(thisYear, 2)], [thisYear]);
  const [fy, setFy] = useState(years[0]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    setData(null);
    getBonusYear(fy)
      .then((r) => {
        setData(r);
        setError('');
        setRate((prev) => (r.run ? String(r.run.ratePercent) : prev || String(r.rules.minPercent)));
      })
      .catch((e) => setError(errorWords(e, 'load the bonus')));
  }, [fy]);
  useEffect(() => {
    load();
  }, [load]);

  const run = data?.run || null;
  const rules = run?.status === 'APPROVED' ? run.rules : data?.rules;
  const eligible = run ? run.lines.filter((l) => l.eligible) : [];

  const workOut = async () => {
    const ratePercent = Number(rate);
    if (!Number.isFinite(ratePercent) || rate === '') return notify.error('Give the bonus share, like 8.33.');
    setBusy('work');
    try {
      const r = await workOutBonus({ financialYear: fy, ratePercent });
      const n = r.run.lines.filter((l) => l.eligible).length;
      notify.success(`Worked out: ${n} ${n === 1 ? 'person qualifies' : 'people qualify'}, ${money(r.run.totalAmount)}.`);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'calculate the bonus'));
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    setBusy('register');
    try {
      const r = await getBonusRegister(run.id);
      const end = `31 March ${Number(fy.slice(0, 4)) + 1}`;
      downloadCsv({
        fileName: `Bonus register Form C ${fy}`,
        columns: REGISTER_COLUMNS,
        rows: r.rows,
        prefixRows: [[`Form C: bonus paid to employees for the accounting year ending ${end}`], [`Bonus share ${r.run.ratePercent}% of the bonus wages`]],
      });
      notify.success('Downloaded.');
    } catch (e) {
      notify.error(errorWords(e, 'build the register'));
    } finally {
      setBusy('');
    }
  };

  const cancelDraft = async () => {
    const ok = await confirmDialog({ title: 'Cancel this draft?', message: 'Nothing has been paid. You can work the bonus out again afterwards.', confirmLabel: 'Cancel draft bonus', cancelLabel: 'Keep it' });
    if (!ok) return;
    try {
      await cancelBonus(run.id, '');
      notify.success('Draft cancelled.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'cancel the draft bonus'));
    }
  };

  const primary = !run ? (
    <button type="button" className="ui-btn ui-btn-primary" onClick={workOut} disabled={Boolean(busy) || !data}>
      <Calculator size={16} aria-hidden="true" /> {busy === 'work' ? 'Working out…' : 'Work out bonus'}
    </button>
  ) : run.status === 'DRAFT' ? (
    <>
      <button type="button" className="ui-btn ui-btn-secondary" onClick={workOut} disabled={Boolean(busy)}>
        {busy === 'work' ? 'Working out…' : 'Work out again'}
      </button>
      <button type="button" className="ui-btn ui-btn-primary" onClick={() => setApproving(true)} disabled={Boolean(busy) || !eligible.length}>
        Approve bonus
      </button>
    </>
  ) : (
    <button type="button" className="ui-btn ui-btn-secondary" onClick={download} disabled={Boolean(busy)}>
      <Download size={16} aria-hidden="true" /> Download register
    </button>
  );

  return (
    <div className="space-y-3">
      <PageHeader
        entity="payroll"
        title="Statutory bonus"
        description="The yearly bonus under the Payment of Bonus Act, worked out from the year's approved payslips and paid on a pay run."
        actions={<div className="flex flex-wrap gap-2">{primary}</div>}
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem]">
            <label className="ui-label" htmlFor="bonus-year">Year</label>
            <select id="bonus-year" className="ui-select w-full" value={fy} onChange={(e) => setFy(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>{fyLabel(y)}</option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="ui-label" htmlFor="bonus-rate">Bonus share (%)</label>
            <input
              id="bonus-rate"
              className="ui-input w-full tabular-nums text-right"
              inputMode="decimal"
              value={rate}
              disabled={run?.status === 'APPROVED'}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
              aria-describedby="bonus-rate-hint"
            />
          </div>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setRulesOpen(true)}>
            <SlidersHorizontal size={16} aria-hidden="true" /> Rules
          </button>
        </div>
        {rules ? (
          <p id="bonus-rate-hint" className="ui-caption" role="note">
            Between {rules.minPercent}% and {rules.maxPercent}%. Counts months with basic + DA up to {money(rules.eligibilityCeiling)}, worked out on at most{' '}
            {money(Math.max(rules.calculationCeiling, rules.minimumWage || 0))} a month, for people with {rules.minDays} days or more. These are the Act's figures as last checked:
            check the current rule before you approve.
          </p>
        ) : null}

        {error ? <LoadFailed message={error} onRetry={load} /> : null}
        {!data && !error ? <SkeletonCard lines={6} /> : null}

        {data && !run ? (
          <EmptyState
            title={`No bonus worked out for ${fyLabel(fy)}`}
            description="Work it out to see who qualifies and how much. Nothing is paid until it is approved."
          />
        ) : null}

        {run ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className={`ui-pill ${STATUS[run.status].pill} mr-2`}>{STATUS[run.status].label}</span>
                {eligible.length} of {run.lines.length} {run.lines.length === 1 ? 'person qualifies' : 'people qualify'} ·{' '}
                <span className="tabular-nums">{money(run.totalAmount)}</span> at {run.ratePercent}%
                {run.status === 'APPROVED' ? ' · paid as a Statutory bonus earning on the pay run of the month chosen' : ''}
              </p>
              {run.status === 'DRAFT' ? (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={cancelDraft}>Cancel draft</button>
              ) : (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setCancelling((v) => !v)} aria-expanded={cancelling}>Cancel bonus</button>
              )}
            </div>
            {cancelling && run.status === 'APPROVED' ? <CancelForm run={run} onDone={() => { setCancelling(false); load(); }} /> : null}
            <BonusTable lines={run.lines} />
          </>
        ) : null}

        {data?.history?.length ? (
          <p className="ui-caption">
            Cancelled before:{' '}
            {data.history.map((h) => `${h.ratePercent}% on ${formatDateIn(String(h.cancelledAt || h.createdAt).slice(0, 10))}${h.cancelReason ? ` (${h.cancelReason})` : ''}`).join('; ')}
          </p>
        ) : null}
      </div>

      {rulesOpen ? <RulesDrawer onClose={() => setRulesOpen(false)} onSaved={() => { setRulesOpen(false); load(); }} /> : null}
      {approving && run ? <ApproveDrawer run={run} eligible={eligible} onClose={() => setApproving(false)} onDone={() => { setApproving(false); load(); }} /> : null}
    </div>
  );
}

function BonusTable({ lines }) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col" className="ui-col-h-right">Days</th>
            <th scope="col" className="ui-col-h-right">Basic + DA</th>
            <th scope="col" className="ui-col-h-right">Bonus wages</th>
            <th scope="col" className="ui-col-h-right">Bonus</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody className="ui-rows">
          {lines.map((l) => (
            <tr key={l.id} className={l.eligible ? '' : 'ui-muted'}>
              <td>
                <span className="font-medium">{l.name}</span>
                {l.code ? <span className="ui-mono ui-caption ml-2">{l.code}</span> : null}
                {l.designation ? <span className="ui-caption block">{l.designation}</span> : null}
              </td>
              <td className="ui-col-amount">{l.daysWorked}</td>
              <td className="ui-col-amount">{money(l.wages)}</td>
              <td className="ui-col-amount">{l.eligible ? money(l.bonusWages) : '—'}</td>
              <td className="ui-col-amount">{l.eligible ? money(l.amount) : '—'}</td>
              <td className="ui-caption">
                {l.eligible ? null : <span className="ui-pill ui-pill-neutral mr-1">Does not qualify</span>}
                {l.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApproveDrawer({ run, eligible, onClose, onDone }) {
  const [periods, setPeriods] = useState(null);
  const [periodId, setPeriodId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listPayrollPeriods({ openOnly: true })
      .then((ps) => {
        const open = ps.filter((p) => !p.isLocked);
        setPeriods(open);
        setPeriodId(open[0]?.id || '');
      })
      .catch(() => setPeriods([]));
  }, []);
  const approve = async () => {
    setBusy(true);
    try {
      const r = await approveBonus(run.id, periodId);
      notify.success(
        `Approved. ${r.earnings} ${r.earnings === 1 ? 'bonus goes' : 'bonuses go'} on the ${r.periodName} pay run.${r.waiting ? ' Your own bonus waits in Adjustments for somebody else to approve.' : ''}`
      );
      onDone();
    } catch (e) {
      notify.error(errorWords(e, 'approve the bonus'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Approve bonus"
      description={`${eligible.length} ${eligible.length === 1 ? 'person' : 'people'}, ${money(run.totalAmount)} at ${run.ratePercent}%. Each becomes an approved Statutory bonus earning on the pay run of the month you choose.`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={approve} disabled={busy || !periodId}>{busy ? 'Approving…' : 'Approve bonus'}</button>
        </div>
      }
    >
      {!periods ? <SkeletonCard lines={2} /> : null}
      {periods && !periods.length ? <p className="ui-caption" role="alert">There is no open month to pay it in. Add one in Pay calendar first.</p> : null}
      {periods?.length ? (
        <div className="space-y-2">
          <label className="ui-label" htmlFor="bonus-period">Paid on the pay run of</label>
          <select id="bonus-period" className="ui-select w-full" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="ui-caption">The Act asks for the bonus within eight months of the year's end. People who have left are paid through their full and final or by hand.</p>
        </div>
      ) : null}
    </Drawer>
  );
}

function CancelForm({ run, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await cancelBonus(run.id, reason.trim());
      notify.success('Bonus cancelled. Its earnings are taken off the pay run.');
      onDone();
    } catch (err) {
      notify.error(errorWords(err, 'cancel the bonus'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" aria-label="Cancel the approved bonus">
      <div className="grow min-w-[16rem]">
        <label className="ui-label" htmlFor="bonus-cancel-reason">Why is it cancelled?</label>
        <input id="bonus-cancel-reason" className="ui-input w-full" maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
      </div>
      <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || reason.trim().length < 5}>{busy ? 'Cancelling…' : 'Cancel bonus'}</button>
    </form>
  );
}

function RulesDrawer({ onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    getBonusSettings()
      .then((r) => {
        setData(r);
        setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(r.rules[f.key])])));
      })
      .catch((e) => setError(errorWords(e, 'load the rules')));
  }, []);
  const dirty = data ? FIELDS.some((f) => Number(form[f.key]) !== Number(data.rules[f.key])) : false;
  const save = async () => {
    setBusy(true);
    try {
      await saveBonusSettings(Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])));
      notify.success('Bonus rules saved.');
      onSaved();
    } catch (e) {
      notify.error(errorWords(e, 'save the rules'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      dirty={dirty}
      title="Bonus rules"
      description="The Payment of Bonus Act's figures, kept here because the government changes them by notification. Check each against the current rule."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={busy || !data}>{busy ? 'Saving…' : 'Save rules'}</button>
        </div>
      }
    >
      {error ? <p className="ui-caption" role="alert">{error}</p> : null}
      {!data && !error ? <SkeletonCard lines={5} /> : null}
      {data ? (
        <div className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="ui-label" htmlFor={`bonus-rule-${f.key}`}>{f.label}</label>
              <input
                id={`bonus-rule-${f.key}`}
                className="ui-input w-full tabular-nums text-right"
                inputMode="decimal"
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value.replace(/[^\d.]/g, '') }))}
              />
              <span className="ui-caption block">
                {data.notes[f.key]}
                {Number(form[f.key]) !== Number(data.defaults[f.key]) ? ` The Act's figure as last checked: ${data.defaults[f.key]}.` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Drawer>
  );
}

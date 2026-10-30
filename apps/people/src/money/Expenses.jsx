import React, { useMemo, useRef, useState } from 'react';
import { Receipt } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, StatStrip } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { formatDate } from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { PersonCell } from '@ui/lifecycle/shared';

import {
  advanceReturned, downloadCsv, getReport, listAdvances, listCategories, listClaims, listSalaryAdvances, markRecorded, openBill, payAdvance, payClaim, recoverAdvance, saveCategory, sendToPayroll,
} from '../api/money';
import { money } from './words';

/**
 * People › Expenses (WORKFLOW-GAP-RESEARCH 4.1, 4.2): what HR or the owner
 * pays and settles. Claims approved in the inbox wait here to be paid with
 * salary (a draft reimbursement in Payroll) or paid now; advances are paid
 * and settled; salary advances show the Payroll loan they became; what was
 * paid now is listed for entering in Books, with the GST kept for credit.
 */
const TABS = [['pay', 'To pay'], ['advances', 'Advances'], ['salary', 'Salary advances'], ['books', 'For Books'], ['all', 'All claims'], ['report', 'Report']];
const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const yearAgo = () => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');
const PILL = { WITH_SALARY: 'warn', SUBMITTED: 'warn', WAITING: 'warn', APPROVED: 'warn', PAYING: 'warn', PAID: 'pos', SETTLED: 'neutral', CLOSED: 'neutral', REJECTED: 'neg', WITHDRAWN: 'neutral' };
const HR_WORDS = { WITH_SALARY: 'Waiting for Payroll', APPROVED: 'To pay', SUBMITTED: 'Waiting for approval', PAID: 'Paid', SETTLED: 'Set against advance', REJECTED: 'Not approved', PAYING: 'Being paid', WAITING: 'Waiting for approval', CLOSED: 'Settled', WITHDRAWN: 'Withdrawn' };
const Pill = ({ status, label }) => <span className={`ui-pill ui-pill-${PILL[status] || 'neutral'}`}>{label || HR_WORDS[status] || status}</span>;
const METHOD = { CASH: 'Cash', BANK: 'Bank transfer', UPI: 'UPI' };

export default function Expenses({ params = {}, updateParams }) {
  const perms = usePermissions();
  const mayPay = can(perms, 'PEOPLE::Expenses::EDIT');
  const mayExport = can(perms, 'PEOPLE::Expenses::EXPORT');
  const p = params || {};
  const tab = TABS.some(([k]) => k === p.tab) ? p.tab : 'pay';
  const set = (patch, push = false) => updateParams?.(patch, { push });
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const toPay = useRequest(() => listClaims('TO_PAY'), []);

  const exportBooks = () => downloadCsv('books').catch((e) => notify.error(String(e?.message || 'Not downloaded.')));
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Pay, benefits & assets' }]} title="Expenses"
        actions={<>
          {mayPay ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setCategoriesOpen(true)}>Categories and limits</button> : null}
          {mayExport ? <button type="button" className="ui-btn ui-btn-secondary" onClick={exportBooks}>Download for Books</button> : null}
        </>} />
      <div ref={tabsRef} role="tablist" aria-label="Expenses" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => set({ tab: k === 'pay' ? null : k, page: null, q: null }, true)}>
            {l}{k === 'pay' && toPay.data?.length ? <span className="ui-tab-count tabular-nums">{toPay.data.length}</span> : null}
          </button>
        ))}
        {tabIndicator}
      </div>
      {tab === 'pay' || tab === 'all' || tab === 'books' ? <ClaimList key={tab} tab={tab} params={p} set={set} mayPay={mayPay} onPaid={toPay.reload} preloaded={tab === 'pay' ? toPay : null} /> : null}
      {tab === 'advances' ? <AdvanceList params={p} set={set} mayPay={mayPay} /> : null}
      {tab === 'salary' ? <SalaryAdvanceList params={p} set={set} mayPay={mayPay} /> : null}
      {tab === 'report' ? <Report mayExport={mayExport} /> : null}
      {categoriesOpen ? <CategoriesDrawer onClose={() => setCategoriesOpen(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

function ClaimList({ tab, params: p, set, mayPay, onPaid, preloaded }) {
  const own = useRequest(() => (preloaded ? Promise.resolve(null) : listClaims(tab === 'books' ? 'BOOKS' : '')), [tab]);
  const req = preloaded || own;
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const q = String(p.q || '').trim().toLowerCase();
  const rows = useMemo(() => (req.data || []).filter((c) => !q || `${c.employeeName} ${c.employeeCode} ${c.number} ${c.title}`.toLowerCase().includes(q)), [req.data, q]);
  const reload = () => { req.reload(); onPaid?.(); };
  const recorded = async () => {
    try {
      const r = await markRecorded({ claimIds: [...selected] });
      notify.success(`${r.recorded} marked as entered in Books.`);
      setSelected(new Set());
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const amountOf = (c) => (tab === 'pay' ? c.toPay : c.approved ?? c.claimed);
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (c) => <PersonCell person={{ name: c.employeeName || '—' }} line={c.employeeCode || ''} /> },
    { key: 'claim', label: 'Claim', render: (c) => <span className="min-w-0"><span className="block truncate">{c.title}</span><span className="block ui-caption">{c.number} · {c.lines.length} bill{c.lines.length === 1 ? '' : 's'}</span></span> },
    { key: 'status', label: 'Status', render: (c) => <span className="block"><Pill status={c.status} />{c.status === 'PAID' || c.status === 'WITH_SALARY' ? <span className="block ui-caption mt-0.5">{c.payMode === 'SALARY' ? `With salary${c.payrollPeriodName ? `, ${c.payrollPeriodName}` : ''}` : `${METHOD[c.paidMethod] || 'Paid now'} · ${day(c.paidOn)}`}</span> : null}</span> },
    { key: 'amount', label: tab === 'pay' ? 'To pay' : 'Amount', align: 'right', render: (c) => <span className="tabular-nums whitespace-nowrap">{money(amountOf(c))}</span> },
  ];
  const books = tab === 'books';
  return (
    <>
      {books && selected.size ? (
        <div className="ui-bulkbar" role="region" aria-label="Mark the chosen claims">
          <span className="text-sm"><strong className="tabular-nums">{selected.size}</strong> chosen</span>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={recorded}>Mark entered in Books</button>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}
      {books ? <p className="ui-caption">Every approved bill, however it was paid. Books does not take these by itself yet: enter each in Books (Download for Books has the GSTIN, the GST and any advance used), then mark it here.</p> : null}
      <DataTable
        label={TABS.find(([k]) => k === tab)?.[1]}
        columns={columns}
        rows={rows.slice((page - 1) * size, page * size)}
        total={rows.length}
        page={page}
        pageSize={size}
        noun="claims"
        selectable={books && mayPay}
        selected={selected}
        onSelect={(next) => setSelected(new Set(next))}
        onPage={(n) => set({ page: n > 1 ? n : null }, true)}
        onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
        onRowClick={(c) => setOpen(c)}
        loading={req.loading}
        refreshing={req.refreshing}
        card={(c) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{c.employeeName}</span><span className="tabular-nums">{money(amountOf(c))}</span></span>
            <span className="flex items-center justify-between gap-2"><span className="truncate ui-caption">{c.number} · {c.title}</span><Pill status={c.status} /></span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(v) => set({ q: v || null, page: null })} placeholder="Search name, employee ID or claim" label="Search claims" className="w-full sm:w-72" />}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} />
          : q ? <EmptyState kind="filtered" title="Nothing matches" onClearFilters={() => set({ q: null, page: null })} />
            : <EmptyState icon={Receipt} title={tab === 'pay' ? 'Nothing to pay' : books ? 'Nothing waiting to go into Books' : 'No claims yet'} description={tab === 'pay' ? 'Claims approved in Approvals wait here to be paid.' : tab === 'all' ? 'Staff add bills from the employee app, under Me.' : undefined} />}
      />
      {open ? <ClaimDrawer claim={open} reimbursement={req.data?.reimbursement} mayPay={mayPay} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} /> : null}
    </>
  );
}

function ClaimDrawer({ claim: c, reimbursement, mayPay, onClose, onDone }) {
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ paidOn: today(), method: 'UPI', reference: '' });
  const [busy, setBusy] = useState('');
  const pay = async (mode) => {
    if (busy) return;
    if (mode === 'SALARY' && !(await confirmDialog({ title: `Pay ${money(c.toPay)} with ${c.employeeName}’s salary?`, message: `It goes to Payroll as a reimbursement for this month${reimbursement?.taxed === false ? ', not taxed' : reimbursement?.taxed ? ` on ${reimbursement.name}, which Payroll taxes as it is set up` : ''}. It shows as paid once Payroll approves it.`, confirmLabel: 'Pay with salary' }))) return;
    setBusy(mode);
    try {
      await payClaim(c.id, mode === 'SALARY' ? { mode } : { mode, ...form });
      notify.success(mode === 'SALARY' ? 'Sent to Payroll with this month’s salary.' : 'Marked paid. It waits under For Books.');
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not paid.'));
    } finally {
      setBusy('');
    }
  };
  const payable = c.status === 'APPROVED' && mayPay;
  return (
    <Drawer open onClose={onClose} title={`${c.employeeName}: ${c.title}`} widthClass="w-[min(40rem,96vw)]"
      actions={payable ? (paying
        ? <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setPaying(false)}>Back</button><button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => pay('NOW')}>{busy === 'NOW' ? 'Saving…' : 'Mark paid'}</button></>
        : <><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setPaying(true)}>Paid now</button><button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => pay('SALARY')}>{busy === 'SALARY' ? 'Sending…' : 'Pay with salary'}</button></>) : null}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="ui-t-label">Claim</dt><dd>{c.number}</dd></div>
          <div><dt className="ui-t-label">Status</dt><dd><Pill status={c.status} /></dd></div>
          <div><dt className="ui-t-label">To pay</dt><dd className="tabular-nums">{c.toPay != null ? money(c.toPay) : '—'}</dd></div>
        </dl>
        {paying ? (
          <div className="ui-form-grid">
            <label className="block"><span className="ui-label">Paid on</span><input type="date" className="ui-input w-full" max={today()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} /></label>
            <label className="block"><span className="ui-label">How</span>
              <select className="ui-select w-full" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2"><span className="ui-label">Reference</span><SuggestInput value={form.reference} onChange={(v) => setForm({ ...form, reference: v })} maxLength={80} placeholder="UTR or cheque number" suggestions={[]} /></label>
          </div>
        ) : null}
        <table className="w-full text-sm">
          <thead><tr className="ui-t-label text-left"><th className="py-1.5 pr-3 font-medium">Bill</th><th className="py-1.5 pr-3 text-right font-medium">Asked</th><th className="py-1.5 text-right font-medium">Allowed</th></tr></thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.id} className="border-t align-top" style={{ borderColor: 'rgb(var(--border))' }}>
                <td className="py-2 pr-3">
                  <span className="block font-medium">{l.merchant}</span>
                  <span className="ui-caption block">{day(l.spentOn)} · {l.category}</span>
                  {l.companyGstin ? <span className="ui-caption block">GSTIN {l.supplierGstin || 'not given'}{l.taxAmount != null ? ` · GST ${money(l.taxAmount)}` : ''}{l.creditBlocked ? ' · credit usually not available' : ''}</span> : null}
                  {l.cutReason ? <span className="ui-caption block">Allowed less: {l.cutReason}</span> : null}
                  {l.billId ? <button type="button" className="ui-link text-xs" onClick={() => openBill(l.billId).catch((e) => notify.error(String(e?.message || 'Could not open the bill.')))}>See the bill</button> : <span className="ui-caption block">No bill</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(l.amount)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.approvedAmount ?? l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.advanceSettled ? <p className="ui-caption tabular-nums">{money(c.advanceSettled)} set against advance {c.advanceNumber || ''}; the rest is to pay.</p> : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------

function AdvanceList({ params: p, set, mayPay }) {
  const req = useRequest(() => listAdvances(), []);
  const [open, setOpen] = useState(null);
  const q = String(p.q || '').trim().toLowerCase();
  const rows = (req.data || []).filter((a) => a.status !== 'WITHDRAWN' && (!q || `${a.employeeName} ${a.employeeCode} ${a.number} ${a.purpose}`.toLowerCase().includes(q)));
  const label = (a) => (a.status === 'APPROVED' ? 'To pay' : a.status === 'PAID' ? (a.recovering && !a.open ? 'Waiting for Payroll' : a.overdue ? 'Bills overdue' : 'Open') : HR_WORDS[a.status]);
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (a) => <PersonCell person={{ name: a.employeeName || '—' }} line={a.employeeCode || ''} /> },
    { key: 'for', label: 'For', render: (a) => <span className="min-w-0"><span className="block truncate">{a.purpose}</span><span className="block ui-caption">{a.number}{a.settleBy && a.status === 'PAID' ? ` · bills by ${day(a.settleBy)}` : ''}</span></span> },
    { key: 'status', label: 'Status', render: (a) => <span className={`ui-pill ui-pill-${a.overdue ? 'neg' : PILL[a.status] || 'neutral'}`}>{label(a)}</span> },
    { key: 'amount', label: 'Given', align: 'right', render: (a) => <span className="tabular-nums">{money(a.amount)}</span> },
    { key: 'open', label: 'Still open', align: 'right', render: (a) => <span className="tabular-nums">{a.status === 'PAID' ? money(a.open) : '—'}</span> },
  ];
  return (
    <>
      <DataTable label="Advances" columns={columns} rows={rows} total={rows.length} pageSize={Math.max(25, rows.length)} noun="advances" onRowClick={(a) => setOpen(a)} loading={req.loading} refreshing={req.refreshing}
        card={(a) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{a.employeeName}</span><span className="tabular-nums">{money(a.status === 'PAID' ? a.open : a.amount)}</span></span>
            <span className="flex items-center justify-between gap-2"><span className="truncate ui-caption">{a.number} · {a.purpose}</span><span className={`ui-pill ui-pill-${a.overdue ? 'neg' : PILL[a.status] || 'neutral'}`}>{label(a)}</span></span>
          </span>
        )}
        toolbar={<SearchField value={p.q || ''} onSearch={(v) => set({ q: v || null })} placeholder="Search name or purpose" label="Search advances" className="w-full sm:w-72" />}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState icon={Receipt} title="No advances" description="Staff ask for one from the employee app, under Me." />} />
      {open ? <AdvanceDrawer advance={open} mayPay={mayPay} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} /> : null}
    </>
  );
}

function AdvanceDrawer({ advance: a, mayPay, onClose, onDone }) {
  const [form, setForm] = useState({ paidOn: today(), method: 'UPI', reference: '', back: '' });
  const [busy, setBusy] = useState('');
  const run = async (key, fn, done) => {
    setBusy(key);
    try {
      const r = await fn();
      notify.success(typeof done === 'function' ? done(r) : done);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const toPay = a.status === 'APPROVED' && mayPay;
  const open = a.status === 'PAID' && a.open > 0 && mayPay;
  return (
    <Drawer open onClose={onClose} title={`${a.employeeName}: ${a.purpose}`} widthClass="w-[min(32rem,96vw)]"
      actions={toPay ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy)} onClick={() => run('pay', () => payAdvance(a.id, form), 'Marked paid.')}>{busy ? 'Saving…' : `Mark ${money(a.amount)} paid`}</button>
        : open ? <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={async () => { if (await confirmDialog({ title: `Take ${money(a.open)} from ${a.employeeName}’s salary?`, message: 'It goes to Payroll as a deduction this month, within half their pay; anything over that stays open.', confirmLabel: 'Take from salary' })) run('recover', () => recoverAdvance(a.id), (r) => (r.left > 0 ? `${money(r.recovered)} goes to Payroll; ${money(r.left)} stays open.` : `${money(r.recovered)} goes to Payroll.`)); }}>Take from salary</button> : null}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="ui-t-label">Advance</dt><dd>{a.number}</dd></div>
          <div><dt className="ui-t-label">Given</dt><dd className="tabular-nums">{money(a.amount)}{a.paidOn ? ` on ${day(a.paidOn)}` : ''}</dd></div>
          <div><dt className="ui-t-label">Used on claims</dt><dd className="tabular-nums">{money(a.settled)}</dd></div>
          <div><dt className="ui-t-label">Given back or taken from pay</dt><dd className="tabular-nums">{money(a.returned + a.recovered)}{a.recovering ? <span className="ui-caption block">{money(a.recovering)} waiting in Payroll</span> : null}</dd></div>
          <div><dt className="ui-t-label">Still open</dt><dd className="tabular-nums">{a.status === 'PAID' ? money(a.open) : '—'}</dd></div>
          <div><dt className="ui-t-label">Bills by</dt><dd>{a.settleBy ? day(a.settleBy) : '—'}{a.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</dd></div>
        </dl>
        {toPay ? (
          <div className="ui-form-grid">
            <label className="block"><span className="ui-label">Paid on</span><input type="date" className="ui-input w-full" max={today()} value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} /></label>
            <label className="block"><span className="ui-label">How</span><select className="ui-select w-full" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="ui-label">Reference</span><SuggestInput value={form.reference} onChange={(v) => setForm({ ...form, reference: v })} maxLength={80} placeholder="UTR or cheque number" suggestions={[]} /></label>
          </div>
        ) : null}
        {open ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="ui-label">Given back</span><input className="ui-input w-36 tabular-nums" inputMode="decimal" placeholder={String(a.open)} value={form.back} onChange={(e) => setForm({ ...form, back: e.target.value.replace(/[^\d.]/g, '') })} /></label>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => run('back', () => advanceReturned(a.id, form.back ? Number(form.back) : undefined), (r) => (r.left > 0 ? `Recorded; ${money(r.left)} still open.` : 'Recorded; the advance is settled.'))}>Record</button>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Salary advances
// ---------------------------------------------------------------------------

function SalaryAdvanceList({ params: p, set, mayPay }) {
  const req = useRequest(() => listSalaryAdvances(), []);
  const q = String(p.q || '').trim().toLowerCase();
  const rows = (req.data || []).filter((a) => a.status !== 'WITHDRAWN' && (!q || `${a.employeeName} ${a.employeeCode} ${a.reason}`.toLowerCase().includes(q)));
  const again = async (a) => {
    try {
      const r = await sendToPayroll(a.id);
      notify.success(`Payroll loan ${r.number || ''} made.`.replace('  ', ' '));
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not sent.'));
    }
  };
  const loanText = (a) => (a.loan ? `${a.loan.number} · ${a.loan.status === 'DRAFT' ? 'waiting for Payroll to approve' : `${money(a.loan.outstanding)} left`}` : a.payrollNote || '');
  const columns = [
    { key: 'person', label: 'Person', always: true, render: (a) => <PersonCell person={{ name: a.employeeName || '—' }} line={a.employeeCode || ''} /> },
    { key: 'terms', label: 'Asked', render: (a) => <span className="min-w-0"><span className="block tabular-nums">{money(a.amount)} over {a.months} month{a.months === 1 ? '' : 's'}</span><span className="block ui-caption tabular-nums">{money(a.emi)} a month · {a.reason}</span></span> },
    { key: 'status', label: 'Status', render: (a) => <span className={`ui-pill ui-pill-${PILL[a.status] === 'warn' && a.status === 'APPROVED' ? 'pos' : PILL[a.status] || 'neutral'}`}>{a.statusLabel}</span> },
    { key: 'loan', label: 'Payroll loan', render: (a) => <span className="block max-w-xs"><span className={`block ${a.payrollNote && !a.loan ? 'ui-text-warn' : ''}`}>{loanText(a) || '—'}</span>{mayPay && a.status === 'APPROVED' && !a.loan ? <button type="button" className="ui-link text-xs" onClick={(e) => { e.stopPropagation(); again(a); }}>Send to Payroll</button> : null}</span> },
  ];
  return (
    <DataTable label="Salary advances" columns={columns} rows={rows} total={rows.length} pageSize={Math.max(25, rows.length)} noun="salary advances" loading={req.loading} refreshing={req.refreshing}
      card={(a) => (
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{a.employeeName}</span><span className="tabular-nums">{money(a.amount)}</span></span>
          <span className="flex items-center justify-between gap-2"><span className="truncate ui-caption">{loanText(a) || `${money(a.emi)} a month`}</span><span className="ui-pill ui-pill-neutral">{a.statusLabel}</span></span>
        </span>
      )}
      toolbar={<SearchField value={p.q || ''} onSearch={(v) => set({ q: v || null })} placeholder="Search name" label="Search salary advances" className="w-full sm:w-72" />}
      empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState icon={Receipt} title="No salary advances" description="Staff ask from the employee app, within half their pay. You decide in Approvals." />} />
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function Report({ mayExport }) {
  const [range, setRange] = useState({ from: yearAgo(), to: today() });
  const req = useRequest(() => getReport(range.from, range.to), [range.from, range.to]);
  const r = req.data;
  const table = (title, rows, name) => (
    <section className="space-y-2" aria-label={title}>
      <h2 className="ui-t-sec">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead><tr className="ui-t-label text-left"><th className="py-1.5 pr-3 font-medium">{name}</th><th className="py-1.5 pr-3 text-right font-medium">Bills</th><th className="py-1.5 pr-3 text-right font-medium">GST kept</th><th className="py-1.5 text-right font-medium">Approved</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.key} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}><td className="py-2 pr-3">{x.label}</td><td className="py-2 pr-3 text-right tabular-nums">{x.bills}</td><td className="py-2 pr-3 text-right tabular-nums">{x.gst ? money(x.gst) : '—'}</td><td className="py-2 text-right tabular-nums">{money(x.amount)}</td></tr>)}</tbody>
        </table>
      ) : <p className="ui-caption">Nothing approved in these dates.</p>}
    </section>
  );
  const monthWords = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={range.to} min={range.from} max={today()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        {mayExport ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => downloadCsv('claims', range.from, range.to).catch((e) => notify.error(String(e?.message || 'Not downloaded.')))}>Download bills (CSV)</button> : null}
      </div>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : !r ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <>
          <StatStrip items={[
            { label: 'Approved spend', value: money(r.total) },
            { label: 'To pay now', value: money(r.toPay.amount), hint: `${r.toPay.count} claim${r.toPay.count === 1 ? '' : 's'}` },
            { label: 'Waiting for approval', value: money(r.waiting.amount), hint: `${r.waiting.count} claim${r.waiting.count === 1 ? '' : 's'}` },
            { label: 'Advances still open', value: money(r.openAdvanceTotal), hint: `${r.openAdvances.length} advance${r.openAdvances.length === 1 ? '' : 's'}` },
          ]} />
          <div className="grid gap-8 lg:grid-cols-2">
            {table('By person', r.byPerson.map((x) => ({ ...x, label: x.code ? `${x.name} (${x.code})` : x.name })), 'Person')}
            {table('By category', r.byCategory.map((x) => ({ ...x, label: x.key })), 'Category')}
            {table('By month', r.byMonth.map((x) => ({ ...x, label: monthWords(x.key) })), 'Month')}
            <section className="space-y-2" aria-label="Advances still open">
              <h2 className="ui-t-sec">Advances still open</h2>
              {r.openAdvances.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="ui-t-label text-left"><th className="py-1.5 pr-3 font-medium">Person</th><th className="py-1.5 pr-3 font-medium">Bills by</th><th className="py-1.5 text-right font-medium">Open</th></tr></thead>
                  <tbody>{r.openAdvances.map((a) => <tr key={a.id} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}><td className="py-2 pr-3">{a.employeeName}<span className="ui-caption block">{a.number} · {a.purpose}</span></td><td className="py-2 pr-3">{day(a.settleBy)}{a.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</td><td className="py-2 text-right tabular-nums">{money(a.open)}</td></tr>)}</tbody>
                </table>
              ) : <p className="ui-caption">None.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesDrawer({ onClose }) {
  const req = useRequest(() => listCategories(), []);
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState({ name: '', limitPerBill: '', creditBlocked: false });
  const [busy, setBusy] = useState(false);
  const save = async (row) => {
    setBusy(true);
    try {
      await saveCategory(row);
      notify.success('Saved.');
      setEdit({});
      setAdding({ name: '', limitPerBill: '', creditBlocked: false });
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const rows = req.data || [];
  return (
    <Drawer open onClose={onClose} title="Categories and limits" widthClass="w-[min(36rem,96vw)]">
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : (
        <div className="space-y-4 text-sm">
          <ul className="divide-y border-t" style={{ borderColor: 'rgb(var(--border))' }}>
            {rows.map((c) => {
              const e = edit[c.id];
              return (
                <li key={c.id} className="py-2.5">
                  {e ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                      <SuggestInput aria-label="Name" maxLength={60} value={e.name} onChange={(v) => setEdit({ [c.id]: { ...e, name: v } })} suggestions={[]} />
                      <input className="ui-input tabular-nums" aria-label="Limit per bill" inputMode="decimal" placeholder="No limit" value={e.limitPerBill ?? ''} onChange={(ev) => setEdit({ [c.id]: { ...e, limitPerBill: ev.target.value.replace(/[^\d.]/g, '') } })} />
                      <label className="flex items-center gap-2"><input type="checkbox" checked={e.creditBlocked} onChange={(ev) => setEdit({ [c.id]: { ...e, creditBlocked: ev.target.checked } })} /> GST credit usually not available</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={e.active} onChange={(ev) => setEdit({ [c.id]: { ...e, active: ev.target.checked } })} /> In use</label>
                      <span className="flex gap-2 sm:col-span-2"><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={() => save({ ...e, id: c.id })}>Save</button><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setEdit({})}>Cancel</button></span>
                    </div>
                  ) : (
                    <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setEdit({ [c.id]: { name: c.name, limitPerBill: c.limitPerBill ?? '', creditBlocked: c.creditBlocked, active: c.active } })}>
                      <span className="min-w-0"><span className={`block ${c.active ? '' : 'ui-muted'}`}>{c.name}{c.active ? '' : ' (not in use)'}</span>{c.creditBlocked ? <span className="ui-caption block">GST credit usually not available</span> : null}</span>
                      <span className="shrink-0 tabular-nums">{c.limitPerBill ? `Up to ${money(c.limitPerBill)}` : 'No limit'}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <form className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); save(adding); }}>
            <label className="block"><span className="ui-label">New category</span><SuggestInput value={adding.name} onChange={(v) => setAdding({ ...adding, name: v })} maxLength={60} placeholder="e.g. Site supplies" suggestions={[]} /></label>
            <label className="block"><span className="ui-label">Limit per bill</span><input className="ui-input w-full tabular-nums" inputMode="decimal" placeholder="No limit" value={adding.limitPerBill} onChange={(e) => setAdding({ ...adding, limitPerBill: e.target.value.replace(/[^\d.]/g, '') })} /></label>
            <button type="submit" className="ui-btn ui-btn-secondary" disabled={busy || !adding.name.trim()}>Add</button>
          </form>
          <p className="ui-caption">A bill over its limit can still be sent; the approver sees the warning and decides.</p>
        </div>
      )}
    </Drawer>
  );
}

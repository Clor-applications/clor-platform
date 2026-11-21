import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormPart } from '@ui/components/ui/FormPart';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { AlertTriangle, ArrowLeft, Ban, Check, Download, Plus, Wallet, X } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { PageHeader, SkeletonCard, EmptyState, Button } from '@ui/components/ui/Primitives';
import Drawer from '../components/EditDrawer';
import { Figures } from '../components/Figure';
import Notice from '../components/Notice';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayrollRuns } from '../api/payrollRuns';
import { paymentAccounts } from '../api/payrollAccounting';
import { downloadCsv } from '@ui/utils/csv';
import {
  listPayrollPayments,
  getPayrollPayment,
  createPayrollPayment,
  previewRunPayment,
  settlePaymentLines,
  previewPaymentPosting,
  postPayrollPayment,
  cancelPayrollPayment,
  getBankAdvice,
} from '../api/payrollPayments';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { rupees as money, moneyCell } from '@ui/utils/money';
import { dayText, errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';
import { dateWords } from '@ui/utils/dates';

/**
 * Paying people, and saying what the bank did about it.
 *
 * A batch has three moments and the screen keeps them apart, because collapsing
 * them is how somebody marks four hundred people paid before the bank has said
 * anything: the file goes out, the answers come back, and only then does the
 * money leave the books.
 *
 * Failures are the interesting case and the screen treats them as ordinary. A
 * rejected line is shown with its reason, stays owed, and reappears in the next
 * batch on its own. Nobody has to notice.
 *
 * Bank account numbers are masked here and whole only in the download. A salary
 * list on a screen is worth stealing; one with account numbers on it is worth
 * more, and no screen needs them.
 */

const STATUS = {
  DRAFT: { label: 'Not sent', tone: 'ui-pill-neutral' },
  PROCESSING: { label: 'Waiting for bank', tone: 'ui-pill-warn' },
  COMPLETED: { label: 'Paid', tone: 'ui-pill-pos' },
  PARTIAL: { label: 'Partly paid', tone: 'ui-pill-warn' },
  FAILED: { label: 'All rejected', tone: 'ui-pill-neg' },
  CANCELLED: { label: 'Cancelled', tone: 'ui-pill-neutral' },
};

const LINE_STATUS = {
  PENDING: { label: 'Waiting', tone: 'ui-pill-neutral' },
  PAID: { label: 'Paid', tone: 'ui-pill-pos' },
  FAILED: { label: 'Rejected', tone: 'ui-pill-neg' },
  /* The batch was called off: the payslip went back to be paid in another. */
  CANCELLED: { label: 'Cancelled', tone: 'ui-pill-neutral' },
};

const METHODS = [
  { id: 'BANK_TRANSFER', label: 'Bank transfer' },
  { id: 'CHEQUE', label: 'Cheque' },
  { id: 'CASH', label: 'Cash' },
];



const today = () => new Date().toISOString().slice(0, 10);

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'OPEN', label: 'With the bank', tone: 'outstanding' },
  { value: 'COMPLETED', label: 'Paid', tone: 'paid' },
  { value: 'PROBLEM', label: 'Rejections', tone: 'overdue' },
  { value: 'CANCELLED', label: 'Cancelled', tone: 'cancelled' },
];
const inTabOf = (p, t) => {
  if (!t) return true;
  if (t === 'OPEN') return ['DRAFT', 'PROCESSING'].includes(p.status);
  if (t === 'PROBLEM') return ['PARTIAL', 'FAILED'].includes(p.status);
  return p.status === t;
};
const COLUMNS = {
  run: (p) => p.runNumber || '—',
  books: (p) => (p.postingStatus === 'POSTED' ? 'Posted' : 'Not yet'),
};
const EXPORT_COLUMNS = [
  { key: 'number', label: 'Payment' },
  { key: 'runNumber', label: 'Payroll' },
  { key: 'paymentDate', label: 'Date' },
  { key: 'totalAmount', label: 'Amount', value: (p) => Number(p.totalAmount || 0) },
  { key: 'paidAmount', label: 'Paid', value: (p) => Number(p.paidAmount || 0) },
  { key: 'failedCount', label: 'Rejected', value: (p) => Number(p.failedCount || 0) },
  { key: 'status', label: 'Status', value: (p) => STATUS[p.status]?.label || p.status },
  { key: 'postingStatus', label: 'In accounts', value: (p) => (p.postingStatus === 'POSTED' ? 'Posted' : 'Not yet') },
];

export default function PayrollPayments({ menuLabel } = {}) {
  const [payments, setPayments] = useState(null);
  const [runs, setRuns] = useState([]);
  const [banks, setBanks] = useState([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    Promise.all([listPayrollPayments(), listPayrollRuns(), paymentAccounts().catch(() => [])])
      .then(([paymentRows, runRows, ledger]) => {
        setPayments(paymentRows);
        /* Only a payroll somebody has approved can be paid, so only those are
           offered. */
        setRuns(runRows.filter((r) => ['APPROVED', 'LOCKED', 'POSTED', 'PAID'].includes(r.status)));
        setBanks(ledger);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load salary payments')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, (payments || []).filter((p) => inTabOf(p, t.value)).length])), [payments]);
  const figures = useMemo(() => {
    const list = (payments || []).filter((p) => p.status !== 'CANCELLED');
    return {
      sent: list.reduce((a, p) => a + Number(p.totalAmount || 0), 0),
      paid: list.reduce((a, p) => a + Number(p.paidAmount || 0), 0),
      rejected: list.reduce((a, p) => a + Number(p.failedCount || 0), 0),
      unposted: list.filter((p) => p.postingStatus !== 'POSTED').length,
    };
  }, [payments]);
  const inTab = useMemo(() => (payments || []).filter((p) => inTabOf(p, status)), [payments, status]);
  const search = useListSearch(inTab, ['number', 'runNumber']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);

  if (openId) {
    return (
      <PaymentDetail
        paymentId={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const start = () => setStarting(true);

  return (
    <DocumentListShell
      entity="payment"
      title={menuLabel || 'Payments'}
      description="The money going out for an approved payroll, what the bank did with each line, and the entry that clears it."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search payments…', label: 'Search salary payments' }}
      moreItems={payments?.length ? [exportMenuItem('Export payments')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Payments', fileName: 'Salary payments', label: 'payment/payments', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={start} disabled={!runs.length || starting}>
          <Plus size={16} aria-hidden="true" /> New payment
        </button>
      }
      countLine={countItems([
        { label: 'Sent', value: figures.sent, tone: 'sent' },
        { label: 'Paid', value: figures.paid, tone: 'paid', onSelect: () => setStatus('COMPLETED') },
        { label: 'Rejected', value: figures.rejected, count: true, tone: 'overdue', onSelect: () => setStatus('PROBLEM') },
        { label: 'Not posted', value: figures.unposted, count: true, tone: 'outstanding' },
      ])}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Payment status"
    >
      {/* Started in a drawer, so the list page keeps one primary button. */}
      <Drawer open={starting} onClose={() => setStarting(false)} title="New payment" description="Who is owed on an approved payroll, previewed before anything goes to the bank.">
        {starting ? (
          <StartPayment
            runs={runs}
            banks={banks}
            onCancel={() => setStarting(false)}
            onCreated={(payment) => {
              setStarting(false);
              setOpenId(payment.id);
            }}
          />
        ) : null}
      </Drawer>
      <LoadFailed message={error} onRetry={load} />
      {!payments ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <th scope="col">Payment</th>
                <ColumnHeader label="Payroll" col="run" state={filters} />
                <th scope="col" className="ui-col-h-center">Date</th>
                <th scope="col" className="ui-col-h-right">Amount</th>
                <th scope="col" className="ui-col-h-right">Paid</th>
                <th scope="col" className="ui-col-h-right">Rejected</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <ColumnHeader label="In accounts" col="books" state={filters} align="center" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={8}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No payments match" description="Nothing in this tab matches the search or the column filters." />
                    ) : !runs.length && !payments.length ? (
                      <EmptyState
                        icon={Wallet}
                        title="No approved payroll to pay"
                        description="A payroll is paid once it has been checked and approved. Run one under Pay runs and approve it, and it becomes payable here."
                      />
                    ) : (
                      <EmptyState
                        icon={Wallet}
                        title={{ OPEN: 'No payments waiting for the bank', COMPLETED: 'No payments paid yet', PROBLEM: 'No payments with rejections', CANCELLED: 'No cancelled payments' }[status] || 'Nothing has been paid yet'}
                        description="Start a payment and it gathers everybody on an approved payroll who is still owed, with the bank details to pay them at."
                        routes={runs.length && !status ? [{ label: 'New payment', description: 'Preview who is owed before anything is sent.', onSelect: start }] : undefined}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="ui-row-click" onClick={() => setOpenId(p.id)}>
                    <td className="ui-col-id" data-phone="sub">{p.number}</td>
                    <td className="ui-col-entity" data-phone="name">{p.runNumber || '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{dateWords(p.paymentDate)}</td>
                    <td className="ui-col-amount" data-phone="key">{moneyCell(p.totalAmount)}</td>
                    <td className="ui-col-amount">{moneyCell(p.paidAmount)}</td>
                    <td className="ui-col-amount">{p.failedCount || '—'}</td>
                    <td className="ui-col-h-center" data-phone="tag">
                      <ExceptionTag label={p.status === 'COMPLETED' ? '' : STATUS[p.status]?.label || p.status} normal={STATUS[p.status]?.label} pill={STATUS[p.status]?.tone || 'ui-pill-neutral'} />
                    </td>
                    <td className="ui-col-h-center">
                      <ExceptionTag label={p.postingStatus === 'POSTED' ? '' : 'Not yet'} tone="neutral" normal="Posted" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}

/**
 * Starting a batch.
 *
 * The preview comes before the button, because the thing worth knowing — that
 * eleven people have no bank account on file — is worth knowing while somebody
 * can still fix it, not at the moment the file is due at the bank.
 */
const StartPayment = ({ runs, banks, onCancel, onCreated }) => {
  const [form, setForm] = useState({
    runId: runs[0]?.id || '',
    paymentDate: today(),
    method: 'BANK_TRANSFER',
    ledgerAccountId: banks[0]?.id || '',
    reference: '',
  });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  useEffect(() => {
    if (!form.runId) {
      setPreview(null);
      return undefined;
    }
    let alive = true;
    setPreviewing(true);
    previewRunPayment(form.runId)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setPreview(null);
      })
      .finally(() => {
        if (alive) setPreviewing(false);
      });
    return () => {
      alive = false;
    };
  }, [form.runId]);

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      onCreated(
        await createPayrollPayment({
          runId: form.runId,
          paymentDate: form.paymentDate,
          method: form.method,
          ledgerAccountId: form.ledgerAccountId || null,
          reference: form.reference.trim() || null,
        })
      );
    } catch (err) {
      notify.error(errorWords(err, 'start that payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={save}>
      <FormPart title="Payment" id="new-payment">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ui-label" htmlFor="pay-run">Payroll</label>
              <select id="pay-run" className="ui-select w-full" value={form.runId} onChange={(e) => set({ runId: e.target.value })} required>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} · {r.period?.name || dateWords(r.payrollDate)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="pay-date">Payment date</label>
              <input id="pay-date" type="date" className="ui-input w-full" value={form.paymentDate} onChange={(e) => set({ paymentDate: e.target.value })} required />
            </div>
            <div>
              <label className="ui-label" htmlFor="pay-method">Payment method</label>
              <select id="pay-method" className="ui-select w-full" value={form.method} onChange={(e) => set({ method: e.target.value })}>
                {METHODS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="ui-label" htmlFor="pay-bank">Paid from</label>
              <select id="pay-bank" className="ui-select w-full" value={form.ledgerAccountId} onChange={(e) => set({ ledgerAccountId: e.target.value })}>
                <option value="">Decide later</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <span className="ui-caption">The account the money leaves. Needed before this payment is posted to accounts.</span>
            </div>
          </div>

          <div>
            <label className="ui-label" htmlFor="pay-ref">Reference</label>
            <input
              id="pay-ref"
              className="ui-input w-full"
              value={form.reference}
              onChange={(e) => set({ reference: e.target.value })}
              placeholder="The batch number your bank gave it, if you have one"
            />
          </div>

          {previewing ? (
            <p className="ui-caption">Working out who is owed…</p>
          ) : preview ? (
            <div className="space-y-3">
              <p className="ui-caption">
                {preview.payable.length} {preview.payable.length === 1 ? 'person' : 'people'} owed {money(preview.totalAmount)}
                {preview.blocked.length ? ` · ${preview.blocked.length} already in another payment` : ''}
              </p>
              {preview.missingBankDetails ? (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
                  <p className="ui-caption">
                    {preview.missingBankDetails} {preview.missingBankDetails === 1 ? 'person has' : 'people have'} no bank account on file. They can
                    still be in the batch and marked paid by hand, but they will not be in the file for the bank.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </FormPart>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <Button loading={saving} disabled={!form.runId || !preview?.payable?.length} type="submit" variant="primary" loading={saving}>
          Start payment
        </Button>
      </div>
    </form>
  );
};

const PaymentDetail = ({ paymentId, onBack }) => {
  const [payment, setPayment] = useState(null);
  const [posting, setPosting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [failing, setFailing] = useState(null);
  /* A failed load says so with a way to try again, not a blank page. */
  const [loadError, setLoadError] = useState('');
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const row = await getPayrollPayment(paymentId);
      setPayment(row);
      setLoadError('');
      setPosting(await previewPaymentPosting(paymentId).catch(() => null));
    } catch (e) {
      setLoadError(errorWords(e, 'load that payment'));
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = useMemo(() => payment?.lines || [], [payment]);
  const pending = useMemo(() => lines.filter((l) => l.status === 'PENDING'), [lines]);
  const posted = payment?.postingStatus === 'POSTED';
  const settled = !posted && payment?.status !== 'CANCELLED';

  const settle = async (results, done) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy('settle');
    try {
      await settlePaymentLines(paymentId, results);
      notify.success(done);
      load();
      return true;
    } catch (e) {
      notify.error(errorWords(e, 'record the bank’s answer'));
      return false;
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  /* One line marked paid is still money recorded as gone: asked first, by name and amount. */
  const markOnePaid = async (l) => {
    if (busy) return;
    const ok = await confirmDialog({
      title: `Mark ${l.employeeName} paid, ${money(l.amount)}?`,
      message: 'This records that the bank paid them. A line marked paid is not paid again.',
      confirmLabel: 'Mark paid',
      tone: 'default',
    });
    if (!ok) return;
    settle([{ lineId: l.id, status: 'PAID' }], `${l.employeeName} marked paid.`);
  };

  /* Fetched and built here rather than linked, so the account numbers never
     travel in a URL somebody could paste into a chat. */
  const download = async () => {
    setBusy('advice');
    try {
      const advice = await getBankAdvice(paymentId);
      downloadCsv({
        fileName: advice.payment.number,
        columns: [
          { key: 'employeeCode', label: 'Employee Code' },
          { key: 'beneficiaryName', label: 'Beneficiary Name' },
          { key: 'accountNumber', label: 'Account Number' },
          { key: 'ifsc', label: 'IFSC' },
          { key: 'bankName', label: 'Bank' },
          { key: 'amount', label: 'Amount', value: (r) => Number(r.amount).toFixed(2) },
          { key: 'reference', label: 'Reference' },
        ],
        rows: advice.rows,
      });
      notify.success(`${advice.rows.length} ${advice.rows.length === 1 ? 'line' : 'lines'} downloaded.`);
    } catch (e) {
      notify.error(errorWords(e, 'make the bank file'));
    } finally {
      setBusy('');
    }
  };

  const post = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'Post this payment to accounts?',
      message: `${money(posting?.totalDebit || 0)} comes out of the bank and off what was owed. Only the lines marked paid are included.`,
      confirmLabel: 'Post payment',
      tone: 'default',
    });
    if (!ok) return;
    setBusy('post');
    try {
      const out = await postPayrollPayment(paymentId);
      notify.success(out.replayed ? 'This payment was already posted to accounts.' : 'Posted to accounts.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'post that payment'));
    } finally {
      setBusy('');
    }
  };

  const callOff = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: `Cancel ${payment.number}?`,
      message: `${money(payment.totalAmount)} to ${lines.length} ${lines.length === 1 ? 'person' : 'people'} goes back to being owed, and appears in the next payment.`,
      confirmLabel: 'Cancel payment',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('cancel');
    try {
      await cancelPayrollPayment(paymentId);
      notify.success('Payment cancelled.');
      load();
    } catch (e) {
      notify.error(errorWords(e, 'cancel that payment'));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <SkeletonCard lines={6} />;
  if (!payment) {
    return (
      <div className="space-y-3">
        <PageHeader
          entity="payment"
          title="Payment"
          actions={
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          }
        />
        <div className="px-5 lg:px-7 pb-8">
          <LoadFailed message={loadError || 'That payment could not be found.'} onRetry={load} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        entity="payment"
        title={payment.number}
        description={`${payment.runNumber || 'Payroll'} · ${dateWords(payment.paymentDate)} · ${
          METHODS.find((m) => m.id === payment.method)?.label || payment.method
        }${payment.ledgerAccountName ? ` from ${payment.ledgerAccountName}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {posted ? null : (
              <Button loading={busy === 'post'} disabled={(Boolean(busy) && busy !== 'post') || Boolean(posting?.problems?.length)} variant="primary" onClick={post} loading={busy === 'post'}>
                Post to accounts
              </Button>
            )}
          </div>
        }
      />

      <div className="px-5 lg:px-7 pb-8 space-y-4">
      <Figures
        label="Payment totals"
        items={[
          { label: 'In this payment', value: moneyCell(payment.totalAmount, { zero: true }), raw: payment.totalAmount },
          { label: 'Paid', value: moneyCell(payment.paidAmount, { zero: true }), raw: payment.paidAmount },
          { label: 'Rejected', value: String(payment.failedCount || 0), raw: payment.failedCount },
          { label: 'Still waiting', value: String(pending.length), raw: pending.length },
        ]}
      />

      {posted ? (
        <p className="ui-caption">
          Posted to accounts on {dayText(payment.postedAt)}. Anything that changed afterwards is a fresh payment,
          not an edit to this one.
        </p>
      ) : posting?.problems?.length ? (
        <Notice tone="warn" word="Not ready to post">
          <ul className="ui-caption mt-1 space-y-0.5">
            {posting.problems.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
        </Notice>
      ) : posting?.lines?.length ? (
        <div className="ui-list-surface overflow-hidden">
          <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            What this posts to accounts
          </div>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="ui-col-h-right">Debit</th>
                  <th scope="col" className="ui-col-h-right">Credit</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {posting.lines.map((l) => (
                  <tr key={l.ledgerAccountId}>
                    <td className="ui-col-entity">{l.ledgerName}</td>
                    <td className="ui-col-amount">{moneyCell(l.debit)}</td>
                    <td className="ui-col-amount">{moneyCell(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="ui-list-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <div className="ui-sec-head">Who is being paid</div>
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={download} disabled={busy === 'advice'}>
              <Download size={14} aria-hidden="true" /> {busy === 'advice' ? 'Making…' : 'Download bank file'}
            </button>
            {settled && pending.length ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                disabled={Boolean(busy)}
                onClick={async () => {
                  if (busy) return;
                  const total = pending.reduce((t, l) => t + (Number(l.amount) || 0), 0);
                  const ok = await confirmDialog({
                    title: `Mark ${pending.length} ${pending.length === 1 ? 'person' : 'people'} paid, ${money(total)}?`,
                    message: 'This records that the bank paid them. Mark any rejection first: a line marked paid is not paid again.',
                    confirmLabel: `Mark ${pending.length} paid`,
                    tone: 'default',
                  });
                  if (!ok) return;
                  settle(
                    pending.map((l) => ({ lineId: l.id, status: 'PAID' })),
                    `${pending.length} marked paid.`
                  );
                }}
              >
                <Check size={14} aria-hidden="true" /> Mark the rest paid
              </button>
            ) : null}
            {settled && !payment.paidCount ? (
              <Button loading={busy === 'cancel'} disabled={Boolean(busy) && busy !== 'cancel'} variant="danger" size="sm" icon={Ban} onClick={callOff} loading={busy === 'cancel'}>
                Cancel payment
              </Button>
            ) : null}
          </div>
        </div>

        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Payslip</th>
                <th scope="col">Account</th>
                <th scope="col" className="ui-col-h-right">Amount</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col">Reference</th>
                {settled ? <th scope="col" className="ui-col-h-center">Bank’s answer</th> : null}
              </tr>
            </thead>
            <tbody className="ui-rows">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="ui-col-entity" data-phone="name">
                    {l.employeeName}
                    {l.employeeCode ? <span className="ui-caption"> · {l.employeeCode}</span> : null}
                  </td>
                  <td className="ui-col-id">{l.slipNumber || '—'}</td>
                  <td className="ui-col-meta" data-phone="sub">
                    {l.bankAccountMasked ? `${l.bankAccountMasked}${l.bankIfsc ? ` · ${l.bankIfsc}` : ''}` : 'No account on file'}
                  </td>
                  <td className="ui-col-amount" data-phone="key">{moneyCell(l.amount)}</td>
                  <td data-phone="tag">
                    <ExceptionTag label={l.status === 'PAID' ? '' : LINE_STATUS[l.status]?.label || l.status} normal={LINE_STATUS[l.status]?.label} pill={LINE_STATUS[l.status]?.tone || 'ui-pill-neutral'} />
                  </td>
                  <td className="ui-col-meta">{l.failureReason || l.reference || '—'}</td>
                  {settled ? (
                    <td data-phone="act">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={`Mark ${l.employeeName} paid`}
                          disabled={Boolean(busy) || l.status === 'PAID'}
                          onClick={() => markOnePaid(l)}
                        >
                          <Check size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={`Record that the bank rejected ${l.employeeName}`}
                          disabled={Boolean(busy)}
                          onClick={() => setFailing(l)}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RejectLine
        line={failing}
        busy={busy === 'settle'}
        onCancel={() => setFailing(null)}
        onSave={async (reason) => {
          const ok = await settle([{ lineId: failing.id, status: 'FAILED', failureReason: reason }], `${failing.employeeName} recorded as rejected.`);
          if (ok) setFailing(null);
        }}
      />
      </div>
    </div>
  );
};

/**
 * Why the bank sent one back.
 *
 * Asked for rather than assumed, because the reason is what somebody uses to
 * fix the account before the next batch. "Failed" with no reason means opening
 * the bank's own file to find out. Asked in a drawer, over the list it is about.
 */
const RejectLine = ({ line, busy, onCancel, onSave }) => {
  const [reason, setReason] = useState('');
  const [forLine, setForLine] = useState(line?.id || null);
  /* A new line: a fresh reason (set while rendering, not in an effect). */
  if ((line?.id || null) !== forLine) {
    setForLine(line?.id || null);
    setReason('');
  }
  return (
    <Drawer
      open={Boolean(line)}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={line ? `The bank rejected ${line.employeeName}` : 'Record a rejection'}
      description={line ? `${money(line.amount)} stays owed and appears in the next payment.` : ''}
      dirty={Boolean(reason.trim()) && !busy}
    >
      {line ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            onSave(reason.trim());
          }}
        >
          <div>
            <label className="ui-label" htmlFor="reject-reason">What did it say?</label>
            <input
              id="reject-reason"
              className="ui-input w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Account closed, name mismatch, wrong IFSC…"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <Button loading={busy} type="submit" variant="primary" loading={busy}>Record rejection</Button>
          </div>
        </form>
      ) : null}
    </Drawer>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Ban, Check, Download, Plus, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
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
  PROCESSING: { label: 'Part answered', tone: 'ui-pill-warn' },
  COMPLETED: { label: 'Paid', tone: 'ui-pill-pos' },
  PARTIAL: { label: 'Partly paid', tone: 'ui-pill-warn' },
  FAILED: { label: 'All rejected', tone: 'ui-pill-neg' },
  CANCELLED: { label: 'Called off', tone: 'ui-pill-neutral' },
};

const LINE_STATUS = {
  PENDING: { label: 'Waiting', tone: 'ui-pill-neutral' },
  PAID: { label: 'Paid', tone: 'ui-pill-pos' },
  FAILED: { label: 'Rejected', tone: 'ui-pill-neg' },
};

const METHODS = [
  { id: 'BANK_TRANSFER', label: 'Bank transfer' },
  { id: 'CHEQUE', label: 'Cheque' },
  { id: 'CASH', label: 'Cash' },
];

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function PayrollPayments() {
  const [payments, setPayments] = useState([]);
  const [runs, setRuns] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [paymentRows, runRows, ledger] = await Promise.all([
        listPayrollPayments(),
        listPayrollRuns(),
        paymentAccounts().catch(() => []),
      ]);
      setPayments(paymentRows);
      /* Only a payroll somebody has approved can be paid, so only those are
         offered. */
      setRuns(runRows.filter((r) => ['APPROVED', 'LOCKED', 'POSTED', 'PAID'].includes(r.status)));
      setBanks(ledger);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load salary payments.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <SkeletonCard lines={6} />;

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

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Salary payments"
        description="The money going out for an approved payroll, what the bank did with each line, and the entry that clears it."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)} disabled={!runs.length}>
            <Plus size={16} aria-hidden="true" /> New payment
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

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

      {runs.length === 0 && !payments.length ? (
        <EmptyState
          title="No approved payroll to pay"
          description="A payroll is paid once it has been checked and approved. Run one under Pay Runs and approve it, and it becomes payable here."
        />
      ) : payments.length === 0 && !starting ? (
        <EmptyState
          title="Nothing has been paid yet"
          description="Start a payment and it gathers everybody on an approved payroll who is still owed, with the bank details to pay them at."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)}>
              <Plus size={16} aria-hidden="true" /> New payment
            </button>
          }
        />
      ) : payments.length ? (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Payment</th>
                  <th scope="col" className="ui-th">Payroll</th>
                  <th scope="col" className="ui-th ui-col-h-center">Date</th>
                  <th scope="col" className="ui-th ui-col-h-right">Amount</th>
                  <th scope="col" className="ui-th ui-col-h-right">Paid</th>
                  <th scope="col" className="ui-th ui-col-h-right">Rejected</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center">In books</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="ui-row-click" onClick={() => setOpenId(p.id)}>
                    <td className="ui-col-id">{p.number}</td>
                    <td className="ui-col-entity">{p.runNumber || '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{shownDate(p.paymentDate)}</td>
                    <td className="ui-col-amount">{money(p.totalAmount)}</td>
                    <td className="ui-col-amount">{money(p.paidAmount)}</td>
                    <td className="ui-col-amount">{p.failedCount || '—'}</td>
                    <td>
                      <span className={`ui-pill ${STATUS[p.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[p.status]?.label || p.status}</span>
                    </td>
                    <td>
                      <span className={`ui-pill ${p.postingStatus === 'POSTED' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {p.postingStatus === 'POSTED' ? 'Posted' : 'Not yet'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
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
      notify.error(String(err?.message || 'Could not start that payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ui-card p-4 space-y-3" onSubmit={save}>
      <div className="ui-sec-head">New payment</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="ui-label" htmlFor="pay-run">Payroll</label>
          <select id="pay-run" className="ui-select w-full" value={form.runId} onChange={(e) => set({ runId: e.target.value })} required>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} — {r.period?.name || shownDate(r.payrollDate)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="pay-date">Payment date</label>
          <input id="pay-date" type="date" className="ui-input w-full" value={form.paymentDate} onChange={(e) => set({ paymentDate: e.target.value })} required />
        </div>
        <div>
          <label className="ui-label" htmlFor="pay-method">How</label>
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
          <span className="ui-caption">The account the money leaves. Needed before this clears into the books.</span>
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

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving || !form.runId || !preview?.payable?.length}>
          {saving ? 'Starting…' : 'Start payment'}
        </button>
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

  const load = useCallback(async () => {
    try {
      const row = await getPayrollPayment(paymentId);
      setPayment(row);
      setPosting(await previewPaymentPosting(paymentId).catch(() => null));
    } catch (e) {
      notify.error(String(e?.message || 'Could not load that payment.'));
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
    setBusy('settle');
    try {
      await settlePaymentLines(paymentId, results);
      notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not record that.'));
    } finally {
      setBusy('');
    }
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
      notify.error(String(e?.message || 'Could not build the advice file.'));
    } finally {
      setBusy('');
    }
  };

  const post = async () => {
    const ok = await confirmDialog({
      title: 'Clear this payment into the books?',
      message: `${money(posting?.totalDebit || 0)} comes out of the bank and off what was owed. Only the lines marked paid are included.`,
      confirmLabel: 'Yes, post it',
      tone: 'default',
    });
    if (!ok) return;
    setBusy('post');
    try {
      const out = await postPayrollPayment(paymentId);
      notify.success(out.replayed ? 'This payment was already in the books.' : 'Posted.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not post that payment.'));
    } finally {
      setBusy('');
    }
  };

  const callOff = async () => {
    const ok = await confirmDialog({
      title: 'Call this payment off?',
      message: 'Everybody in it goes back to being owed, and appears in the next payment.',
      confirmLabel: 'Yes, call it off',
    });
    if (!ok) return;
    try {
      await cancelPayrollPayment(paymentId);
      notify.success('Called off.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not call that off.'));
    }
  };

  if (loading) return <SkeletonCard lines={6} />;
  if (!payment) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title={payment.number}
        description={`${payment.runNumber || 'Payroll'} · ${shownDate(payment.paymentDate)} · ${
          METHODS.find((m) => m.id === payment.method)?.label || payment.method
        }${payment.ledgerAccountName ? ` from ${payment.ledgerAccountName}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {posted ? null : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={post} disabled={busy === 'post' || Boolean(posting?.problems?.length)}>
                {busy === 'post' ? 'Posting…' : 'Post to books'}
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Figure label="In this payment" value={money(payment.totalAmount)} />
        <Figure label="Paid" value={money(payment.paidAmount)} />
        <Figure label="Rejected" value={String(payment.failedCount || 0)} />
        <Figure label="Still waiting" value={String(pending.length)} />
      </div>

      {posted ? (
        <p className="ui-caption">
          In the books since {new Date(payment.postedAt).toLocaleDateString('en-IN')}. Anything that changed afterwards is a fresh payment,
          not an edit to this one.
        </p>
      ) : posting?.problems?.length ? (
        <div className="ui-card p-3 space-y-1">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
            <div>
              <p className="text-sm">This cannot go into the books yet.</p>
              <ul className="ui-caption mt-1 space-y-0.5">
                {posting.problems.map((p) => (
                  <li key={p.code}>{p.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : posting?.lines?.length ? (
        <div className="ui-card overflow-hidden">
          <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            What this writes to the books
          </div>
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Account</th>
                  <th scope="col" className="ui-th ui-col-h-right">Debit</th>
                  <th scope="col" className="ui-th ui-col-h-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {posting.lines.map((l) => (
                  <tr key={l.ledgerAccountId}>
                    <td className="ui-col-entity">{l.ledgerName}</td>
                    <td className="ui-col-amount">{l.debit ? money(l.debit) : '—'}</td>
                    <td className="ui-col-amount">{l.credit ? money(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <div className="ui-sec-head">Who is being paid</div>
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={download} disabled={busy === 'advice'}>
              <Download size={14} aria-hidden="true" /> {busy === 'advice' ? 'Building…' : 'Advice file'}
            </button>
            {settled && pending.length ? (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                disabled={busy === 'settle'}
                onClick={() =>
                  settle(
                    pending.map((l) => ({ lineId: l.id, status: 'PAID' })),
                    `${pending.length} marked paid.`
                  )
                }
              >
                <Check size={14} aria-hidden="true" /> Mark the rest paid
              </button>
            ) : null}
            {settled && !payment.paidCount ? (
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={callOff}>
                <Ban size={14} aria-hidden="true" /> Call off
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto ui-table-scroll">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Employee</th>
                <th scope="col" className="ui-th">Payslip</th>
                <th scope="col" className="ui-th">Account</th>
                <th scope="col" className="ui-th ui-col-h-right">Amount</th>
                <th scope="col" className="ui-th ui-col-h-center">Status</th>
                <th scope="col" className="ui-th">Reference</th>
                {settled ? <th scope="col" className="ui-th ui-col-h-center">Mark</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="ui-col-entity">
                    {l.employeeName}
                    {l.employeeCode ? <span className="ui-caption"> · {l.employeeCode}</span> : null}
                  </td>
                  <td className="ui-col-id">{l.slipNumber || '—'}</td>
                  <td className="ui-col-meta">
                    {l.bankAccountMasked ? `${l.bankAccountMasked}${l.bankIfsc ? ` · ${l.bankIfsc}` : ''}` : 'No account on file'}
                  </td>
                  <td className="ui-col-amount">{money(l.amount)}</td>
                  <td>
                    <span className={`ui-pill ${LINE_STATUS[l.status]?.tone || 'ui-pill-neutral'}`}>{LINE_STATUS[l.status]?.label || l.status}</span>
                  </td>
                  <td className="ui-col-meta">{l.failureReason || l.reference || '—'}</td>
                  {settled ? (
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={`Mark ${l.employeeName} paid`}
                          disabled={busy === 'settle' || l.status === 'PAID'}
                          onClick={() => settle([{ lineId: l.id, status: 'PAID' }], `${l.employeeName} marked paid.`)}
                        >
                          <Check size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={`Record that the bank rejected ${l.employeeName}`}
                          disabled={busy === 'settle'}
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

      {failing ? (
        <RejectLine
          line={failing}
          onCancel={() => setFailing(null)}
          onSave={(reason) => {
            setFailing(null);
            settle([{ lineId: failing.id, status: 'FAILED', failureReason: reason }], `${failing.employeeName} recorded as rejected.`);
          }}
        />
      ) : null}
    </div>
  );
};

const Figure = ({ label, value }) => (
  <div className="ui-card p-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-0.5">{value}</div>
  </div>
);

/**
 * Why the bank sent one back.
 *
 * Asked for rather than assumed, because the reason is what somebody uses to
 * fix the account before the next batch. "Failed" with no reason means opening
 * the bank's own file to find out.
 */
const RejectLine = ({ line, onCancel, onSave }) => {
  const [reason, setReason] = useState('');
  return (
    <form
      className="ui-card p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(reason.trim());
      }}
    >
      <div className="ui-sec-head">The bank rejected {line.employeeName}</div>
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
        <span className="ui-caption">
          {money(line.amount)} stays owed and appears in the next payment.
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary">Record it</button>
      </div>
    </form>
  );
};

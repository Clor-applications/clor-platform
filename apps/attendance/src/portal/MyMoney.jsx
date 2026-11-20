import React, { useCallback, useEffect, useRef, useState } from 'react';
import MoneyInput from '@ui/components/ui/MoneyInput';
import { Camera, FileText, X } from '@ui/components/ui/lineIcons';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import SuggestInput from '@ui/components/ui/SuggestInput';

import LoadFailed from '@ui/components/ui/LoadFailed';
import { SignedOut, todayIst } from './portalApi';
import {
  addBill, answerMoney, askAdvance, askSalaryAdvance, askSkipInstalment, billData, billUrl, getMoney, previewSalaryAdvance, reopenClaim, removeBill, sendClaim, withdrawMoney,
} from './moneyApi';
import { rupees as money } from '@ui/utils/money';
import PfWithdrawSteps from './PfWithdrawSteps';
import { SKIP_ASK_HINT } from '@ui/picks/payLines';
import { RUPEE_HINT, billTooOld, oldestBillDay, tooOldText } from './round51';
import { errorWords } from '@ui/utils/errorWords';
import { RowState, kindOfPill } from './portalUi';

/**
 * Money in the employee app's Me tab (WORKFLOW-GAP-RESEARCH 4.1, 4.2):
 * what I spent for work, one bill at a time with its photo, sent together for
 * approval; advances for a trip or a purchase; and a salary advance within
 * what can come off my pay. Phone first: the camera is one tap away, amounts
 * are typed on the number pad, and what I asked shows with what was said.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return y && m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]}${y !== todayIst().slice(0, 4) ? ` ${y}` : ''}` : '';
};
const errText = (e, what) => (e instanceof SignedOut ? '' : errorWords(e, what));
/*
 * Tags only on exceptions (DESIGN.md "Status tags"): waiting on an approver, a question for me, not approved.
 * Approved and paid are expected and show no tag; going with salary, being recovered, settled, closed and
 * withdrawn are plain words.
 */
const TONE = { WITH_SALARY: 'neutral', DRAFT: 'neutral', SUBMITTED: 'warn', WAITING: 'warn', APPROVED: 'pos', PAYING: 'neutral', PAID: 'pos', SETTLED: 'neutral', CLOSED: 'neutral', REJECTED: 'neg', WITHDRAWN: 'neutral' };
const Pill = ({ row }) => {
  const pill = `ui-pill-${row.canReply ? 'warn' : TONE[row.status] || 'neutral'}`;
  return <RowState label={row.statusLabel} pill={pill} kind={kindOfPill(pill)} />;
};

export default function MyMoney({ guard }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(getMoney())
      .then((d) => { setData(d); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'load your expenses')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data) return null;
  return (
    <>
      <SpentForWork data={data} guard={guard} reload={load} />
      <Advances data={data} guard={guard} reload={load} />
      {data.salaryAdvance?.available ? <SalaryAdvance info={data.salaryAdvance} guard={guard} reload={load} /> : null}
      <PfWithdrawSteps />
    </>
  );
}

// ---------------------------------------------------------------------------
// Spent for work
// ---------------------------------------------------------------------------

const blankBill = () => ({ amount: '', spentOn: todayIst(), categoryId: '', merchant: '', note: '', companyGstin: false, supplierGstin: '', taxAmount: '', paidByCompany: false });

function SpentForWork({ data, guard, reload }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = data.draft;
  const openAdvances = data.advances.filter((a) => a.status === 'PAID' && a.open > 0);

  const send = async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await guard(sendClaim(draft.id, { title: title.trim() || undefined, advanceId: advanceId || undefined }));
      notify.success('Sent for approval.');
      setTitle('');
      setAdvanceId('');
      reload();
    } catch (e) {
      const m = errText(e, 'send it');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  const drop = async (line) => {
    if (!(await confirmDialog({ title: `Remove ${line.merchant}, ${money(line.amount)}?`, confirmLabel: 'Remove' }))) return;
    try {
      await guard(removeBill(line.id));
      reload();
    } catch (e) {
      const m = errText(e, 'remove it');
      if (m) notify.error(m);
    }
  };

  return (
    <section className="portal-sec space-y-3 ui-touch-44" aria-labelledby="spent-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="spent-h" className="ui-t-sec">Spent for work</h2>
        {!adding ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAdding(true)}><Camera size={16} aria-hidden="true" /> Add a bill</button> : null}
      </div>
      {adding ? <BillForm data={data} guard={guard} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} /> : null}

      {draft ? (
        <div className="space-y-3">
          <h3 className="ui-label">Not sent yet</h3>
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {draft.lines.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{l.merchant}</span>
                  <span className="ui-caption block">{day(l.spentOn)} · {l.category}{l.billId ? '' : ' · no bill'}{l.paidByCompany ? ' · Company card, not paid back' : ''}</span>
                  {l.overLimit ? <span className="ui-caption block ui-text-warn">Over the {money(l.overLimit)} limit for {l.category}: your approver decides.</span> : null}
                </span>
                <span className="shrink-0 text-right tabular-nums">{money(l.amount)}</span>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm shrink-0" aria-label={`Remove ${l.merchant}`} onClick={() => drop(l)}><X size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 text-sm font-semibold"><span>Total</span><span className="tabular-nums">{money(draft.claimed)}</span></div>
          <label className="block"><span className="ui-label">What for</span>
            <SuggestInput value={title} onChange={setTitle} maxLength={120} placeholder="e.g. Client visit to Mysuru" suggestions={[...new Set(data.claims.map((c) => c.title).filter((t) => t && t !== 'Spent for work'))]} />
          </label>
          {openAdvances.length ? (
            <label className="block"><span className="ui-label">Set against an advance</span>
              <select className="ui-select w-full" value={advanceId} onChange={(e) => setAdvanceId(e.target.value)}>
                <option value="">No, pay me back</option>
                {openAdvances.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.purpose} · {money(a.open)} left</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="ui-btn ui-btn-primary w-full" disabled={busy} onClick={send}>{busy ? 'Sending…' : `Send ${draft.lines.length} bill${draft.lines.length === 1 ? '' : 's'} for approval`}</button>
        </div>
      ) : !adding ? <p className="ui-caption">Take a photo of each bill as you spend. Send them together when you are ready.</p> : null}

      {data.claims.length ? (
        <div>
          <h3 className="ui-label">Sent</h3>
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {data.claims.map((c) => <ClaimRow key={c.id} claim={c} guard={guard} reload={reload} />)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Where a claim has got to, as steps with dates (owner's round 17 pick): sent,
 * decided, paid. A refused claim stops at the second step; a withdrawn or
 * draft claim shows no steps.
 */
export function ClaimSteps({ c }) {
  if (!c?.submittedAt || ['DRAFT', 'WITHDRAWN'].includes(c.status)) return null;
  const refused = c.status === 'REJECTED';
  const decided = Boolean(c.decidedAt) || ['APPROVED', 'WITH_SALARY', 'PAYING', 'PAID', 'SETTLED', 'CLOSED'].includes(c.status);
  const paid = c.status === 'PAID' || c.status === 'SETTLED' || c.status === 'CLOSED';
  const steps = [
    { key: 'sent', label: 'Sent', when: c.submittedAt, done: true },
    { key: 'decided', label: refused ? 'Not approved' : 'Approved', when: c.decidedAt, done: decided || refused, bad: refused },
    ...(refused ? [] : [{ key: 'paid', label: c.payMode === 'SALARY' ? 'With salary' : 'Paid', when: c.paidOn, done: paid }]),
  ];
  return (
    <ol className="ui-claim-steps" aria-label="Where this claim is">
      {steps.map((st) => (
        <li key={st.key} data-done={st.done ? 'true' : 'false'} data-bad={st.bad ? 'true' : undefined}>
          <span className="ui-claim-step-dot" aria-hidden="true">{st.done ? (st.bad ? '×' : '✓') : ''}</span>
          <span className="ui-claim-step-label">{st.label}{st.done ? '' : <span className="sr-only"> (not yet)</span>}</span>
          {st.done && st.when ? <span className="ui-claim-step-when tabular-nums">{day(String(st.when).slice(0, 10))}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** One bill: photo or PDF first, then the amount and what it was. */
function BillForm({ data, guard, onDone, onCancel }) {
  const [form, setForm] = useState(blankBill);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const camera = useRef(null);
  const picker = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const category = data.categories.find((c) => c.id === form.categoryId);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^(image\/|application\/pdf$)/.test(f.type)) { notify.error('A bill is a photo or a PDF.'); return; }
    if (f.type === 'application/pdf' && f.size > 5 * 1024 * 1024) { notify.error('PDFs up to 5 MB.'); return; }
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };
  const save = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (billTooOld(form.spentOn, todayIst())) { notify.error(tooOldText()); return; }
    setBusy(true);
    try {
      const bill = file ? await billData(file) : undefined;
      const out = await guard(addBill({ ...form, amount: Number(form.amount), taxAmount: form.taxAmount === '' ? undefined : Number(form.taxAmount), bill, billName: file?.name }));
      notify.success(out.overLimit ? `Added. It is over the ${money(out.overLimit)} limit; your approver decides.` : 'Bill added.');
      onDone();
    } catch (err) {
      const m = errText(err, 'add it');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3" aria-label="Add a bill">
      <div className="flex flex-wrap gap-2">
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={choose} aria-hidden="true" />
        <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" tabIndex={-1} onChange={choose} aria-hidden="true" />
        <button type="button" className="ui-btn ui-btn-secondary flex-1" onClick={() => camera.current?.click()}><Camera size={16} aria-hidden="true" /> Take a photo</button>
        <button type="button" className="ui-btn ui-btn-secondary flex-1" onClick={() => picker.current?.click()}><FileText size={16} aria-hidden="true" /> Choose a file</button>
      </div>
      {file ? (
        <div className="flex items-center gap-3 text-sm">
          {preview ? <img src={preview} alt="The bill" className="h-16 w-16 rounded-lg object-cover" /> : <FileText size={18} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setFile(null); setPreview(''); }}>Remove</button>
        </div>
      ) : <p className="ui-caption">A photo, or a PDF up to 5 MB. No bill? Add it anyway and say why in the note.</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="ui-label">Amount</span>
          <MoneyInput className="ui-input w-full tabular-nums" inputMode="decimal" required value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
        </label>
        <label className="block"><span className="ui-label">Day</span>
          <input type="date" className="ui-input w-full" required min={oldestBillDay(todayIst())} max={todayIst()} value={form.spentOn} onChange={(e) => set({ spentOn: e.target.value })} />
        </label>
      </div>
      <p className="ui-caption ui-r51-hint">{RUPEE_HINT} {tooOldText()}</p>
      <label className="block"><span className="ui-label">What it was for</span>
        <select className="ui-select w-full" required value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">Choose</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.limitPerBill ? ` (up to ${money(c.limitPerBill)})` : ''}</option>)}
        </select>
      </label>
      {(() => {
        /* Round 18 pick: the limit shows while typing, before the bill is added. */
        const cat = data.categories.find((c) => c.id === form.categoryId);
        const amt = Number(form.amount);
        if (!cat?.limitPerBill || !(amt > 0)) return null;
        const over = amt - Number(cat.limitPerBill);
        return over > 0
          ? <p className="ui-caption ui-text-warn ui-limit-line" role="status">{cat.name} limit is {money(cat.limitPerBill)} a bill · {money(over)} over. Your approver decides.</p>
          : <p className="ui-caption ui-limit-line">{cat.name} limit is {money(cat.limitPerBill)} a bill · {money(-over)} left.</p>;
      })()}
      <label className="block"><span className="ui-label">Where</span>
        <SuggestInput value={form.merchant} onChange={(v) => set({ merchant: v })} maxLength={120} required placeholder="Shop, cab, hotel" suggestions={data.merchants} />
      </label>
      {/* Round 51 pick (corpcard): a company card spend is claimed for the record and never paid back. */}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.paidByCompany} onChange={(e) => set({ paidByCompany: e.target.checked })} /> Paid with the company card</label>
      {form.paidByCompany ? <p className="ui-caption">Kept with your claim for the accounts. It is not paid back to you.</p> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.companyGstin} onChange={(e) => set({ companyGstin: e.target.checked })} /> The bill is in the company’s name, with our GSTIN</label>
      {form.companyGstin ? (
        /* Round 51 pick (gstbill B): only the GST amount on the bill is asked. */
        <label className="block"><span className="ui-label">GST on the bill</span>
          <MoneyInput className="ui-input w-full tabular-nums" inputMode="decimal" value={form.taxAmount} onChange={(e) => set({ taxAmount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
        </label>
      ) : null}
      {form.companyGstin && category?.creditBlocked ? <p className="ui-caption">GST credit is usually not available on {category.name.toLowerCase()}. Keep the bill anyway.</p> : null}
      <label className="block"><span className="ui-label">Note</span>
        <SuggestInput value={form.note} onChange={(v) => set({ note: v })} maxLength={300} placeholder="Anything your approver should know" suggestions={[]} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy}>{busy ? 'Adding…' : 'Add bill'}</button>
        <button type="button" className="ui-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** A claim I sent: what was asked, what was allowed and why, and how it is paid. */
function ClaimRow({ claim: c, guard, reload }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn, done) => {
    setBusy(true);
    try {
      await guard(fn());
      notify.success(done);
      setAnswer('');
      reload();
    } catch (e) {
      const m = errText(e, 'do that');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  const showBill = async (id) => {
    try {
      const url = await billUrl(id);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      notify.error(errText(e, 'open the bill'));
    }
  };
  const paid = c.status === 'WITH_SALARY' ? `Goes with your salary${c.payrollPeriodName ? ` for ${c.payrollPeriodName}` : ''}, once Payroll approves it` : c.status === 'PAID' ? (c.payMode === 'SALARY' ? `With your salary${c.payrollPeriodName ? ` for ${c.payrollPeriodName}` : ''}` : `Paid${c.paidOn ? ` on ${day(c.paidOn)}` : ''}${c.paidMethod ? ` by ${c.paidMethod === 'BANK' ? 'bank transfer' : c.paidMethod === 'UPI' ? 'UPI' : 'cash'}` : ''}`) : null;
  return (
    <li className="py-2.5 text-sm">
      <button type="button" className="flex w-full items-start gap-3 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{c.title}</span>
          <span className="ui-caption block">{c.number} · {c.lines.length} bill{c.lines.length === 1 ? '' : 's'}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block tabular-nums">{money(c.approved ?? c.claimed)}</span>
          <Pill row={c} />
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <ClaimSteps c={c} />
          <ul className="space-y-1.5">
            {c.lines.map((l) => (
              <li key={l.id} className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{l.merchant} <span className="ui-caption">· {day(l.spentOn)} · {l.category}{l.paidByCompany ? ' · Company card' : ''}</span></span>
                  {l.approvedAmount != null ? <span className="ui-caption block">Allowed {money(l.approvedAmount)} of {money(l.amount)}{l.cutReason ? `: ${l.cutReason}` : ''}</span> : null}
                  {l.billId ? <button type="button" className="ui-link text-xs" onClick={() => showBill(l.billId)}>See the bill</button> : null}
                </span>
                <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          {c.advanceSettled ? <p className="ui-caption tabular-nums">{money(c.advanceSettled)} set against advance {c.advanceNumber || ''}{c.toPay ? `; ${money(c.toPay)} to you` : ''}.</p> : null}
          {paid ? <p className="ui-caption">{paid}.</p> : null}
          {c.comment ? <p className="ui-muted">“{c.comment}”</p> : null}
          {c.canReply ? (
            <div className="space-y-2">
              <label className="block"><span className="ui-label">Your answer</span><SuggestInput value={answer} onChange={setAnswer} maxLength={1000} suggestions={[]} /></label>
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy || !answer.trim()} onClick={() => act(() => answerMoney('claims', c.id, answer.trim()), 'Answer sent.')}>Send answer</button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {c.canWithdraw ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Withdraw this claim?', message: 'The bills come back to “Not sent yet” to change and send again.', confirmLabel: 'Withdraw' })) act(() => withdrawMoney('claims', c.id), 'Withdrawn.'); }}>Withdraw</button> : null}
            {c.canReopen ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => act(() => reopenClaim(c.id), 'Opened again; change it and send it.')}>Change and send again</button> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Advances
// ---------------------------------------------------------------------------

function Advances({ data, guard, reload }) {
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ purpose: '', amount: '', neededBy: '' });
  const [busy, setBusy] = useState(false);
  const ask = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await guard(askAdvance({ purpose: form.purpose.trim(), amount: Number(form.amount), neededBy: form.neededBy || undefined }));
      notify.success('Asked. You will see the answer here.');
      setAsking(false);
      setForm({ purpose: '', amount: '', neededBy: '' });
      reload();
    } catch (err) {
      const m = errText(err, 'send it');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (a) => {
    if (!(await confirmDialog({ title: 'Withdraw this advance?', confirmLabel: 'Withdraw' }))) return;
    try {
      await guard(withdrawMoney('advances', a.id));
      reload();
    } catch (e) {
      const m = errText(e, 'withdraw it');
      if (m) notify.error(m);
    }
  };
  const shown = data.advances.filter((a) => !['WITHDRAWN'].includes(a.status)).slice(0, 8);
  return (
    <section className="portal-sec space-y-3 ui-touch-44" aria-labelledby="adv-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="adv-h" className="ui-t-sec">Advances</h2>
        {!asking ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAsking(true)}>Ask for an advance</button> : null}
      </div>
      {asking ? (
        <form onSubmit={ask} className="space-y-3" aria-label="Ask for an advance">
          <label className="block"><span className="ui-label">What for</span>
            <SuggestInput value={form.purpose} onChange={(v) => setForm({ ...form, purpose: v })} maxLength={200} required placeholder="Trip, site purchase" suggestions={[...new Set(data.advances.map((a) => a.purpose))]} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="ui-label">Amount</span>
              <MoneyInput className="ui-input w-full tabular-nums" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
            </label>
            <label className="block"><span className="ui-label">Needed by</span>
              <input type="date" className="ui-input w-full" min={todayIst()} value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
            </label>
          </div>
          <p className="ui-caption">Bring back the bills within 30 days. What you do not spend is given back or taken from your salary.</p>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Ask'}</button>
            <button type="button" className="ui-btn" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {shown.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {shown.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.purpose}</span>
                <span className="ui-caption block">{a.number}{a.status === 'PAID' ? ` · ${money(a.open)} left${a.settleBy ? `, bills by ${day(a.settleBy)}` : ''}` : ''}</span>
                {a.recovering ? <span className="ui-caption block tabular-nums">{money(a.recovering)} is being taken from your salary.</span> : null}
                {a.overdue ? <span className="ui-caption block ui-text-warn">Bills were due {day(a.settleBy)}. Send them, or give back what is left.</span> : null}
                {a.comment ? <span className="ui-muted block">“{a.comment}”</span> : null}
                {a.canWithdraw ? <button type="button" className="ui-link text-xs" onClick={() => withdraw(a)}>Withdraw</button> : null}
              </span>
              <span className="shrink-0 text-right"><span className="block tabular-nums">{money(a.amount)}</span><Pill row={a} /></span>
            </li>
          ))}
        </ul>
      ) : !asking ? <p className="ui-caption">Going on a trip or buying for a site? Ask before you spend.</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Salary advance
// ---------------------------------------------------------------------------

function SalaryAdvance({ info, guard, reload }) {
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState({ amount: '', months: 3, reason: '' });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const amount = Number(form.amount);
  useEffect(() => {
    if (!asking || !(amount > 0)) { setCheck(null); return undefined; }
    const t = setTimeout(() => {
      guard(previewSalaryAdvance({ amount, months: Number(form.months) })).then(setCheck).catch(() => setCheck(null));
    }, 300);
    return () => clearTimeout(t);
  }, [asking, amount, form.months, guard]);
  const ask = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await guard(askSalaryAdvance({ amount, months: Number(form.months), reason: form.reason.trim() }));
      notify.success('Asked. HR decides; you will see it here.');
      setAsking(false);
      setForm({ amount: '', months: 3, reason: '' });
      reload();
    } catch (err) {
      const m = errText(err, 'send it');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (a) => {
    if (!(await confirmDialog({ title: 'Withdraw this salary advance?', confirmLabel: 'Withdraw' }))) return;
    try {
      await guard(withdrawMoney('salary-advance', a.id));
      reload();
    } catch (e) {
      const m = errText(e, 'withdraw it');
      if (m) notify.error(m);
    }
  };
  const waiting = info.asks.some((a) => a.status === 'WAITING');
  return (
    <section className="portal-sec space-y-3 ui-touch-44" aria-labelledby="saladv-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="saladv-h" className="ui-t-sec">Salary advance</h2>
        {!asking && !waiting ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAsking(true)}>Ask for one</button> : null}
      </div>
      {info.cap?.known ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm">Can come off your pay each month</span>
          <span className="portal-figure">{money(info.cap.monthlyRoom)}</span>
        </div>
      ) : null}
      <p className="ui-caption">{info.cap?.explain}</p>
      {asking ? (
        <form onSubmit={ask} className="space-y-3" aria-label="Ask for a salary advance">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="ui-label">Amount</span>
              <MoneyInput className="ui-input w-full tabular-nums" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
            </label>
            <label className="block"><span className="ui-label">Repay over</span>
              <select className="ui-select w-full" value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}>
                {Array.from({ length: info.maxMonths || 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} month{n === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          </div>
          {check ? (
            <div className="text-sm" role="status">
              <p className="tabular-nums"><strong>{money(check.emi)}</strong> a month for {check.months} month{check.months === 1 ? '' : 's'}, from your next salary. No interest.</p>
              {!check.fits ? <p className="ui-text-warn">That is more than can come off your pay. Up to {money(check.mostYouCanAsk)} over {check.months} month{check.months === 1 ? '' : 's'}.</p> : null}
              {check.perquisite ? <p className="ui-caption">Interest-free loans above ₹2,00,000 in total can be taxed as a benefit. HR will tell you if it applies.</p> : null}
            </div>
          ) : null}
          <label className="block"><span className="ui-label">What for</span>
            <SuggestInput value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} maxLength={300} required placeholder="Only HR and your approver read this" suggestions={[]} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy || (check && !check.fits)}>{busy ? 'Sending…' : 'Ask'}</button>
            <button type="button" className="ui-btn" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {info.asks.length || info.loans.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {info.asks.filter((a) => a.status !== 'WITHDRAWN').slice(0, 5).map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{money(a.amount)} over {a.months} month{a.months === 1 ? '' : 's'}</span>
                <span className="ui-caption block tabular-nums">{money(a.emi)} a month{a.loan ? ` · ${money(a.loan.outstanding)} left to repay` : ''}</span>
                {a.comment ? <span className="ui-muted block">“{a.comment}”</span> : null}
                {a.canWithdraw ? <button type="button" className="ui-link text-xs" onClick={() => withdraw(a)}>Withdraw</button> : null}
              </span>
              <Pill row={a} />
            </li>
          ))}
        </ul>
      ) : null}
      {info.loans.length ? (
        <p className="ui-caption tabular-nums">Still to repay: {info.loans.map((l) => `${money(l.outstanding)} (${l.kind.toLowerCase()} ${l.number})`).join(', ')}.</p>
      ) : null}
      {info.loans.filter((l) => l.next).map((l) => <SkipNext key={l.id} loan={l} guard={guard} reload={reload} />)}
    </section>
  );
}

/** The next instalment of a loan, and an ask to skip it that HR decides (picks round 54). */
function SkipNext({ loan, guard, reload }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const n = loan.next;
  const send = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await guard(askSkipInstalment(n.id, reason.trim()));
      notify.success('Asked. HR decides.');
      setOpen(false);
      reload();
    } catch (err) {
      const m = errText(err, 'send it');
      if (m) notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-sm" style={{ borderTop: '1px solid rgb(var(--border))', paddingTop: '0.75rem' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block">Next instalment, {n.period}</span>
          <span className="ui-caption block">{loan.kind} {loan.number}</span>
        </span>
        <span className="tabular-nums">{money(n.amount)}</span>
      </div>
      {n.skipAsked ? (
        <p className="ui-caption" role="status">You asked to skip this one. HR decides.</p>
      ) : open ? (
        <form onSubmit={send} className="space-y-2" aria-label="Ask to skip this instalment">
          <label className="block"><span className="ui-label">Why</span>
            <SuggestInput value={reason} onChange={setReason} maxLength={300} required placeholder="Only HR reads this" suggestions={[]} aria-label="Why skip this instalment" />
          </label>
          <p className="ui-caption">{SKIP_ASK_HINT}</p>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy || reason.trim().length < 3}>{busy ? 'Sending…' : 'Ask to skip'}</button>
            <button type="button" className="ui-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="ui-link text-sm" onClick={() => setOpen(true)}>Ask to skip this month</button>
      )}
    </div>
  );
}

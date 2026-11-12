import React, { useMemo, useRef, useState } from 'react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { notify } from '@ui/components/ui/notify';
import { currentUser } from '@platform/context';

import { checkAbsences, closeAbsence, getAbsences, getNoticeCopy, holdSettlement, recordAbsconded, releaseSettlement, sendAbsenceNotice } from './api';
import { dayText, istToday } from './shared';


/* A date with its label shown, as every field here has. */
const DateField = ({ label, ...rest }) => <div><span className="ui-label">{label}</span><DatePicker label={label} {...rest} /></div>;
/**
 * Time → Absences (WORKFLOW-GAP-RESEARCH-2026-10-30 4.6): people absent working day after working day
 * with no leave and no word, found each morning. HR follows each one in a drawer, one step at a time:
 * notice 1, notice 2 after the gap, then the leaving as absconded once the second date has passed,
 * with the final settlement held if needed. Or closes it: they came back, or there is a reason.
 * Every notice keeps its date, how it went and a copy of what was sent.
 */
const STATUS = {
  OPEN: ['Found', 'warn'], NOTICE_1: ['Notice 1 sent', 'warn'], NOTICE_2: ['Notice 2 sent', 'warn'],
  ABSCONDED: ['Left (absconded)', 'neg'], RETURNED: ['Came back', 'pos'], EXPLAINED: ['Back or explained', 'pos'], IGNORED: ['Closed', 'neutral'],
};
const TABS = [['open', 'Open'], ['absconded', 'Absconded'], ['closed', 'Closed']];
const NEXT = { NOTICE_1: 'Send notice 1', NOTICE_2: 'Send notice 2', RECORD: 'Record the leaving' };
const CHANNEL = { APP: 'employee app', EMAIL: 'e-mail', POST: 'post' };
/* The India day of a moment: a hold at 05:15 IST on 31 Oct is the 31st, not the UTC 30th (QA retest of #82). */
const indiaDay = (iso) => (iso ? new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10) : '');
const plus = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function Absences({ params = {}, updateParams }) {
  const status = TABS.some(([k]) => k === params?.status) ? params.status : 'open';
  const req = useRequest(() => getAbsences(status), [status]);
  const rows = useMemo(() => req.data?.rows || [], [req.data]);
  const [openId, setOpenId] = useState(null);
  const [checking, setChecking] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status);
  const open = rows.find((r) => r.id === openId) || null;
  const canAct = Boolean(req.data?.canAct);

  const check = async () => {
    setChecking(true);
    try {
      const out = await checkAbsences();
      notify.success(out.opened ? `${out.opened} new.` : 'Nobody new.');
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Could not check.'));
    } finally {
      setChecking(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{[r.code, r.department].filter(Boolean).join(' · ')}</span></span> },
    { key: 'since', label: 'Absent since', render: (r) => <span className="tabular-nums whitespace-nowrap">{dayText(r.fromDate)}</span> },
    { key: 'days', label: 'Working days', align: 'right', render: (r) => <span className="tabular-nums">{r.days}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className="inline-flex flex-wrap gap-1"><span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0] || r.status}</span>{r.backSince ? <span className="ui-pill ui-pill-pos">Back since {dayText(r.backSince)}</span> : null}{r.hold && !r.hold.releasedAt ? <span className="ui-pill ui-pill-warn">Settlement held</span> : null}</span> },
    { key: 'next', label: 'Next', render: (r) => (r.next ? <span className="whitespace-nowrap">{NEXT[r.next.step]}{r.next.from && r.next.from > istToday() ? <span className="ui-caption block tabular-nums">from {dayText(r.next.from)}</span> : null}</span> : <span className="ui-caption">—</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Time' }]} title="Absent without leave" actions={canAct ? <button type="button" className="ui-btn ui-btn-secondary" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check now'}</button> : null} />
      <DataTable
        tabs={(
          <div ref={tabsRef} role="tablist" aria-label="Absences" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
            {TABS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={status === k} data-key={k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => updateParams?.({ status: k === 'open' ? null : k }, { push: true })}>
                {l}{k === 'open' && req.data?.counts?.open ? <span className="ui-tab-count tabular-nums" data-tone="warn">{req.data.counts.open}</span> : null}
              </button>
            ))}
            {tabIndicator}
          </div>
        )}
        label="Absences"
        columns={columns}
        rows={rows}
        total={rows.length}
        noun="people"
        loading={req.loading}
        refreshing={req.refreshing}
        onRowClick={(r) => setOpenId(r.id)}
        card={(r) => (
          <span className="block min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className={`ui-pill ui-pill-${STATUS[r.status]?.[1] || 'neutral'}`}>{STATUS[r.status]?.[0]}</span></span>
            <span className="block ui-caption tabular-nums">Since {dayText(r.fromDate)} · {r.days} working days{r.next ? ` · ${NEXT[r.next.step]}` : ''}</span>
          </span>
        )}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState title={status === 'open' ? 'Nobody is missing' : 'None here'} description={status === 'open' ? `Someone absent ${req.data?.rules?.days || 5} working days in a row with no leave shows here.` : undefined} />}
      />
      {open ? <CaseDrawer row={open} rules={req.data?.rules} canAct={canAct} onClose={() => setOpenId(null)} onChanged={() => req.reload()} /> : null}
    </div>
  );
}

function Step({ done, title, children }) {
  return (
    <li className="flex gap-3">
      <span className={`ui-attention-dot ${done ? 'is-pos' : 'is-quiet'} mt-1.5`} aria-hidden="true" />
      <span className="min-w-0 space-y-0.5"><span className="block font-medium">{title}</span>{children}</span>
    </li>
  );
}

function CaseDrawer({ row, rules, canAct, onClose, onChanged }) {
  const [mode, setMode] = useState(null);
  const [copy, setCopy] = useState(null);
  const n1 = row.notices.find((n) => n.seq === 1);
  const n2 = row.notices.find((n) => n.seq === 2);
  const t = istToday();
  const nextReady = row.next && (!row.next.from || row.next.from <= t);
  const read = async (n) => {
    try {
      setCopy(await getNoticeCopy(n.id));
    } catch (e) {
      notify.error(String(e?.message || 'Could not open it.'));
    }
  };
  const done = () => { setMode(null); onChanged(); };
  const openStep = ['OPEN', 'NOTICE_1', 'NOTICE_2'].includes(row.status);
  return (
    <Drawer open onClose={onClose} title={row.name} widthClass="w-[min(36rem,96vw)]"
      actions={canAct && !mode ? <>
        {openStep && row.next?.step !== 'RECORD' ? <button type="button" className="ui-btn ui-btn-primary" disabled={!nextReady} onClick={() => setMode('notice')}>{NEXT[row.next.step]}</button> : null}
        {row.status === 'NOTICE_2' ? <button type="button" className="ui-btn ui-btn-primary" disabled={!nextReady} onClick={() => setMode('record')}>Record the leaving</button> : null}
        {openStep ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMode('close')}>Close</button> : null}
        {row.status === 'ABSCONDED' && (!row.hold || row.hold.releasedAt) ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMode('hold')}>Hold settlement</button> : null}
        {row.hold && !row.hold.releasedAt ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMode('release')}>Release settlement</button> : null}
      </> : null}
    >
      <div className="space-y-5 text-sm">
        <dl className="grid gap-3 grid-cols-2">
          <div><dt className="ui-t-label">Absent since</dt><dd className="tabular-nums">{dayText(row.fromDate)}</dd></div>
          <div><dt className="ui-t-label">Working days</dt><dd className="tabular-nums">{row.days}</dd></div>
          {row.backSince ? <div className="col-span-2"><dt className="ui-t-label">Back at work since</dt><dd className="tabular-nums">{dayText(row.backSince)}</dd></div> : null}
          {row.phone ? <div><dt className="ui-t-label">Phone</dt><dd><a className="ui-link tabular-nums" href={`tel:${row.phone}`}>{row.phone}</a></dd></div> : null}
          <div><dt className="ui-t-label">E-mail</dt><dd className="truncate">{row.email || 'None on file'}</dd></div>
        </dl>
        <ol className="space-y-3" aria-label="What has happened">
          <Step done title={`Found ${dayText(row.createdAt)}`} />
          <Step done={Boolean(n1)} title={n1 ? `Notice 1 sent ${dayText(n1.sentAt)}` : 'Notice 1'}>
            {n1 ? <NoticeLine n={n1} onRead={() => read(n1)} /> : null}
          </Step>
          <Step done={Boolean(n2)} title={n2 ? `Notice 2 sent ${dayText(n2.sentAt)}` : 'Notice 2'}>
            {n2 ? <NoticeLine n={n2} onRead={() => read(n2)} /> : row.status === 'NOTICE_1' && row.next?.from ? <span className="ui-caption block">Can go from {dayText(row.next.from)}</span> : null}
          </Step>
          {row.status === 'ABSCONDED' ? <Step done title={`Recorded as absconded; last working day ${dayText(row.lastWorkingDay)}`} /> : null}
          {row.hold ? <Step done title={row.hold.releasedAt ? `Settlement released ${dayText(indiaDay(row.hold.releasedAt))}` : `Settlement held since ${dayText(indiaDay(row.hold.at))}`}><span className="ui-caption block">{row.hold.releasedAt ? row.hold.releaseNote : row.hold.reason}</span></Step> : null}
          {['RETURNED', 'EXPLAINED', 'IGNORED'].includes(row.status) ? <Step done title={`${STATUS[row.status][0]} ${dayText(row.closedAt)}`}><span className="ui-caption block">{row.closedNote}</span></Step> : null}
        </ol>
        {row.status === 'NOTICE_2' && row.next?.from > t ? <p className="ui-caption">The leaving can be recorded from {dayText(row.next.from)}, after the date notice 2 gave.</p> : null}
        {mode === 'notice' ? <NoticeForm row={row} rules={rules} onCancel={() => setMode(null)} onDone={done} /> : null}
        {mode === 'record' ? <RecordForm row={row} onCancel={() => setMode(null)} onDone={done} /> : null}
        {mode === 'close' ? <CloseForm row={row} onCancel={() => setMode(null)} onDone={done} /> : null}
        {mode === 'hold' || mode === 'release' ? <HoldForm row={row} release={mode === 'release'} onCancel={() => setMode(null)} onDone={done} /> : null}
        {copy ? (
          <section className="space-y-2" aria-label={`Notice ${copy.seq} as sent`}>
            <div className="flex items-center justify-between gap-2"><h3 className="ui-t-label">Notice {copy.seq} as sent</h3><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setCopy(null)}>Hide</button></div>
            <p className="whitespace-pre-wrap rounded-xl border p-3 text-sm" style={{ borderColor: 'rgb(var(--border))' }}>{copy.text}</p>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function NoticeLine({ n, onRead }) {
  return (
    <span className="ui-caption block">
      By {n.channels.map((c) => CHANNEL[c] || c).join(', ')}{n.emailTo ? ` (${n.emailTo}${n.emailStatus && n.emailStatus !== 'SENT' ? `, ${n.emailStatus.toLowerCase()}` : ''})` : ''}{n.postRef ? `, post ${n.postRef}` : ''}. Answer by {dayText(n.reportBy)}.{' '}
      <button type="button" className="ui-link" onClick={onRead}>Read it</button>
    </span>
  );
}

function FormShell({ title, busy, ready, label, onCancel, onSubmit, children }) {
  return (
    <form className="space-y-3 border-t pt-4" style={{ borderColor: 'rgb(var(--border))' }} onSubmit={onSubmit} aria-label={title}>
      <h3 className="ui-t-sec">{title}</h3>
      {children}
      <div className="flex justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !ready}>{busy ? 'Saving…' : label}</button>
      </div>
    </form>
  );
}
const useAct = (fn, onDone, ok) => {
  const [busy, setBusy] = useState(false);
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fn();
      notify.success(ok);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
};

function NoticeForm({ row, rules, onCancel, onDone }) {
  const me = currentUser?.() || null;
  const [signatory, setSignatory] = useState(me?.fullName ? `${me.fullName}, HR` : '');
  const [reportBy, setReportBy] = useState(plus(istToday(), rules?.replyDays || 7));
  const [email, setEmail] = useState(Boolean(row.email));
  const [postRef, setPostRef] = useState('');
  const seq = row.status === 'OPEN' ? 1 : 2;
  const [busy, run] = useAct(() => sendAbsenceNotice(row.id, { signatory, reportBy, email, postRef }), onDone, `Notice ${seq} sent.`);
  return (
    <FormShell title={`Notice ${seq}`} busy={busy} ready={signatory.trim().length > 2 && reportBy > istToday()} label="Send" onCancel={onCancel} onSubmit={run}>
      <div className="grid gap-3 sm:grid-cols-2">
        <DateField label="Report back or explain by" value={reportBy} min={plus(istToday(), 1)} onChange={(v) => setReportBy(v || '')} />
        <label className="block"><span className="ui-label">Signed by</span><SuggestInput value={signatory} onChange={setSignatory} suggestions={me?.fullName ? [`${me.fullName}, HR`, `${me.fullName}, Owner`] : []} maxLength={120} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={email} disabled={!row.email} onChange={(e) => setEmail(e.target.checked)} />{row.email ? `E-mail it to ${row.email}` : 'No e-mail on file'}</label>
      <label className="block"><span className="ui-label">Also posted: reference</span><SuggestInput value={postRef} onChange={setPostRef} suggestions={[]} maxLength={120} placeholder="Registered post number" /></label>
      <p className="ui-caption">It goes into {row.name}’s documents and employee app too.</p>
    </FormShell>
  );
}

function RecordForm({ row, onCancel, onDone }) {
  const [lastDay, setLastDay] = useState(plus(row.fromDate, -1));
  const [hold, setHold] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  /* Back at work since the absence: recorded only on purpose, with the reason. */
  const [confirmBack, setConfirmBack] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, run] = useAct(() => recordAbsconded(row.id, { lastWorkingDay: lastDay, hold, holdReason, ...(row.backSince ? { confirmBack, reason } : {}) }), onDone, 'Recorded.');
  return (
    <FormShell title="Record the leaving as absconded" busy={busy} ready={Boolean(lastDay) && (!hold || holdReason.trim().length > 2) && (!row.backSince || (confirmBack && reason.trim().length > 2))} label="Record" onCancel={onCancel} onSubmit={run}>
      {row.backSince ? (
        <div className="space-y-2">
          <p className="text-sm" role="alert">{row.name} has been at work since {dayText(row.backSince)}. Close the case instead, unless there is a reason to record the leaving.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={confirmBack} onChange={(e) => setConfirmBack(e.target.checked)} />Record it all the same</label>
          {confirmBack ? <label className="block"><span className="ui-label">Reason</span><SuggestInput value={reason} onChange={setReason} suggestions={['Came only to collect belongings, then left again']} maxLength={400} /></label> : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <DateField label="Last working day" value={lastDay} max={plus(istToday(), -1)} onChange={(v) => setLastDay(v || '')} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} />Hold the final settlement</label>
      {hold ? <label className="block"><span className="ui-label">Why</span><SuggestInput value={holdReason} onChange={setHoldReason} suggestions={['Company laptop not returned', 'Keys and ID card not returned', 'Advance to recover']} maxLength={300} /></label> : null}
      <p className="ui-caption">Earned wages are still due; a hold only waits until they come in or HR releases it.</p>
    </FormShell>
  );
}

function CloseForm({ row, onCancel, onDone }) {
  const [outcome, setOutcome] = useState('RETURNED');
  const [note, setNote] = useState('');
  const [busy, run] = useAct(() => closeAbsence(row.id, { outcome, note }), onDone, 'Closed.');
  return (
    <FormShell title="Close" busy={busy} ready={note.trim().length > 2} label="Close" onCancel={onCancel} onSubmit={run}>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Why">
        {[['RETURNED', 'Came back'], ['IGNORED', 'Another reason']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={outcome === k} className="ui-choice-chip" aria-pressed={outcome === k} onClick={() => setOutcome(k)}>{l}</button>)}
      </div>
      <label className="block"><span className="ui-label">Note</span><SuggestInput value={note} onChange={setNote} suggestions={outcome === 'RETURNED' ? ['Back at work, was unwell', 'Back at work, family emergency'] : ['Leave was agreed by phone', 'Working at a client site']} maxLength={500} /></label>
    </FormShell>
  );
}

function HoldForm({ row, release, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [busy, run] = useAct(() => (release ? releaseSettlement(row.id, text) : holdSettlement(row.id, text)), onDone, release ? 'Released.' : 'Held.');
  return (
    <FormShell title={release ? 'Release the settlement' : 'Hold the settlement'} busy={busy} ready={text.trim().length > 2} label={release ? 'Release' : 'Hold'} onCancel={onCancel} onSubmit={run}>
      <label className="block"><span className="ui-label">Why</span><SuggestInput value={text} onChange={setText} suggestions={release ? ['Laptop returned', 'Came in to settle'] : ['Company laptop not returned', 'Advance to recover']} maxLength={300} /></label>
    </FormShell>
  );
}

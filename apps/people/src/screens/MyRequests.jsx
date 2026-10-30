import React, { useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { formatDate } from '@ui/components/ui/DatePicker';
import FormFields from '@ui/requests/FormFields';
import { missingIn, openFile } from '@ui/requests/formFiles';
import { askForm, myFile, myForms, replyMine, withdrawMine } from '../api/requests';

/*
 * My requests (FEATURE-UI-AUDIT gap 25): the requests HR set up — an ID
 * card, a salary certificate, an asset — asked by someone who signs in to
 * CLOR, and followed here: waiting, asked for more (answer it), decided.
 * The same requests as in the employee app; opened from My profile.
 */
const REQUEST_STATUS = { WAITING: 'Waiting for approval', MORE_INFO: 'Asked for more', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn' };
const REQUEST_TONE = { WAITING: 'warn', MORE_INFO: 'warn', APPROVED: 'pos', REJECTED: 'neg', WITHDRAWN: 'neutral' };
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10)) : '');
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function MyRequests() {
  const req = useRequest(() => myForms(), []);
  const forms = req.data?.forms || [];
  const requests = req.data?.requests || [];
  const [asking, setAsking] = useState(null);
  const [open, setOpen] = useState(null);

  const columns = [
    { key: 'form', label: 'Request', always: true, render: (r) => <span className="font-medium">{r.formName}</span> },
    { key: 'what', label: 'What you wrote', render: (r) => <span className="block max-w-sm truncate">{r.lines.map((l) => l.value).join(' · ')}</span> },
    { key: 'asked', label: 'Asked', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.askedAt)}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ui-pill-${REQUEST_TONE[r.status] || 'neutral'}`}>{REQUEST_STATUS[r.status] || r.status}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'My profile' }]}
        title="My requests"
        actions={forms.length ? (
          <div className="w-full sm:w-64">
            <PopupSelect showValueSubtext={false} ariaLabel="New request" value="" placeholder="New request" onChange={(id) => { const f = forms.find((x) => x.id === id); if (f) setAsking(f); }} options={forms.map((f) => ({ value: f.id, label: f.name }))} />
          </div>
        ) : null}
      />
      <DataTable
        label="My requests"
        columns={columns}
        rows={requests}
        rowKey={(r) => r.id}
        total={requests.length}
        page={1}
        pageSize={100}
        noun="requests"
        loading={req.loading}
        refreshing={req.refreshing}
        onRowClick={(r) => setOpen(r)}
        card={(r) => (
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.formName}</span><span className={`ui-pill ui-pill-${REQUEST_TONE[r.status] || 'neutral'}`}>{REQUEST_STATUS[r.status] || r.status}</span></span>
            <span className="block truncate ui-caption">{day(r.askedAt)} · {r.lines.map((l) => l.value).join(' · ')}</span>
          </span>
        )}
        empty={req.error?.code === 'NO_EMPLOYEE_LINK' ? (
          /* An owner or HR user with no employee file of their own: said plainly, not "not found". */
          <EmptyState title="No employee file for your sign-in" description="Ask HR to put your email on your employee file; your requests then show here." />
        ) : req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : (
          <EmptyState title="You have not asked for anything yet" description={forms.length ? 'Choose a request above: HR sees it in Approvals.' : 'HR has not set up any requests yet.'} action={forms.length ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAsking(forms[0])}><Plus size={14} aria-hidden="true" /> {forms[0].name}</button> : null} />
        )}
      />
      {asking ? <AskDrawer form={asking} onClose={() => setAsking(null)} onSent={() => { setAsking(null); req.reload(); }} /> : null}
      {open ? <RequestDrawer request={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} /> : null}
    </div>
  );
}

function AskDrawer({ form, onClose, onSent }) {
  const [answers, setAnswers] = useState({});
  const [files, setFiles] = useState({});
  const [sending, setSending] = useState(false);
  const [key] = useState(newKey);
  const missing = missingIn(form.fields, answers, files);
  const dirty = Object.values(answers).some((v) => String(v || '').trim()) || Object.values(files).some(Boolean);
  const send = async (e) => {
    e.preventDefault();
    if (missing || sending) return;
    setSending(true);
    try {
      await askForm(form.id, { answers, files: Object.fromEntries(Object.entries(files).filter(([, v]) => v)) }, key);
      notify.success(`Sent. You will see the answer here; HR decides within ${form.slaDays} working days.`);
      onSent();
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    } finally {
      setSending(false);
    }
  };
  return (
    <Drawer open onClose={onClose} dirty={dirty} title={form.name} widthClass="w-[min(32rem,96vw)]"
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="ask-request" className="ui-btn ui-btn-primary" disabled={Boolean(missing) || sending} title={missing || undefined}>{sending ? 'Sending…' : 'Send'}</button>
        </>
      )}
    >
      <form id="ask-request" onSubmit={send} className="space-y-4">
        {form.description ? <p className="text-sm ui-muted">{form.description}</p> : null}
        <FormFields fields={form.fields} answers={answers} files={files} onAnswer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} onFile={(k, v) => setFiles((f) => ({ ...f, [k]: v }))} idPrefix="ask" />
      </form>
    </Drawer>
  );
}

function RequestDrawer({ request: r, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const act = async (what) => {
    if (what === 'withdraw' && !(await confirmDialog({ title: 'Withdraw this request?', message: 'Nobody will decide it. You can ask again later.', confirmLabel: 'Withdraw' }))) return;
    setBusy(what);
    try {
      if (what === 'reply') await replyMine(r.id, note.trim());
      else await withdrawMine(r.id);
      notify.success(what === 'reply' ? 'Answer sent.' : 'Withdrawn.');
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const open = ['WAITING', 'MORE_INFO'].includes(r.status);
  return (
    <Drawer open onClose={onClose} dirty={Boolean(note.trim())} title={r.formName} widthClass="w-[min(32rem,96vw)]"
      actions={open ? (
        <>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => act('withdraw')}>Withdraw</button>
          {r.status === 'MORE_INFO' ? <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(busy) || !note.trim()} onClick={() => act('reply')}>{busy === 'reply' ? 'Sending…' : 'Send answer'}</button> : null}
        </>
      ) : null}
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="ui-t-label">Status</dt><dd><span className={`ui-pill ui-pill-${REQUEST_TONE[r.status] || 'neutral'}`}>{REQUEST_STATUS[r.status] || r.status}</span></dd></div>
          <div><dt className="ui-t-label">Asked</dt><dd className="tabular-nums">{day(r.askedAt)}{r.dueAt && open ? ` · due ${day(r.dueAt)}` : ''}</dd></div>
          {r.lines.map((l) => <div key={l.label} className="sm:col-span-2"><dt className="ui-t-label">{l.label}</dt><dd>{l.value}</dd></div>)}
          {r.said ? <div className="sm:col-span-2"><dt className="ui-t-label">{r.status === 'MORE_INFO' ? 'HR asks' : 'Note'}</dt><dd>{r.said}</dd></div> : null}
          {r.replies.map((x) => <div key={x.at} className="sm:col-span-2"><dt className="ui-t-label">You answered, {day(x.at)}</dt><dd>{x.note}</dd></div>)}
        </dl>
        {r.files.length ? (
          <ul className="space-y-1">
            {r.files.map((f) => <li key={f.fileId}><button type="button" className="ui-link" onClick={() => myFile(f.fileId).then(openFile).catch((e) => notify.error(String(e?.message || 'Could not open.')))}>{f.name}</button></li>)}
          </ul>
        ) : null}
        {r.status === 'MORE_INFO' ? (
          <label className="block">
            <span className="ui-label">Your answer</span>
            <textarea className="ui-input w-full" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        ) : null}
      </div>
    </Drawer>
  );
}

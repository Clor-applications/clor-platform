import React, { useMemo, useState } from 'react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';

import { getConsentHistory, getNightWork, recordNightConsent } from './api';
import { dayText, istToday } from './shared';


/* A date with its label shown, as every field here has. */
const DateField = ({ label, ...rest }) => <div><span className="ui-label">{label}</span><DatePicker label={label} {...rest} /></div>;
/**
 * Time → Night work (WORKFLOW-GAP-RESEARCH-2026-10-30 B19): every woman on the books, her consent to
 * work at night (OSH Code 2020 s.43) and since when, and her night shifts in the next 30 days; anyone
 * on a night shift without consent first. HR records consent given or withdrawn with the signed copy;
 * the woman can also give or withdraw it herself in the employee app. CLOR refuses to give a night
 * shift to a woman without consent wherever shifts are given.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(file);
});

const consentPill = (c) => (!c ? <span className="ui-pill ui-pill-neutral">None on file</span> : c.status === 'GIVEN' ? <span className="ui-pill ui-pill-pos">Given {dayText(c.onDate)}</span> : <span className="ui-pill ui-pill-neg">Withdrawn {dayText(c.onDate)}</span>);

export default function NightWork() {
  const req = useRequest(() => getNightWork(), []);
  const d = req.data;
  const rows = useMemo(() => d?.rows || [], [d]);
  const [open, setOpen] = useState(null);

  const columns = [
    { key: 'name', label: 'Employee', always: true, render: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        {r.problem ? <span className="ui-attention-dot is-neg" aria-label="Night shift without consent" /> : null}
        <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate ui-caption">{[r.code, r.department].filter(Boolean).join(' · ')}</span></span>
      </span>
    ) },
    { key: 'consent', label: 'Consent', render: (r) => <span className="inline-flex flex-wrap items-center gap-1.5">{consentPill(r.consent)}{r.consent?.byApp ? <span className="ui-caption">in the app</span> : null}</span> },
    { key: 'copy', label: 'Signed copy', render: (r) => <span className="ui-caption">{r.consent?.documentId ? 'In documents' : '—'}</span> },
    { key: 'nights', label: 'Night shifts, next 30 days', align: 'right', render: (r) => <span className="tabular-nums">{r.nightDays || '—'}{r.firstNightDay ? <span className="ui-caption block">from {dayText(r.firstNightDay)}</span> : null}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Time' }]} title="Night work" />
      {d ? (
        <p className="text-sm tabular-nums">
          Night is {d.night.words}{!d.night.on ? ' (the check is off)' : d.night.mode === 'WARN' ? ' (shifts are saved with a warning)' : ''} · {d.totals.women} {d.totals.women === 1 ? 'woman' : 'women'} · {d.totals.given} with consent
          {d.totals.problems ? <> · <span className="font-medium">{d.totals.problems} on night shifts without consent</span></> : null}
          {d.totals.noGender && !d.unknownGender?.length ? <span className="ui-caption block">{d.totals.noGender} {d.totals.noGender === 1 ? 'person has' : 'people have'} no gender on file and are not checked.</span> : null}
        </p>
      ) : null}
      {d?.unknownGender?.length ? (
        <ul className="ui-attention" aria-label="Gender not recorded">
          {d.unknownGender.map((u) => (
            <li key={u.employeeId}><span className="ui-attention-dot is-warn" aria-hidden="true" /><span>{u.name} works {u.nightDays} night {u.nightDays === 1 ? 'shift' : 'shifts'} from {dayText(u.firstNightDay)} with no gender recorded. Record it on the employee file so consent can be checked.</span></li>
          ))}
        </ul>
      ) : null}
      <DataTable
        label="Night work"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.employeeId}
        total={rows.length}
        noun="women"
        loading={req.loading}
        refreshing={req.refreshing}
        onRowClick={(r) => setOpen(r)}
        card={(r) => (
          <span className="block min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span>{consentPill(r.consent)}</span>
            <span className="block ui-caption tabular-nums">{r.nightDays ? `${r.nightDays} night shifts in the next 30 days` : 'No night shifts ahead'}</span>
          </span>
        )}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : <EmptyState title="No women on the books" description="Consent is asked of women whose gender is recorded as female." />}
      />
      {open ? <ConsentDrawer row={open} canEdit={Boolean(d?.canEdit)} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} /> : null}
    </div>
  );
}

function ConsentDrawer({ row, canEdit, onClose, onDone }) {
  /* History and notes are HR's: a manager sees the status only. */
  const history = useRequest(() => (canEdit ? getConsentHistory(row.employeeId) : Promise.resolve(null)), [row.employeeId, canEdit]);
  const [status, setStatus] = useState(row.consent?.status === 'GIVEN' ? 'WITHDRAWN' : 'GIVEN');
  const [onDate, setOnDate] = useState(istToday());
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f) => {
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) { notify.error('Files up to 5 MB.'); return null; }
    try {
      setFile({ name: f.name, mime: f.type, data: await readFile(f) });
    } catch (e) {
      notify.error(String(e?.message || 'Could not read the file.'));
    }
    return null;
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await recordNightConsent(row.employeeId, { status, onDate, note, file });
      notify.success(status === 'GIVEN' ? 'Consent recorded.' : 'Withdrawal recorded.');
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} dirty={Boolean(note || file)} title={row.name} widthClass="w-[min(32rem,96vw)]"
      footer={canEdit ? <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="consent-form" className="ui-btn ui-btn-primary" disabled={busy || !onDate}>{busy ? 'Saving…' : status === 'GIVEN' ? 'Record consent' : 'Record withdrawal'}</button></div> : null}
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">{consentPill(row.consent)}{row.nightDays ? <span className="ui-caption tabular-nums">{row.nightDays} night shifts in the next 30 days</span> : null}</div>
        {canEdit ? (
          <form id="consent-form" onSubmit={save} className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Consent">
              {[['GIVEN', 'Given'], ['WITHDRAWN', 'Withdrawn']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={status === k} aria-pressed={status === k} className="ui-choice-chip" onClick={() => setStatus(k)}>{l}</button>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2"><DateField label="On" value={onDate} max={istToday()} onChange={(v) => setOnDate(v || '')} /></div>
            <label className="block"><span className="ui-label">Signed copy</span><input type="file" className="ui-input w-full" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => pick(e.target.files?.[0] || null)} /></label>
            <label className="block"><span className="ui-label">Note</span><SuggestInput value={note} onChange={setNote} suggestions={['Signed consent form', 'Transport arranged both ways', 'Asked to move to day shifts']} maxLength={500} /></label>
          </form>
        ) : null}
        {canEdit ? <section aria-label="History">
          <h3 className="ui-t-label mb-2">History</h3>
          {history.data?.length ? (
            <ul className="space-y-2">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3">
                  <span><span className="font-medium">{h.status === 'GIVEN' ? 'Given' : 'Withdrawn'}</span> {dayText(h.onDate)}{h.byApp ? <span className="ui-caption"> · in the app</span> : null}{h.note ? <span className="ui-caption block">{h.note}</span> : null}</span>
                  {h.documentId ? <span className="ui-caption whitespace-nowrap">Signed copy</span> : null}
                </li>
              ))}
            </ul>
          ) : <p className="ui-caption">{history.loading ? 'Loading…' : 'Nothing recorded yet.'}</p>}
        </section> : null}
      </div>
    </Drawer>
  );
}

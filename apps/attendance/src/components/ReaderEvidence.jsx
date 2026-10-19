import React, { useEffect, useState } from 'react';

import { getReaderCertification, getReaderCompatibility, getReaderEvents } from '../api/attendance';

/**
 * A reader against CLOR's certification tests, from what CLOR has seen of it,
 * and the originals of what it sent (kept 13 months): punches, lines that
 * could not be read, and events set aside as not punches.
 */
const TONE = { CERTIFIED: 'ui-pill-pos', COMPATIBLE: 'ui-pill-pos', INTEGRATION_AVAILABLE: 'ui-pill-neutral', UNDER_INVESTIGATION: 'ui-pill-warn', UNSUPPORTED: 'ui-pill-neg' };
const MARK = { PASS: { label: 'Seen', cls: 'ui-pill-pos' }, OPEN: { label: 'Not yet', cls: 'ui-pill-neutral' }, NA: { label: 'Does not apply', cls: 'ui-pill-outline' } };
const OUTCOME = { NEW: 'Punch', REJECTED: 'Could not be read', IGNORED: 'Set aside' };

export function SupportPill({ support }) {
  if (!support) return null;
  return <span className={`ui-pill ${TONE[support.support] || 'ui-pill-neutral'}`} title={support.note || ''}>{support.label}</span>;
}

export default function ReaderEvidence({ device }) {
  const [cert, setCert] = useState(null);
  const [events, setEvents] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [openCert, setOpenCert] = useState(false);
  const [openEvents, setOpenEvents] = useState(false);
  useEffect(() => {
    if (!openCert || cert) return;
    getReaderCertification(device.id).then(setCert).catch(() => setCert({ tests: [] }));
  }, [openCert, cert, device.id]);
  useEffect(() => {
    if (!openEvents) return undefined;
    let live = true;
    getReaderEvents(device.id, outcome).then((r) => live && setEvents(r)).catch(() => live && setEvents({ counts: {}, events: [] }));
    return () => { live = false; };
  }, [openEvents, outcome, device.id]);

  return (
    <div className="space-y-2">
      <details className="ui-card p-3 text-sm" onToggle={(e) => setOpenCert(e.currentTarget.open)}>
        <summary className="cursor-pointer font-medium">Certification checklist</summary>
        {!cert ? <p className="ui-caption mt-2">Checking…</p> : (
          <div className="mt-2 space-y-2">
            {cert.label ? <p><SupportPill support={cert} /> <span className="ui-caption">{cert.note}</span></p> : null}
            <ul className="divide-y">
              {cert.tests.map((t) => (
                <li key={t.id} className="flex items-start gap-2 py-1.5">
                  <span className="ui-mono ui-caption w-10 shrink-0">{t.id}</span>
                  <span className="min-w-0 flex-1"><span className="block">{t.label}</span><span className="ui-caption">{t.evidence}</span></span>
                  <span className={`ui-pill shrink-0 ${MARK[t.status]?.cls}`}>{MARK[t.status]?.label}</span>
                </li>
              ))}
            </ul>
            <p className="ui-caption">“Not yet” means CLOR has not seen the evidence, not that it failed. A model and firmware become Certified once every test applies and is seen.</p>
          </div>
        )}
      </details>
      <details className="ui-card p-3 text-sm" onToggle={(e) => setOpenEvents(e.currentTarget.open)}>
        <summary className="cursor-pointer font-medium">What it sent</summary>
        {!events ? <p className="ui-caption mt-2">Loading…</p> : (
          <div className="mt-2 space-y-2">
            <div role="tablist" className="flex flex-wrap gap-1">
              {['', 'NEW', 'REJECTED', 'IGNORED'].map((o) => (
                <button key={o || 'all'} type="button" role="tab" aria-selected={outcome === o} className="ui-segment" onClick={() => setOutcome(o)}>
                  {o ? OUTCOME[o] : 'All'} {o ? events.counts?.[o] || 0 : Object.values(events.counts || {}).reduce((a, b) => a + b, 0)}
                </button>
              ))}
            </div>
            {events.events.length ? (
              <ul className="divide-y">
                {events.events.map((e) => (
                  <li key={e.id} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`ui-pill ${e.outcome === 'NEW' ? 'ui-pill-pos' : e.outcome === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-neutral'}`}>{OUTCOME[e.outcome] || e.outcome}</span>
                      <span className="ui-caption">{new Date(e.receivedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</span>
                      {e.pin ? <span className="ui-caption">ID <span className="ui-mono">{e.pin}</span>{e.localTime ? ` · ${e.localTime}` : ''}</span> : null}
                      {e.reason ? <span className="ui-caption">· {e.reason}</span> : null}
                    </div>
                    <code className="ui-mono block truncate text-xs" title={e.original}>{e.original}</code>
                  </li>
                ))}
              </ul>
            ) : <p className="ui-caption">Nothing here yet.</p>}
            <p className="ui-caption">Kept 13 months as sent, with a fingerprint (SHA-256) and the reader parser version. Repeats are counted, not kept.</p>
          </div>
        )}
      </details>
    </div>
  );
}

/** Which readers work with CLOR, and how far — said per model as it is certified, never by logo. */
export function ReaderCompatibility() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || data) return;
    getReaderCompatibility().then(setData).catch(() => setData({ catalogue: [] }));
  }, [open, data]);
  return (
    <details className="ui-card p-4 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="ui-t-sec cursor-pointer select-none">Which readers work</summary>
      {!data ? <p className="ui-caption mt-2">Loading…</p> : (
        <div className="mt-3 space-y-2">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead><tr><th className="ui-th">Reader</th><th className="ui-th">Support</th><th className="ui-th">How</th><th className="ui-th">Note</th></tr></thead>
              <tbody>
                {data.catalogue.map((c) => (
                  <tr key={c.name}>
                    <td className="ui-col-entity">{c.name}</td>
                    <td><SupportPill support={c} /></td>
                    <td>{c.route}</td>
                    <td className="ui-caption">{c.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ui-caption">Certified: a model and firmware passed every test. Compatible: in use, exact models being recorded. Integration available: built from the vendor’s documents, not yet tested on hardware. Under investigation: being checked with a customer. A reader not listed can often still send a file or post to a URL.</p>
        </div>
      )}
    </details>
  );
}

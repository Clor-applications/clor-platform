import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { downloadCsv } from '@ui/utils/csv';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { orgUsers } from '../api/desk';

/**
 * Privacy (PRV-03, 06, 07): who viewed what; how long each kind of data is
 * kept, with the legal minimum and a legal hold; the deletion review, where
 * nothing is erased without a person; and auditor access to named evidence,
 * time-limited, every open on the report.
 */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/privacy`;
const opts = { skipWarehouseHeader: true };
const VIEWS = [['access', 'Who viewed what'], ['retention', 'Retention'], ['review', 'Deletion review'], ['auditors', 'Auditor access']];
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const err = (e, fallback) => notify.error(String(e?.message || fallback));

export default function Privacy() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [view, setView] = useState('access');
  return (
    <div className="space-y-4">
      <PageHeader title="Privacy" description="Who opened statutory details, confidential files and auditor evidence; how long each kind of data is kept; and what is past its time, waiting for a person to decide." />
      <div role="tablist" aria-label="View" className="flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-pill ${view === k ? 'ui-pill-info' : ''}`} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === 'access' ? <AccessReport /> : null}
      {view === 'retention' ? <Retention canEdit={allowed('PEOPLE::Privacy::EDIT')} /> : null}
      {view === 'review' ? <DeletionReview canKeep={allowed('PEOPLE::Privacy::EDIT')} canErase={allowed('PEOPLE::Privacy::DELETE')} /> : null}
      {view === 'auditors' ? <Auditors canEdit={allowed('PEOPLE::Privacy::EDIT')} /> : null}
    </div>
  );
}

function AccessReport() {
  const [from, setFrom] = useState(`${todayIst().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIst());
  const [what, setWhat] = useState('');
  const [data, setData] = useState(null);
  useEffect(() => {
    apiFetch(`${base()}/access?from=${from}&to=${to}${what ? `&what=${what}` : ''}`, opts).then(setData).catch((e) => { err(e, 'Could not load.'); setData({ views: [], privateCaseOpens: [], kinds: {} }); });
  }, [from, to, what]);
  const exportCsv = () => downloadCsv({
    fileName: `access-${from}-to-${to}`,
    columns: [{ key: 'at', label: 'When', value: (r) => when(r.at) }, { key: 'user', label: 'Who' }, { key: 'label', label: 'What' }, { key: 'employee', label: 'Person' }, { key: 'detail', label: 'Detail' }],
    rows: data?.views || [],
  });
  return (
    <section className="space-y-3" aria-label="Who viewed what">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="block"><span className="ui-label">What</span>
          <select className="ui-select" value={what} onChange={(e) => setWhat(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(data?.kinds || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button type="button" className="ui-btn ui-btn-secondary ml-auto" onClick={exportCsv} disabled={!data?.views?.length}>Export CSV</button>
      </div>
      {!data ? <SkeletonCard lines={5} /> : !data.views.length ? <EmptyState title="No views in this period" /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">When</th><th className="py-1.5 font-medium">Who</th><th className="py-1.5 font-medium">What</th><th className="py-1.5 font-medium">Person</th><th className="py-1.5 font-medium">Detail</th></tr></thead>
          <tbody className="divide-y">
            {data.views.map((v) => (
              <tr key={v.id}>
                <td className="py-2 pr-2 tabular-nums whitespace-nowrap">{when(v.at)}</td>
                <td className="py-2 pr-2">{v.user}</td>
                <td className="py-2 pr-2">{v.label}</td>
                <td className="py-2 pr-2">{v.employee || ''}</td>
                <td className="py-2">{v.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.privateCaseOpens?.length ? (
        <div className="space-y-1">
          <h3 className="ui-t-sec">Private cases</h3>
          <p className="ui-caption">Counts only. Which case, and what was in it, stays inside the case for its members.</p>
          <ul className="divide-y text-sm">
            {data.privateCaseOpens.map((c) => <li key={`${c.userId}-${c.what}`} className="flex justify-between gap-3 py-1.5"><span>{c.user} · {c.what === 'EVIDENCE' ? 'opened evidence' : 'opened a case'}</span><span className="tabular-nums">{c.count}</span></li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Retention({ canEdit }) {
  const [rows, setRows] = useState(null);
  const [hold, setHold] = useState(null);
  const load = useCallback(() => apiFetch(`${base()}/retention`, opts).then((r) => setRows(r?.schedule || [])).catch((e) => err(e, 'Could not load.')), []);
  useEffect(() => { load(); }, [load]);
  const save = async (r, body, ok) => {
    try {
      await apiFetch(`${base()}/retention/${r.dataType}`, { ...opts, method: 'PUT', body });
      notify.success(ok);
      setHold(null);
      load();
    } catch (e) {
      err(e, 'Not saved.');
      load();
    }
  };
  if (!rows) return <SkeletonCard lines={5} />;
  return (
    <section className="space-y-3" aria-label="Retention">
      <table className="w-full text-sm">
        <thead><tr className="ui-caption text-left"><th className="py-1.5 pr-4 font-medium">Data</th><th className="py-1.5 pr-4 font-medium text-right whitespace-nowrap">Keep (years)</th><th className="py-1.5 pr-4 font-medium">Counted from</th><th className="py-1.5 font-medium whitespace-nowrap">Legal hold</th></tr></thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.dataType}>
              <td className="py-2 pr-4"><span className="font-medium">{r.label}</span><span className="ui-caption block">{r.basis}{r.erasable ? '' : ' Never erased by a request.'}</span></td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                {canEdit ? <input type="number" min={r.minYears} max={30} className="ui-input w-20 text-right tabular-nums" defaultValue={r.keepYears} aria-label={`${r.label} years`}
                  onBlur={(e) => Number(e.target.value) !== r.keepYears && save(r, { keepYears: Number(e.target.value) }, `${r.label}: kept ${e.target.value} years.`)} /> : <span className="tabular-nums">{r.keepYears}</span>}
                <span className="ui-caption block">at least {r.minYears}</span>
              </td>
              <td className="py-2 pr-4 min-w-[9rem]">{r.after}</td>
              <td className="py-2 whitespace-nowrap">
                {r.legalHold ? <span className="ui-pill ui-pill-warn">On hold</span> : <span className="ui-muted">None</span>}
                {r.legalHold && r.holdReason ? <span className="ui-caption block">{r.holdReason}</span> : null}
                {canEdit ? (r.legalHold
                  ? <button type="button" className="ui-link block text-sm" onClick={() => save(r, { legalHold: false }, 'Hold lifted.')}>Lift hold</button>
                  : <button type="button" className="ui-link block text-sm" onClick={() => setHold({ row: r, reason: '' })}>Put on hold</button>) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hold ? (
        <Drawer open onClose={() => setHold(null)} title={`Hold: ${hold.row.label}`} description="Nothing of this kind is erased while the hold stands, whatever the review says."
          actions={<button type="button" className="ui-btn ui-btn-primary" disabled={!hold.reason.trim()} onClick={() => save(hold.row, { legalHold: true, holdReason: hold.reason }, 'On hold.')}>Put on hold</button>}>
          <label className="block"><span className="ui-label">Why *</span><input className="ui-input w-full" maxLength={300} value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} placeholder="Labour court case, inspection notice, Board inquiry" /></label>
        </Drawer>
      ) : null}
    </section>
  );
}

function DeletionReview({ canKeep, canErase }) {
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => apiFetch(`${base()}/deletion-review?status=${status}`, opts).then(setData).catch((e) => err(e, 'Could not load.')), [status]);
  useEffect(() => { load(); }, [load]);
  const decide = async (decision) => {
    try {
      await apiFetch(`${base()}/deletion-review/${encodeURIComponent(open.row.id)}`, { ...opts, method: 'POST', body: { decision, note: open.note } });
      notify.success(decision === 'APPROVE' ? `${open.row.label}: personal data erased. Pay and statutory records stay for their legal period.` : 'Kept, with your reason.');
      setOpen(null);
      load();
    } catch (e) {
      err(e, 'Not done.');
    }
  };
  return (
    <section className="space-y-3" aria-label="Deletion review">
      <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
        {[['PENDING', 'Waiting'], ['APPROVED', 'Erased'], ['KEPT', 'Kept']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={status === k} className={`ui-pill ${status === k ? 'ui-pill-info' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
      </div>
      {data?.hold ? <p className="text-sm"><span className="ui-pill ui-pill-warn">On hold</span> {data.hold}. Nothing is erased until the hold is lifted under Retention.</p> : null}
      {!data ? <SkeletonCard lines={4} /> : !data.rows.length ? <EmptyState title={status === 'PENDING' ? 'Nothing past its time' : 'None'} /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Former employee</th><th className="py-1.5 font-medium">Past retention since</th><th className="py-1.5 font-medium">Decision</th></tr></thead>
          <tbody className="divide-y">
            {data.rows.map((r) => (
              <tr key={r.id} className={r.status === 'PENDING' ? 'cursor-pointer' : ''} onClick={() => r.status === 'PENDING' && (canKeep || canErase) && setOpen({ row: r, note: '' })}>
                <td className="py-2 pr-2 font-medium">{r.label}</td>
                <td className="py-2 pr-2 tabular-nums">{r.dueSince}</td>
                <td className="py-2">{r.status === 'PENDING' ? <span className="ui-muted">Waiting</span> : <>{r.status === 'APPROVED' ? 'Erased' : 'Kept'}{r.decidedAt ? ` on ${new Date(r.decidedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}{r.note ? <span className="ui-caption block">{r.note}</span> : null}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? (
        <Drawer open onClose={() => setOpen(null)} title={open.row.label} description={`Personal details past retention since ${open.row.dueSince}.`}
          actions={<>
            {canKeep ? <button type="button" className="ui-btn ui-btn-secondary" disabled={!open.note.trim()} onClick={() => decide('KEEP')}>Keep</button> : null}
            {canErase ? <button type="button" className="ui-btn ui-btn-danger" disabled={Boolean(data?.hold)} onClick={() => decide('APPROVE')}>Erase personal data</button> : null}
          </>}>
          <div className="space-y-3 text-sm">
            <p>Erasing replaces the name, contacts, address, photo, notes and documents with blanks. The employee code, dates of employment, pay, TDS, PF and attendance records stay for their legal period. It cannot be undone.</p>
            <label className="block"><span className="ui-label">Note {canKeep ? '(needed to keep)' : ''}</span><input className="ui-input w-full" maxLength={500} value={open.note} onChange={(e) => setOpen({ ...open, note: e.target.value })} /></label>
          </div>
        </Drawer>
      ) : null}
    </section>
  );
}

function Auditors({ canEdit }) {
  const [grants, setGrants] = useState(null);
  const [draft, setDraft] = useState(null);
  const [users, setUsers] = useState([]);
  const [docs, setDocs] = useState([]);
  const load = useCallback(() => apiFetch(`${base()}/auditor-grants`, opts).then((r) => setGrants(r?.grants || [])).catch((e) => err(e, 'Could not load.')), []);
  useEffect(() => { load(); }, [load]);
  const start = async () => {
    setDraft({ userId: '', purpose: '', documentIds: [], untilAt: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) });
    orgUsers().then(setUsers);
    apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/documents`, opts).then((r) => setDocs(r?.documents || [])).catch(() => setDocs([]));
  };
  const save = async () => {
    try {
      await apiFetch(`${base()}/auditor-grants`, { ...opts, method: 'POST', body: { ...draft, untilAt: `${draft.untilAt}T23:59:59+05:30` } });
      notify.success('Access given. It ends on its own.');
      setDraft(null);
      load();
    } catch (e) {
      err(e, 'Not saved.');
    }
  };
  const revoke = async (g) => {
    try {
      await apiFetch(`${base()}/auditor-grants/${encodeURIComponent(g.id)}/revoke`, { ...opts, method: 'POST', body: {} });
      notify.success('Access ended.');
      load();
    } catch (e) {
      err(e, 'Not changed.');
    }
  };
  const name = (id) => { const u = users.find((x) => x.id === id); return u ? u.fullName || u.email : 'Auditor'; };
  useEffect(() => { orgUsers().then(setUsers); }, []);
  const toggleDoc = (id) => setDraft((d) => ({ ...d, documentIds: d.documentIds.includes(id) ? d.documentIds.filter((x) => x !== id) : [...d.documentIds, id] }));
  return (
    <section className="space-y-3" aria-label="Auditor access">
      <div className="flex items-center justify-between gap-2">
        <p className="ui-caption">An auditor sees only the documents named here, until the end date, and every open shows under Who viewed what. They never see a person's profile.</p>
        {canEdit ? <button type="button" className="ui-btn ui-btn-secondary" onClick={start}>Give access</button> : null}
      </div>
      {!grants ? <SkeletonCard lines={3} /> : !grants.length ? <EmptyState title="No auditor access given" /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Auditor</th><th className="py-1.5 font-medium">For</th><th className="py-1.5 font-medium text-right">Documents</th><th className="py-1.5 font-medium">Until</th><th className="py-1.5 font-medium">State</th></tr></thead>
          <tbody className="divide-y">
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="py-2 pr-2">{name(g.userId)}</td>
                <td className="py-2 pr-2">{g.purpose}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{(g.documentIds || []).length}</td>
                <td className="py-2 pr-2 tabular-nums">{when(g.untilAt)}</td>
                <td className="py-2">{g.live ? <span className="ui-pill ui-pill-pos">Open</span> : <span className="ui-muted">{g.revokedAt ? 'Ended early' : 'Ended'}</span>}{g.live && canEdit ? <button type="button" className="ui-link block text-sm" onClick={() => revoke(g)}>End now</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft ? (
        <Drawer open onClose={() => setDraft(null)} title="Give auditor access" description="Read-only, named documents only, up to 90 days."
          actions={<button type="button" className="ui-btn ui-btn-primary" disabled={!draft.userId || !draft.purpose.trim() || !draft.documentIds.length} onClick={save}>Give access</button>}>
          <div className="space-y-3 text-sm">
            <label className="block"><span className="ui-label">Auditor *</span>
              <select className="ui-select w-full" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })}>
                <option value="">Choose a user with the External auditor role</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email}</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">For *</span><input className="ui-input w-full" maxLength={300} value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder="Statutory audit FY 2025-26" /></label>
            <label className="block"><span className="ui-label">Until *</span><input type="date" className="ui-input" min={todayIst()} value={draft.untilAt} onChange={(e) => setDraft({ ...draft, untilAt: e.target.value })} /></label>
            <fieldset>
              <legend className="ui-label">Documents * <span className="ui-caption">{draft.documentIds.length} chosen</span></legend>
              <ul className="max-h-72 overflow-y-auto divide-y">
                {docs.map((d) => <li key={d.id}><label className="flex items-center gap-2 py-1.5"><input type="checkbox" className="ui-checkbox" checked={draft.documentIds.includes(d.id)} onChange={() => toggleDoc(d.id)} />{d.title}<span className="ui-caption">{d.kind?.replaceAll('_', ' ').toLowerCase()}</span></label></li>)}
              </ul>
            </fieldset>
          </div>
        </Drawer>
      ) : null}
    </section>
  );
}

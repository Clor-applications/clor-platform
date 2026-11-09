import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Pencil } from '@ui/components/ui/lineIcons';

import { memberDirectory } from '@platform/admin/account';
import { getArchiveReasons } from '@platform/admin/admin';
import { formatMoney } from '@ui/utils/money';
import { ICON, WsDrawer, productIcon } from './wsKit';

/**
 * A company at a glance (redesign W-R5): opened from its name in Companies.
 * Overview (its registration and figures), People (who is in it, with their
 * roles and the apps those open) and Apps (what is on, and how many people
 * open each). Everything is the server's: /account/overview for the company,
 * /account/members/directory for the people.
 */
const ROLE = { OWNER: 'Owner', ADMIN: 'Administrator', BILLING_ADMIN: 'Billing admin', MEMBER: 'Member' };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** The people of one company, from the account directory: each with their place in it. */
export function peopleOf(directory, orgId) {
  return (directory?.members || [])
    .map((m) => ({ ...m, here: (m.companies || []).find((c) => c.orgId === orgId) }))
    .filter((m) => m.here)
    .sort((a, b) => Number(b.here.isAdmin) - Number(a.here.isAdmin) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

export default function CompanyDetail({ company, current, catalog = [], subscriptions = null, onClose, onSwitch, onEdit, onArchive, onReactivate }) {
  const [tab, setTab] = useState('overview');
  /* Archive (server: services/companyArchive.ts): reason first, then read-only until reactivated. */
  const [archiving, setArchiving] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const startArchive = async () => {
    setArchiveError('');
    setArchiving({ reason: '', note: '', reasons: [] });
    try {
      const r = await getArchiveReasons();
      setArchiving((a) => (a ? { ...a, reasons: r.reasons || [] } : a));
    } catch (e) {
      setArchiveError(String(e?.message || 'Could not load the reasons.'));
    }
  };
  const runArchive = async (fn) => {
    setArchiveBusy(true);
    setArchiveError('');
    try {
      await fn();
      setArchiving(null);
    } catch (e) {
      setArchiveError(String(e?.message || 'Not done.'));
    } finally {
      setArchiveBusy(false);
    }
  };
  const [directory, setDirectory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!company) return;
    memberDirectory()
      .then(setDirectory)
      .catch((e) => setError(String(e?.message || 'Could not load the people.')));
  }, [company]);

  const people = useMemo(() => peopleOf(directory, company?.orgId), [directory, company]);
  const admins = people.filter((p) => p.here.isAdmin);
  const noApp = people.filter((p) => !p.here.isAdmin && !(p.here.apps || []).length);
  const apps = catalog.filter((a) => !a.platform && a.available !== false);
  const opens = (id) => people.filter((p) => p.here.isAdmin || (p.here.apps || []).includes(id)).length;
  const money = (v) => formatMoney(Number(v || 0));

  const tabs = [
    ['overview', 'Overview'],
    ['people', `People${directory ? ` (${people.length})` : ''}`],
    ['apps', 'Apps'],
  ];

  return (
    <WsDrawer
      open={Boolean(company)}
      onClose={onClose}
      title={company?.name || ''}
      description={[company?.state, company?.gstin || 'No GSTIN'].filter(Boolean).join(' · ')}
      widthClass="w-[min(44rem,94vw)]"
      actions={
        company ? (
          current ? (
            onEdit ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={onEdit}>
                <Pencil size={16} aria-hidden="true" /> Edit company profile
              </button>
            ) : null
          ) : onSwitch ? (
            <button type="button" className="ws-btn ws-btn--primary" onClick={onSwitch}>
              <ArrowRightLeft size={16} aria-hidden="true" /> Switch to this company
            </button>
          ) : null
        ) : null
      }
    >
      {company ? (
        <>
          <div className="ws-tabs" role="tablist" aria-label={`${company.name} details`}>
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className="ws-tab" onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

          {tab === 'overview' ? (
            <div className="grid gap-5">
              <dl className="ws-facts">
                <div><dt>Status</dt><dd>{current ? <span className="ws-pill ws-pill--role">You are here</span> : company.gstin ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill">Setup incomplete</span>}</dd></div>
                <div><dt>State</dt><dd>{company.state || '—'}</dd></div>
                <div><dt>GSTIN</dt><dd className="ui-mono">{company.gstin || '—'}</dd></div>
                <div><dt>PAN</dt><dd className="ui-mono">{company.pan || '—'}</dd></div>
                <div><dt>Added</dt><dd>{day(company.since)}</dd></div>
                <div><dt>Members</dt><dd className="num">{company.people}</dd></div>
                <div><dt>Invoices</dt><dd className="num">{company.invoices}</dd></div>
                <div><dt>Billed</dt><dd className="num">{money(company.billed)}</dd></div>
                <div><dt>Outstanding</dt><dd className="num">{money(company.outstanding)}</dd></div>
              </dl>

              <section className="grid gap-2" aria-labelledby="cd-access">
                <h3 id="cd-access" className="ws-subhead">Access</h3>
                {directory === null && !error ? (
                  <p className="ws-card-blurb">Loading…</p>
                ) : (
                  <ul className="ws-list">
                    <li>
                      <div className="ws-item">
                        <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.secure size={14} /></span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{admins.length} {admins.length === 1 ? 'administrator' : 'administrators'}</span>
                          <span className="ws-item-sub">{admins.map((a) => a.name || a.email).join(', ') || 'None'}</span>
                        </span>
                      </div>
                    </li>
                    <li>
                      <div className="ws-item">
                        <span className={`ws-tile ws-tile--sm${noApp.length ? ' ws-tile--warn' : ''}`} aria-hidden="true"><ICON.person size={14} /></span>
                        <span className="ws-item-text">
                          <span className="ws-item-title">{noApp.length} without an app</span>
                          <span className="ws-item-sub">{noApp.length ? noApp.map((a) => a.name || a.email).join(', ') : 'Everyone can open something'}</span>
                        </span>
                      </div>
                    </li>
                  </ul>
                )}
              </section>

              {onArchive || onReactivate ? (
                <section className="grid gap-2" aria-labelledby="cd-archive" style={{ borderTop: '1px solid rgb(var(--ws-line))', paddingTop: 16 }}>
                  <h3 id="cd-archive" className="ws-panel-title">{company.archived ? 'Archived' : 'Stopped trading?'}</h3>
                  {archiveError ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{archiveError}</p> : null}
                  {company.archived ? (
                    <>
                      <p className="ws-card-blurb">
                        Archived {day(company.archived.at)}{company.archived.reasonLabel ? ` · ${company.archived.reasonLabel}` : ''}{company.archived.note ? ` — ${company.archived.note}` : ''}. Its records can be read and exported; nothing new can be added.
                      </p>
                      {onReactivate ? (
                        <div><button type="button" className="ws-btn ws-btn--quiet" disabled={archiveBusy} onClick={() => runArchive(() => onReactivate(company.orgId))}>{archiveBusy ? 'Reactivating…' : 'Reactivate company'}</button></div>
                      ) : null}
                    </>
                  ) : archiving ? (
                    <form
                      className="grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        runArchive(() => onArchive(company.orgId, { reason: archiving.reason, note: archiving.note || null }));
                      }}
                    >
                      <p className="ws-card-blurb">Archiving keeps every record, read-only, and frees its place on your plan. Reminders, recurring invoices and connections stop. You can reactivate it any time.</p>
                      <label className="grid gap-1">
                        <span className="text-sm font-medium">Why</span>
                        <select className="ui-select w-full" required value={archiving.reason} onChange={(e) => setArchiving((a) => ({ ...a, reason: e.target.value }))}>
                          <option value="">Choose a reason</option>
                          {archiving.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="text-sm font-medium">Note <span className="ui-caption">· optional</span></span>
                        <textarea className="ui-input w-full" rows={2} maxLength={1000} value={archiving.note} onChange={(e) => setArchiving((a) => ({ ...a, note: e.target.value }))} />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setArchiving(null)} disabled={archiveBusy}>Cancel</button>
                        <button type="submit" className="ws-btn ws-btn--primary" disabled={archiveBusy || !archiving.reason}>{archiveBusy ? 'Archiving…' : 'Archive company'}</button>
                      </div>
                    </form>
                  ) : onArchive ? (
                    <>
                      <p className="ws-card-blurb">Archive it instead of deleting: records stay for GST and audits, read-only, and you can bring it back.</p>
                      <div><button type="button" className="ws-btn ws-btn--quiet" onClick={startArchive}>Archive company</button></div>
                    </>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === 'people' ? (
            directory === null && !error ? (
              <p className="ws-card-blurb">Loading…</p>
            ) : people.length ? (
              <div className="ws-table-wrap">
                <table className="ws-table">
                  <caption className="sr-only">People in {company.name}</caption>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role here</th>
                      <th>Apps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.userId}>
                        <td>
                          <span className="grid">
                            <strong style={{ fontWeight: 600 }}>{p.name || p.email}</strong>
                            <span className="ws-item-sub">{ROLE[p.accountRole] || p.accountRole}{p.status === 'SUSPENDED' ? ' · suspended' : ''}</span>
                          </span>
                        </td>
                        <td>{p.here.isAdmin ? <span className="ws-pill ws-pill--role">Administrator</span> : (p.here.roles || []).join(', ') || <span className="ws-item-sub">No role</span>}</td>
                        <td>
                          {p.here.isAdmin ? 'All' : (p.here.apps || []).length ? (
                            <span className="inline-flex gap-1">
                              {p.here.apps.map((id) => {
                                const Icon = productIcon(id);
                                const a = catalog.find((x) => x.id === id);
                                return <span key={id} title={a?.name || id}><Icon size={18} /></span>;
                              })}
                            </span>
                          ) : <span className="ws-item-sub">None</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ws-empty"><p>Nobody in this company yet.</p></div>
            )
          ) : null}

          {tab === 'apps' ? (
            <ul className="ws-list">
              {apps.map((a) => {
                const Icon = productIcon(a.id);
                /* The shell's list for the company in use; the server's (/account/overview) for any other. */
                const known = subscriptions || company.apps || null;
                const on = known ? known.includes(a.id) : null;
                const n = directory ? opens(a.id) : null;
                return (
                  <li key={a.id}>
                    <div className="ws-item">
                      <span className="ws-tile ws-tile--sm" aria-hidden="true"><Icon size={16} /></span>
                      <span className="ws-item-text">
                        <span className="ws-item-title">{a.name}</span>
                        <span className="ws-item-sub">{n === null ? '' : `${n} ${n === 1 ? 'person opens' : 'people open'} it`}</span>
                      </span>
                      {on === null ? null : on ? <span className="ws-pill ws-pill--ok">On</span> : <span className="ws-pill">Off</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </WsDrawer>
  );
}

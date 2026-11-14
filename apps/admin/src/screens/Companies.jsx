import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, MoreHorizontal, Plus, Search } from '@ui/components/ui/lineIcons';

import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { isValidGstin } from '@ui/utils/gstin';
import { archiveCompany, getAccountOverview, reactivateCompany } from '@platform/admin/admin';
import { AppMark, PageHead, WsDrawer } from './wsKit';
import CompanyDetail from './CompanyDetail';
import './workspace.css';
import './ws-home.css';

/**
 * Workspace → Company → Companies (redesign W-R5).
 *
 * The legal entities in this account: a directory with search, sorting and
 * paging, the plan's company allowance, and adding a company. Figures are the
 * server's (/account/overview); "setup incomplete" means what it says — no
 * GSTIN on record — not a guess. Adding a company goes through the same
 * server route as signup (plan limit and quota lock included); it switches to
 * the new company when made.
 */
const STATES = [...new Set(Object.values(GST_STATE_BY_CODE))].sort((a, b) => a.localeCompare(b));
const PAGE = 20;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Search, sort and page the directory rows. */
export function companyRows(companies, { q = '', sort = 'name', dir = 1, page = 0 }) {
  const needle = q.trim().toLowerCase();
  const rows = companies
    .filter((c) => !needle || `${c.name} ${c.gstin} ${c.state}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      return (typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''))) * dir;
    });
  return { total: rows.length, rows: rows.slice(page * PAGE, page * PAGE + PAGE), pages: Math.max(1, Math.ceil(rows.length / PAGE)) };
}

export default function Companies({ tenant, addCompany, switchCompany, companies: tenants = [], catalog = [], openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ q: '', sort: 'name', dir: 1, page: 0 });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState('');

  const load = useCallback(() => {
    getAccountOverview()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => {
        setData({ companies: [], plan: null, usage: null });
        setError(String(e?.message || 'Could not load the companies.'));
      });
  }, []);
  useEffect(load, [load]);

  const companies = data?.companies || [];
  const list = useMemo(() => companyRows(companies, view), [companies, view]);
  const limit = data?.plan?.limits?.maxCompanies ?? null;
  const incomplete = companies.filter((c) => !c.gstin && !c.archived).length;
  /* Archived companies are kept for their records and do not take a place on the plan. */
  const activeCount = companies.filter((c) => !c.archived).length;
  const archivedCount = companies.length - activeCount;
  const atLimit = limit != null && activeCount >= limit;
  const sortBy = (key) => setView((v) => ({ ...v, sort: key, dir: v.sort === key ? -v.dir : 1, page: 0 }));
  const th = (key, label, num) => (
    <th className={num ? 'num' : undefined} aria-sort={view.sort === key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(key)}>
        {label} <ArrowDownUp size={12} aria-hidden="true" />
      </button>
    </th>
  );

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Company', 'Companies']} scope="account"
          title="Companies"
          description={`Legal entities in ${data?.account?.name || 'your account'}. Each company has its own books, payroll and GST registrations.`}
          actions={
            addCompany ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setAdding(true)} disabled={atLimit} title={atLimit ? 'Your plan’s company allowance is used up.' : undefined}>
                <Plus size={16} aria-hidden="true" /> Add company
              </button>
            ) : null
          }
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <div className="ws-filters" role="search">
          <label className="ws-search">
            <span className="sr-only">Search companies</span>
            <Search size={16} aria-hidden="true" />
            <input className="ui-input" value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value, page: 0 }))} placeholder="Search by name, GSTIN or state" />
          </label>
          {data ? (
            <span className="ws-list-meta">
              {activeCount} {activeCount === 1 ? 'company' : 'companies'}
              {limit != null ? ` · ${limit} allowed on your plan` : ''}
              {archivedCount ? ` · ${archivedCount} archived` : ''}
              {incomplete ? ` · ${incomplete} without a GSTIN` : ''}
            </span>
          ) : null}
        </div>

        {data === null ? (
          <p className="ws-card-blurb">Loading companies…</p>
        ) : list.total === 0 ? (
          <div className="ws-setup">
            <p className="ws-card-blurb">{companies.length ? 'No company matches this search.' : 'No company yet. Add the first one.'}</p>
          </div>
        ) : (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Companies in this account</caption>
              <thead>
                <tr>
                  {th('name', 'Company')}
                  <th>GSTIN</th>
                  <th>PAN</th>
                  <th>Apps</th>
                  {th('people', 'Members', true)}
                  <th>Status</th>
                  <th className="ws-th-menu"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => {
                  const current = c.orgId === tenant?.id;
                  const sub = [c.state, c.since ? `added ${day(c.since)}` : '', c.invoices ? `${c.invoices} invoice${c.invoices === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
                  return (
                    <tr key={c.orgId}>
                      <td>
                        <button type="button" className="ws-name-link" onClick={() => setOpenId(c.orgId)}>{c.name}</button>
                        {sub ? <span className="ws-cell-sub">{sub}</span> : null}
                      </td>
                      <td className="ws-mono">{c.gstin || <span className="ws-missing">Not added</span>}</td>
                      <td className="ws-mono">{c.pan || '—'}</td>
                      <td>
                        <span className="ws-appmarks">
                          {(c.apps || []).length ? c.apps.map((id) => <AppMark key={id} app={id} size={20} />) : <span className="ws-cell-sub">None</span>}
                        </span>
                      </td>
                      <td className="num">{c.people}</td>
                      <td>
                        {c.archived ? (
                          <span className="ws-pill ws-pill--neutral">Archived</span>
                        ) : c.gstin ? (
                          <span className="ws-pill ws-pill--ok">Active</span>
                        ) : (
                          <span className="ws-pill ws-pill--warn">Needs GSTIN</span>
                        )}
                        {current ? <span className="ws-cell-sub">You are here</span> : null}
                      </td>
                      <td className="ws-td-menu">
                        {!current && switchCompany ? (
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => switchCompany(c.orgId)}>
                            Switch to
                          </button>
                        ) : (
                          <button type="button" className="ws-rowmenu" aria-label={`Open ${c.name}`} title="Open" onClick={() => setOpenId(c.orgId)}>
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {list.pages > 1 ? (
          <nav className="flex items-center gap-2" aria-label="Pages">
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page === 0} onClick={() => setView((v) => ({ ...v, page: v.page - 1 }))}>Previous</button>
            <span className="ws-head-meta">Page {view.page + 1} of {list.pages}</span>
            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={view.page + 1 >= list.pages} onClick={() => setView((v) => ({ ...v, page: v.page + 1 }))}>Next</button>
          </nav>
        ) : null}
      </div>

      <CompanyDetail
        key={openId || 'none'}
        company={companies.find((c) => c.orgId === openId) || null}
        current={openId === tenant?.id}
        catalog={catalog}
        subscriptions={tenants.find((t) => t.id === openId)?.subscriptions || (openId === tenant?.id ? tenant?.subscriptions : null) || null}
        onClose={() => setOpenId('')}
        onSwitch={switchCompany ? () => { switchCompany(openId); setOpenId(''); } : null}
        onEdit={openScreen ? () => { setOpenId(''); openScreen('company'); } : null}
        onArchive={async (orgId, body) => { await archiveCompany(orgId, body); load(); }}
        onReactivate={async (orgId) => { await reactivateCompany(orgId); load(); }}
      />

      <WsDrawer open={adding} onClose={() => setAdding(false)} title="Add a company">
        <AddCompanyForm
          onCancel={() => setAdding(false)}
          onAdd={async (body) => {
            await addCompany(body);
            setAdding(false);
          }}
        />
      </WsDrawer>
    </div>
  );
}

/** Only what a company needs to exist: its name, its state (it decides CGST/SGST or IGST) and, if registered, its GSTIN. App settings come later, in each app. */
export function AddCompanyForm({ onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const gstinClean = gstin.trim().toUpperCase();
  const gstinState = gstinClean.length >= 2 ? getGstStateFromGstin(gstinClean) : '';
  const gstinBad = gstinClean && !isValidGstin(gstinClean);
  const effectiveState = gstinState || state;

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError('Give the company its name.');
        if (gstinBad) return setError('Enter a valid 15-character GSTIN.');
        if (!effectiveState) return setError('Choose the state the company is registered in.');
        setBusy(true);
        setError('');
        try {
          await onAdd({ name: name.trim(), gstin: gstinClean || undefined, state: effectiveState });
        } catch (err) {
          setError(String(err?.message || 'Could not add the company.'));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <div className="grid gap-1">
        <label htmlFor="co-name" className="text-sm font-medium">Company name <span aria-hidden="true">*</span></label>
        <input id="co-name" className="ui-input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="organization" />
      </div>
      <div className="grid gap-1">
        <label htmlFor="co-gstin" className="text-sm font-medium">GSTIN <span className="ui-caption">(optional)</span></label>
        <input id="co-gstin" className="ui-input ui-mono" value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} aria-invalid={gstinBad || undefined} aria-describedby="co-gstin-help" spellCheck={false} />
        <span id="co-gstin-help" className="ui-caption">{gstinState ? `Registered in ${gstinState}.` : 'Leave it empty if the company is not registered yet.'}</span>
      </div>
      {gstinState ? null : (
        <div className="grid gap-1">
          <label htmlFor="co-state" className="text-sm font-medium">State <span aria-hidden="true">*</span></label>
          <select id="co-state" className="ui-select" value={state} onChange={(e) => setState(e.target.value)} required>
            <option value="">Choose…</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className="ws-btn ws-btn--primary" disabled={busy}>{busy ? 'Adding…' : 'Add company'}</button>
        <button type="button" className="ws-btn ws-btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Plus, Search } from 'lucide-react';

import Drawer from '@ui/components/ui/Drawer';
import { GST_STATE_BY_CODE, getGstStateFromGstin } from '@ui/utils/gst';
import { getAccountOverview } from '@platform/admin/admin';
import { ICON, PageHead, Stat } from './wsKit';
import './workspace.css';

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

export default function Companies({ tenant, addCompany, switchCompany }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ q: '', sort: 'name', dir: 1, page: 0 });
  const [adding, setAdding] = useState(false);

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
  const incomplete = companies.filter((c) => !c.gstin).length;
  const atLimit = limit != null && companies.length >= limit;
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
          crumbs={['Company', 'Companies']}
          title="Companies"
          description="The legal entities in this account. Each keeps its own books, people and payroll."
          actions={
            addCompany ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setAdding(true)} disabled={atLimit} title={atLimit ? 'Your plan’s company allowance is used up.' : undefined}>
                <Plus size={16} aria-hidden="true" /> Add company
              </button>
            ) : null
          }
        />

        {data ? (
          <div className="ws-stats">
            <Stat icon={ICON.companies} label="Companies" value={companies.length} note={limit != null ? `${limit} allowed on your plan` : 'no limit on your plan'} />
            <Stat icon={ICON.warning} tone={incomplete ? 'warn' : null} label="Setup incomplete" value={incomplete} note={incomplete ? 'No GSTIN on record' : 'Every company has its GSTIN'} />
            <Stat icon={ICON.people} label="People across companies" value={companies.reduce((n, c) => n + (c.people || 0), 0)} note="Memberships, counted per company" />
          </div>
        ) : null}

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}

        <div className="flex flex-wrap gap-2 items-center" role="search">
          <label className="relative flex-1 min-w-[14rem]" style={{ maxWidth: 420 }}>
            <span className="sr-only">Search companies</span>
            <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
            <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value, page: 0 }))} placeholder="Search by name, GSTIN or state" />
          </label>
          <span className="ws-head-meta">{list.total} {list.total === 1 ? 'company' : 'companies'}</span>
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
                  <th>Status</th>
                  {th('state', 'State')}
                  <th>GSTIN</th>
                  {th('people', 'Members', true)}
                  {th('invoices', 'Invoices', true)}
                  {th('since', 'Added')}
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => {
                  const current = c.orgId === tenant?.id;
                  return (
                    <tr key={c.orgId}>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <span className="ws-tile ws-tile--sm" aria-hidden="true"><ICON.company size={14} /></span>
                          <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                        </span>
                      </td>
                      <td>{current ? <span className="ws-pill ws-pill--role">You are here</span> : c.gstin ? <span className="ws-pill ws-pill--ok">Active</span> : <span className="ws-pill">Setup incomplete</span>}</td>
                      <td>{c.state || '—'}</td>
                      <td className="ui-mono" style={{ fontSize: '0.8125rem' }}>{c.gstin || '—'}</td>
                      <td className="num">{c.people}</td>
                      <td className="num">{c.invoices}</td>
                      <td>{day(c.since)}</td>
                      <td className="num">
                        {!current && switchCompany ? (
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => switchCompany(c.orgId)}>
                            Switch to
                          </button>
                        ) : null}
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

      <Drawer open={adding} onClose={() => setAdding(false)} title="Add a company" description="A new legal entity in this account, with its own books, people and payroll.">
        {/* The drawer renders outside the page; this carries the Workspace colours into it. */}
        <div className="ws ws-drawer">
          <AddCompanyForm
            onCancel={() => setAdding(false)}
            onAdd={async (body) => {
              await addCompany(body);
              setAdding(false);
            }}
          />
        </div>
      </Drawer>
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
  const gstinBad = gstinClean && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstinClean);
  const effectiveState = gstinState || state;

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError('Give the company its name.');
        if (gstinBad) return setError('That GSTIN does not look right: 15 characters, e.g. 29ABCDE1234F1Z5.');
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

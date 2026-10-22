import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, KeyRound, MapPin, Printer, Smartphone, UserCheck } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getPortalAccess, issuePortalCodes, listGeofences, resetPortalPassword, setPortalAccess } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const STATE = {
  off: { label: 'Not set up', pill: 'ui-pill-neutral' },
  pending: { label: 'Code given', pill: 'ui-pill-warn' },
  active: { label: 'Active', pill: 'ui-pill-pos' },
  paused: { label: 'Switched off', pill: 'ui-pill-neutral' },
};
const TABS = [
  { value: 'active', label: 'Active', tone: 'paid' },
  { value: 'pending', label: 'Code given', tone: 'partial' },
  { value: 'off', label: 'Not set up', tone: 'draft' },
  { value: 'paused', label: 'Switched off', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];
const siteOf = (p) => (p.mobilePunch ? `${p.phonePunchMode === 'FIELD' ? 'Field: anywhere' : p.geofenceName ? `Only ${p.geofenceName}` : 'Any site'}${p.selfieRequired ? ' · selfie' : ''}` : '—');
const stateOf = (e) => (!e.portalEnabled ? (e.activated ? 'paused' : 'off') : e.activated ? 'active' : e.codePending ? 'pending' : 'off');
const COLUMNS = {
  employee: (p) => p.name,
  code: (p) => p.code,
  portal: (p) => STATE[stateOf(p)].label,
  site: siteOf,
};

/* What Export writes: the rows on screen, as shown (AT-01). */
const EXPORT_COLUMNS = [
  { key: 'code', label: 'Employee ID' },
  { key: 'name', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'portal', label: 'Portal', value: (r) => STATE[stateOf(r)]?.label || '' },
  { key: 'mobilePunch', label: 'Phone punch', value: (r) => (r.mobilePunch ? 'On' : 'Off') },
  { key: 'site', label: 'Where they may punch', value: (r) => siteOf(r) },
  { key: 'email', label: 'E-mail' },
  { key: 'portalPasswordSetAt', label: 'Signed up', value: (r) => (r.portalPasswordSetAt ? String(r.portalPasswordSetAt).slice(0, 10) : '') },
];

/**
 * Who may use the employee portal and punch from a phone (ClorTime's portal
 * invite). HR gives a one-time activation code; the employee chooses their own
 * password, which nobody else ever sees. A forgotten password is a new code.
 */
export default function PortalAccess() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [fences, setFences] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [email, setEmail] = useState(false);
  const [issued, setIssued] = useState(null);
  const load = useCallback(() => {
    getPortalAccess().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
    listGeofences().then((f) => setFences(f.filter((x) => x.isActive))).catch(() => setFences([]));
  }, [load]);

  const all = useMemo(() => data?.employees || [], [data]);
  const counts = useMemo(() => {
    const c = { '': all.length };
    for (const p of all) c[stateOf(p)] = (c[stateOf(p)] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => all.filter((p) => !status || stateOf(p) === status), [all, status]);
  const search = useListSearch(inTab, ['name', 'code', 'department']);
  const filters = useColumnFilters();
  const shown = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(shown, perPage, page);
  useResetPage(setPage, [status, search.query]);
  const figures = useMemo(() => ({
    active: counts.active || 0,
    pending: counts.pending || 0,
    phone: all.filter((p) => p.mobilePunch).length,
    field: all.filter((p) => p.mobilePunch && p.phonePunchMode === 'FIELD').length,
  }), [all, counts]);
  const ids = [...picked];
  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = shown.length > 0 && shown.every((p) => picked.has(p.id));

  const give = async () => {
    try {
      const r = await issuePortalCodes(ids, email);
      setIssued(r);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(String(e?.message || 'No codes given.'));
    }
  };
  const change = async (body, done) => {
    try {
      const r = await setPortalAccess({ employeeIds: ids, ...body });
      notify.success(`${r.updated} ${done}.`);
      setPicked(new Set());
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    }
  };
  const reset = async (p) => {
    if (!(await confirmDialog({ title: `Forget ${p.name}'s portal password?`, message: 'They are signed out everywhere and need a new activation code to get back in.', confirmLabel: 'Forget password' }))) return;
    try {
      await resetPortalPassword(p.id);
      notify.success(`Give ${p.name} a new activation code.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
  };
  /* This web app's own address: the portal is served wherever HR is looking from. Company code filled in. */
  const portalUrl = data ? `${window.location.origin}/#/portal?c=${encodeURIComponent(data.company.code)}` : '';
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify.success('Copied.'), () => undefined);

  return (
    <DocumentListShell
      entity="employee"
      title="Employee Portal Access"
      moreItems={[exportMenuItem('Export')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Employee portal access', fileName: 'Portal access', label: 'person/people', columns: EXPORT_COLUMNS, rows: shown });
      }}
      description="Employees sign in to the portal with the company code, their employee code and a password they choose."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search people' }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" disabled={!picked.size} onClick={give} title={picked.size ? undefined : 'Pick people in the list first'}>
          <KeyRound size={16} aria-hidden="true" /> Give activation codes{picked.size ? ` (${picked.size})` : ''}
        </button>
      }
      cards={[
        { label: 'Active', value: figures.active, count: true, tone: 'paid', Icon: UserCheck, onSelect: () => setStatus('active') },
        { label: 'Code given', value: figures.pending, count: true, tone: 'partial', Icon: KeyRound, onSelect: () => setStatus('pending') },
        { label: 'Phone punch on', value: figures.phone, count: true, tone: 'sent', Icon: Smartphone },
        { label: 'Field: anywhere', value: figures.field, count: true, tone: 'outstanding', Icon: MapPin },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Portal state"
      tabsExtras={
        data ? (
          <>
            <span className="text-sm">Company code <span className="ui-mono font-semibold">{data.company.code}</span></span>
            <a className="ui-btn ui-btn-ghost ui-btn-sm" href={portalUrl} target="_blank" rel="noreferrer" title="On a phone, open the address and use “Add to Home screen” — it then opens like an app.">
              <ExternalLink size={14} aria-hidden="true" /> Open portal
            </a>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => copy(portalUrl)}><Copy size={14} aria-hidden="true" /> Copy address</button>
          </>
        ) : null
      }
      above={
        picked.size ? (
          <div className="ui-bulkbar" role="region" aria-label="Change access for the people picked">
            <span className="text-sm"><strong className="tabular-nums">{picked.size}</strong> picked</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={give}><KeyRound size={14} aria-hidden="true" /> Give activation codes</button>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> and e-mail them
            </label>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => change({ mobilePunch: true }, 'may punch from their phone')}><Smartphone size={14} aria-hidden="true" /> Allow phone punch</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => change({ mobilePunch: false }, 'may no longer punch from their phone')}>Stop phone punch</button>
            <select
              className="ui-select ui-ctl-compact !w-auto"
              value=""
              aria-label="Site for phone punches"
              onChange={(e) => e.target.value && change({ geofenceId: e.target.value === 'ANY' ? null : e.target.value }, e.target.value === 'ANY' ? 'may punch at any site' : 'tied to that site')}
            >
              <option value="">Site…</option>
              <option value="ANY">Any site</option>
              {fences.map((f) => <option key={f.id} value={f.id}>Only {f.name}</option>)}
            </select>
            <select
              className="ui-select ui-ctl-compact !w-auto"
              value=""
              aria-label="Where phone punches are accepted"
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'SITE') change({ phonePunchMode: 'SITE' }, 'may punch only inside a work site');
                else if (v === 'FIELD') change({ phonePunchMode: 'FIELD', mobilePunch: true }, 'may punch from anywhere (field), recorded with the address');
                else if (v === 'SELFIE') change({ selfieRequired: true }, 'must add a selfie to each phone punch');
                else if (v === 'NOSELFIE') change({ selfieRequired: false }, 'may punch without a selfie');
              }}
            >
              <option value="">Mode…</option>
              <option value="SITE">Work sites only</option>
              <option value="FIELD">Field: anywhere</option>
              <option value="SELFIE">Selfie required</option>
              <option value="NOSELFIE">Selfie optional</option>
            </select>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => change({ portalEnabled: false }, 'switched off')}>Switch portal off</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
            {!fences.length ? <p className="ui-caption w-full">No work sites yet — phone punches need one, except for people set to Field. Add them under Work sites.</p> : null}
            <p className="ui-caption w-full">Field: for sales, service and site staff. A phone punch is accepted anywhere; the place and its address are recorded, marked outside a site, and wait for approval under Phone punches (or the person’s manager) when the company asks.</p>
          </div>
        ) : null
      }
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!data ? (
        loadError ? null : <SkeletonCard lines={8} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label="Pick everyone shown"
                      checked={allShown}
                      onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (allShown ? n.delete(p.id) : n.add(p.id))); return n; })}
                    />
                  </th>
                  <ColumnHeader label="Employee" col="employee" state={filters}  className="ui-col-grow" />
                  <ColumnHeader label="Code" col="code" state={filters} />
                  <ColumnHeader label="Portal" col="portal" state={filters} />
                  <th scope="col" className="ui-col-h-center">Phone punch</th>
                  <ColumnHeader label="Site" col="site" state={filters} />
                  <th scope="col" className="hidden 2xl:table-cell">E-mail</th>
                  <th scope="col" className="hidden 2xl:table-cell">Signed up</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!shown.length ? (
                  <tr>
                    <td colSpan={9}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="Nobody matches" description="Nothing in this tab matches the search or the column filters." />
                      ) : all.length ? (
                        <EmptyState icon={KeyRound} title="Nobody here" description="Try another tab." />
                      ) : (
                        <EmptyState icon={KeyRound} title="No employees" description="Add employees first." />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((p) => {
                    const st = STATE[stateOf(p)];
                    return (
                      <tr key={p.id}>
                        <td><input type="checkbox" className="ui-checkbox" aria-label={`Pick ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                        <td className="ui-col-entity">{p.name}<span className="ui-caption block">{p.department || ''}</span></td>
                        <td className="ui-mono">{p.code || <span className="ui-caption">none</span>}</td>
                        <td><span className={`ui-pill ${st.pill}`}>{st.label}</span></td>
                        <td className="ui-col-h-center">{p.mobilePunch ? <span className="ui-pill ui-pill-pos">On</span> : <span className="ui-caption">Off</span>}</td>
                        <td>{siteOf(p)}</td>
                        <td className="ui-col-meta hidden 2xl:table-cell">{p.email || <span className="ui-caption">—</span>}</td>
                        <td className="ui-col-date hidden 2xl:table-cell">{p.portalPasswordSetAt ? new Date(p.portalPasswordSetAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="ui-caption">—</span>}</td>
                        <td className="ui-col-meta text-end">
                          {p.activated ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => reset(p)}>Forget password</button> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="people" />
        </>
      )}

      {issued ? <IssuedCodes issued={issued} portalUrl={portalUrl} onClose={() => setIssued(null)} /> : null}
    </DocumentListShell>
  );
}

/** The codes, shown this once: hand them out, print them, or read them out. */
function IssuedCodes({ issued, portalUrl, onClose }) {
  const until = new Date(issued.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Drawer
      open
      onClose={onClose}
      title="Activation codes"
      description={`Shown only now. Each works once, until ${until}.`}
      widthClass="w-[min(40rem,96vw)]"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print</button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">
          Company code <span className="ui-mono font-semibold">{issued.company.code}</span> · portal <span className="ui-mono">{portalUrl}</span>
        </p>
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col" className="ui-col-grow ui-th">Employee</th>
              <th scope="col" className="ui-th">Employee code</th>
              <th scope="col" className="ui-th">Activation code</th>
              <th scope="col" className="ui-th">E-mailed</th>
            </tr>
          </thead>
          <tbody>
            {issued.codes.map((c) => (
              <tr key={c.employeeId}>
                <td className="ui-col-entity">{c.name}</td>
                <td className="ui-mono">{c.employeeCode}</td>
                <td className="ui-mono text-base font-semibold tracking-wider">{c.activationCode}</td>
                <td className="ui-col-meta">{c.emailedTo || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ui-caption">The employee opens the portal, chooses “First time? Activate”, enters these three codes and picks their own password.</p>
      </div>
    </Drawer>
  );
}

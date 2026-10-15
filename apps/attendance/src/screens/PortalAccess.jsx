import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Printer } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getPortalAccess, issuePortalCodes, listGeofences, resetPortalPassword, setPortalAccess } from '../api/attendance';

const STATE = {
  off: { label: 'Not set up', pill: 'ui-pill-neutral' },
  pending: { label: 'Code given', pill: 'ui-pill-warn' },
  active: { label: 'Active', pill: 'ui-pill-pos' },
  paused: { label: 'Switched off', pill: 'ui-pill-neutral' },
};
const stateOf = (e) => (!e.portalEnabled ? (e.activated ? 'paused' : 'off') : e.activated ? 'active' : e.codePending ? 'pending' : 'off');

/**
 * Who may use the employee portal and punch from a phone (ClorTime's portal
 * invite). HR gives a one-time activation code; the employee chooses their own
 * password, which nobody else ever sees. A forgotten password is a new code.
 */
export default function PortalAccess() {
  const [data, setData] = useState(null);
  const [fences, setFences] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [email, setEmail] = useState(false);
  const [issued, setIssued] = useState(null);
  const load = useCallback(() => {
    getPortalAccess().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  }, []);
  useEffect(() => {
    load();
    listGeofences().then((f) => setFences(f.filter((x) => x.isActive))).catch(() => setFences([]));
  }, [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const rows = data?.employees || [];
    return n ? rows.filter((p) => `${p.name} ${p.code || ''} ${p.department || ''}`.toLowerCase().includes(n)) : rows;
  }, [data, q]);
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

  if (!data) return <SkeletonCard lines={8} />;
  return (
    <div className="space-y-4">
      <PageHeader entity="attendance" title="Portal access" description="Employees sign in to the portal with the company code, their employee code and a password they choose." />

      <section className="ui-card flex flex-wrap items-center gap-x-8 gap-y-2 p-4 text-sm">
        <div><span className="ui-t-label block">Company code</span><span className="font-mono text-base font-semibold">{data.company.code}</span></div>
        <div className="min-w-0 flex-1">
          <span className="ui-t-label block">Portal address</span>
          <span className="flex items-center gap-2">
            <a className="ui-link truncate" href={portalUrl} target="_blank" rel="noreferrer">{portalUrl}</a>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label="Copy the portal address" onClick={() => copy(portalUrl)}><Copy size={14} aria-hidden="true" /></button>
          </span>
        </div>
        <p className="ui-caption w-full">On a phone, open the address and use “Add to Home screen” — it then opens like an app.</p>
      </section>

      <section className="ui-card space-y-3 p-4" aria-label="Change access for the people picked">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{picked.size ? `${picked.size} picked` : 'Pick people below, then:'}</span>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!picked.size} onClick={give}><KeyRound size={14} aria-hidden="true" /> Give activation codes</button>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> and e-mail them
          </label>
          <span className="mx-1 h-5 w-px" style={{ backgroundColor: 'rgb(var(--border))' }} aria-hidden="true" />
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!picked.size} onClick={() => change({ mobilePunch: true }, 'may punch from their phone')}>Allow phone punch</button>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!picked.size} onClick={() => change({ mobilePunch: false }, 'may no longer punch from their phone')}>Stop phone punch</button>
          <select
            className="ui-select ui-btn-sm !w-auto"
            disabled={!picked.size}
            value=""
            aria-label="Site for phone punches"
            onChange={(e) => e.target.value && change({ geofenceId: e.target.value === 'ANY' ? null : e.target.value }, e.target.value === 'ANY' ? 'may punch at any site' : 'tied to that site')}
          >
            <option value="">Site…</option>
            <option value="ANY">Any site</option>
            {fences.map((f) => <option key={f.id} value={f.id}>Only {f.name}</option>)}
          </select>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={!picked.size} onClick={() => change({ portalEnabled: false }, 'switched off')}>Switch portal off</button>
        </div>
        {!fences.length ? <p className="ui-caption">No work sites yet — phone punches need one. Add them under Work sites.</p> : null}
      </section>

      <input type="search" className="ui-input max-w-xs" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      {!data.employees.length ? (
        <EmptyState title="No employees" description="Add employees first." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th w-8">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      aria-label="Pick everyone shown"
                      checked={allShown}
                      onChange={() => setPicked((s) => { const n = new Set(s); shown.forEach((p) => (allShown ? n.delete(p.id) : n.add(p.id))); return n; })}
                    />
                  </th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Code</th>
                  <th scope="col" className="ui-th">Portal</th>
                  <th scope="col" className="ui-th ui-col-h-center">Phone punch</th>
                  <th scope="col" className="ui-th">Site</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const st = STATE[stateOf(p)];
                  return (
                    <tr key={p.id}>
                      <td><input type="checkbox" className="ui-checkbox" aria-label={`Pick ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                      <td className="ui-col-entity">{p.name}<span className="ui-caption block">{p.department || ''}</span></td>
                      <td className="font-mono">{p.code || <span className="ui-caption">none</span>}</td>
                      <td><span className={`ui-pill ${st.pill}`}>{st.label}</span></td>
                      <td className="ui-col-h-center">{p.mobilePunch ? '✓' : ''}</td>
                      <td className="ui-col-meta">{p.mobilePunch ? p.geofenceName ? `Only ${p.geofenceName}` : 'Any' : '—'}</td>
                      <td className="text-end">
                        {p.activated ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => reset(p)}>Forget password</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {issued ? <IssuedCodes issued={issued} portalUrl={portalUrl} onClose={() => setIssued(null)} /> : null}
    </div>
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
          Company code <span className="font-mono font-semibold">{issued.company.code}</span> · portal <span className="font-mono">{portalUrl}</span>
        </p>
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col" className="ui-th">Employee</th>
              <th scope="col" className="ui-th">Employee code</th>
              <th scope="col" className="ui-th">Activation code</th>
              <th scope="col" className="ui-th">E-mailed</th>
            </tr>
          </thead>
          <tbody>
            {issued.codes.map((c) => (
              <tr key={c.employeeId}>
                <td className="ui-col-entity">{c.name}</td>
                <td className="font-mono">{c.employeeCode}</td>
                <td className="font-mono text-base font-semibold tracking-wider">{c.activationCode}</td>
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

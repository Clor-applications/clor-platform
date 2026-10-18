import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import { readFileText } from '@ui/utils/csv';
import {
  addDevice,
  lastPayload,
  previewMapping,
  rotatePushToken,
  approveDeviceNetwork,
  cancelDeviceCommands,
  deleteDevice,
  deviceCommand,
  listEmployees,
  listDeviceCommands,
  listDeviceUsers,
  listDevices,
  readerServer,
  retryDeviceCommands,
  syncConnection,
  testEtimeOffice,
  testPull,
  todayIst,
  updateDevice,
} from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const DIRECTIONS = {
  both: 'In and out (the reader’s keys decide)',
  in: 'Entry only — every punch is an arrival',
  out: 'Exit only — every punch is a departure',
};
const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/**
 * Readers and other sources of punches. Push readers (ZKTeco, eSSL and the
 * rest of the ADMS family) send their punches to CLOR and are claimed by
 * serial number; anything else that can post JSON to a URL gets its own push
 * URL and a field mapping; a CSV from any reader software can be imported;
 * e-Time Office is pulled. Which buttons a reader shows comes from what its
 * driver can do (server: services/attendance/drivers.ts).
 */
/** Sources with a field mapping instead of a protocol. */
const MAPPED = { HTTP_PUSH: true, FILE: true, HTTP_PULL: true };
/** Devices and servers CLOR pulls from with an address and credentials. */
const PULL = { HIKVISION: true, DAHUA: true, BIOSTAR: true, HTTP_PULL: true };
const ADDRESS_HINT = { HIKVISION: 'http://203.0.113.10:80', DAHUA: 'http://203.0.113.10:80', BIOSTAR: 'https://biostar.example.com', HTTP_PULL: 'https://host/api/punches?from={from}&to={to}' };
const TIME_STAMPS = [
  ['iso', 'ISO, UTC — 2026-10-17T03:30:00.000Z'],
  ['local', 'Local — 2026-10-17 09:00:00'],
  ['date', 'Date only — 2026-10-17'],
  ['dmy', 'Day first — 17/10/2026 09:00'],
  ['epoch', 'Seconds since 1970'],
  ['epoch_ms', 'Milliseconds since 1970'],
];
/** Not readers: punches sent with an API key, and from the employee portal on phones. */
const VIRTUAL = {
  API: { label: 'API key', title: 'Punches sent with an API key — manage it under Integrations' },
  MOBILE: { label: 'Employee portal', title: 'Punches from phones in the employee portal — see Portal access and Work sites' },
};

/**
 * A reader calling from a network that is not approved. Only someone on that
 * same network can approve it (the server checks), so the button shows only there.
 */
function NetworkApproval({ device, yourNetwork, onDone }) {
  const [busy, setBusy] = useState(false);
  const here = yourNetwork && yourNetwork === device.awaitingNetwork;
  const approve = async () => {
    setBusy(true);
    try {
      await approveDeviceNetwork(device.id);
      notify.success(`${device.name} approved on this network. Its punches come across on its next heartbeat.`);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not approved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="status">
      <span>
        <strong>{device.name}</strong> is calling from <code className="ui-mono">{device.awaitingNetwork}</code>, a network not approved for it. Its punches wait on the
        reader until it is.
        {!here ? ' To approve it, open this page on the same internet connection as the reader (the office Wi-Fi, not mobile data). If you did not move this reader, leave it.' : ''}
      </span>
      {here ? (
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={approve}>
          Approve this network
        </button>
      ) : null}
    </div>
  );
}

export default function AttendanceDevices({ openScreen }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    listDevices().then((v) => { setData(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load readers.')));
  }, []);
  useEffect(() => {
    load();
    /* Online status comes from the readers' 30-second heartbeat. */
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const server = readerServer();

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Readers"
        description="Readers of any make, software that can send punches to a URL, files from reader software, and e-Time Office — all landing on the same days."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" /> Add reader
          </button>
        }
      />

      {/* Set-up steps are read once: open while there is no reader, folded away after. */}
      <details className="ui-card p-5 text-sm" open={Boolean(data) && !data.devices.some((d) => !VIRTUAL[d.vendor])}>
        <summary className="ui-t-sec cursor-pointer select-none">How to connect a reader</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>
            On the reader: <strong>Menu → Comm → Cloud Server Setting</strong>. Server address <code className="ui-mono font-semibold">{server.host}</code>, port{' '}
            <code className="ui-mono font-semibold">80</code>, domain name <strong>on</strong>, proxy <strong>off</strong>. (Port 443 with HTTPS on, if the model offers it.)
          </li>
          <li>Set the reader’s date and time to Indian time — punches are recorded at the reader’s clock.</li>
          <li>
            Add it here with the serial number from <strong>Menu → System Info → Device Info</strong>, from a computer or phone on the same internet connection as the
            reader (the office Wi-Fi). Its stored punches come across on the first heartbeat.
          </li>
          <li>
            A reader only sends to CLOR from networks you approved, so someone who learns its serial number cannot use it. If it moves to a new internet connection,
            approve it here from that connection.
          </li>
          <li>
            Other makes: Hikvision, Dahua and BioStar are pulled by CLOR, so the device or server needs an address reachable from the internet (a public address or a
            forwarded port). Anything that can post JSON gets its own push URL; any software with a JSON API can be polled; a CSV from any software can be imported.
          </li>
          <li>Each person’s user ID on the reader should be their employee code, or the Reader ID on their employee file.</li>
        </ol>
      </details>

      <LoadFailed message={loadError} onRetry={load} />

      {!data ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !data.devices.length ? (
        <EmptyState icon={Cpu} title="No readers yet" description="Point a reader at CLOR as above, then add it by its serial number." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Reader</th>
                  <th scope="col" className="ui-th hidden md:table-cell">Serial</th>
                  <th scope="col" className="ui-th">Direction</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th hidden md:table-cell">Model</th>
                  <th scope="col" className="ui-th text-end">Punches today</th>
                  <th scope="col" className="ui-th text-end hidden md:table-cell">Commands waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => (
                  <tr key={d.id} className={VIRTUAL[d.vendor] ? undefined : 'ui-row-click'} onClick={VIRTUAL[d.vendor] ? undefined : () => setOpen(d)} title={VIRTUAL[d.vendor]?.title}>
                    <td className="ui-col-entity">{d.name}</td>
                    <td className="ui-col-meta hidden md:table-cell">{d.vendor === 'ETIMEOFFICE' ? 'e-Time Office' : d.vendor === 'MATRIX_COSEC' ? d.model || 'Matrix · not connected yet' : MAPPED[d.vendor] || PULL[d.vendor] ? d.driverLabel : VIRTUAL[d.vendor]?.label || d.serialNumber}</td>
                    <td>{d.direction === 'both' ? 'In / out' : d.direction === 'in' ? 'Entry' : 'Exit'}</td>
                    <td className="ui-col-h-center whitespace-nowrap">
                      {!d.isActive ? (
                        <span className="ui-pill ui-pill-neutral">off</span>
                      ) : VIRTUAL[d.vendor] ? (
                        <span className="ui-pill ui-pill-neutral">{d.lastSeenAt ? `used ${ago(d.lastSeenAt)}` : 'not used yet'}</span>
                      ) : MAPPED[d.vendor] ? (
                        !d.mapping ? (
                          <span className="ui-pill ui-pill-warn" title="Open it and set where each field is">mapping needed</span>
                        ) : d.lastError ? (
                          <span className="ui-pill ui-pill-neg" title={d.lastError}>last push failed</span>
                        ) : (
                          <span className="ui-pill ui-pill-neutral">{d.lastSeenAt ? `${d.vendor === 'FILE' ? 'imported' : 'pushed'} ${ago(d.lastSeenAt)}` : d.vendor === 'FILE' ? 'nothing imported yet' : 'nothing received yet'}</span>
                        )
                      ) : d.vendor === 'ETIMEOFFICE' || (PULL[d.vendor] && !MAPPED[d.vendor]) ? (
                        <span className={`ui-pill ${d.lastError ? 'ui-pill-neg' : d.lastFetchedAt ? 'ui-pill-pos' : 'ui-pill-neutral'}`} title={d.lastError || ''}>{d.lastError ? 'pull failing' : d.lastFetchedAt ? `pulled ${ago(d.lastFetchedAt)}` : 'not pulled yet'}</span>
                      ) : d.awaitingNetwork ? (
                        <span className="ui-pill ui-pill-warn" title={`Calling from ${d.awaitingNetwork}, which is not approved`}>new network</span>
                      ) : d.online ? (
                        <span className="ui-pill ui-pill-pos">online</span>
                      ) : (
                        <span className="ui-pill ui-pill-warn" title={d.lastSeenAt || ''}>{d.lastSeenAt ? `last seen ${ago(d.lastSeenAt)}` : 'never connected'}</span>
                      )}
                    </td>
                    <td className="ui-col-meta hidden md:table-cell">{[d.model, d.firmware && `v${d.firmware}`].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-end tabular-nums">{d.punchesToday}</td>
                    <td className="text-end tabular-nums hidden md:table-cell">{d.commandsWaiting || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(data?.devices || [])
        .filter((d) => d.awaitingNetwork)
        .map((d) => (
          <NetworkApproval key={d.id} device={d} yourNetwork={data.yourNetwork} onDone={load} />
        ))}

      {data?.unmatchedPunches ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="status">
          <span>
            <strong>{data.unmatchedPunches}</strong> {data.unmatchedPunches === 1 ? 'punch is' : 'punches are'} from reader IDs that match no employee.
          </span>
          {openScreen ? (
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen('unmatched')}>Match them</button>
          ) : (
            <span className="ui-caption">Match them under Unmatched punches.</span>
          )}
        </div>
      ) : null}

      {adding ? <AddReader drivers={data?.drivers || []} pushBase={data?.pushBase} matrixBase={data?.matrixBase} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
      {open ? (
        MAPPED[open.vendor] ? (
          <MappedDrawer device={open} pushBase={data?.pushBase} onClose={() => setOpen(null)} onChanged={load} />
        ) : open.vendor === 'MATRIX_COSEC' ? (
          <MatrixDrawer device={open} matrixBase={data?.matrixBase} onClose={() => setOpen(null)} onChanged={load} />
        ) : PULL[open.vendor] ? (
          <PullDrawer device={open} onClose={() => setOpen(null)} onChanged={load} />
        ) : open.vendor && open.vendor !== 'ADMS' ? (
          <CloudDrawer device={open} onClose={() => setOpen(null)} onChanged={load} />
        ) : (
          <ReaderDrawer device={open} onClose={() => setOpen(null)} onChanged={load} />
        )
      ) : null}
    </div>
  );
}

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Muscat', 'Asia/Bahrain', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Europe/London', 'UTC'];

function AddReader({ drivers, pushBase, matrixBase, onClose, onSaved }) {
  const [kind, setKind] = useState('ADMS');
  const [form, setForm] = useState({ serialNumber: '', name: '', direction: 'both', corporateId: '', username: '', password: '', apiUrl: '', sourceTimezone: 'Asia/Kolkata', baseUrl: '', method: 'GET', timeFormat: 'iso', auth: 'basic', body: '' });
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState(null);
  const [made, setMade] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cloud = kind === 'ETIMEOFFICE';
  const pull = Boolean(PULL[kind]);
  const matrix = kind === 'MATRIX_COSEC';
  /* Sources set up with a name and a zone only: a URL (push, Matrix) or a file. */
  const mapped = (Boolean(MAPPED[kind]) && !pull) || matrix;
  const creds = () => ({ corporateId: form.corporateId || null, username: form.username, password: form.password, apiUrl: form.apiUrl || null });
  const pullBody = () => ({
    vendor: kind,
    name: form.name,
    direction: form.direction,
    sourceTimezone: form.sourceTimezone,
    baseUrl: kind === 'HTTP_PULL' ? null : form.baseUrl || null,
    username: form.username || null,
    password: form.password || null,
    config: kind === 'HTTP_PULL' ? { url: form.baseUrl, method: form.method, timeFormat: form.timeFormat, auth: form.auth, ...(form.method === 'POST' && form.body ? { body: form.body } : {}) } : null,
  });
  const choices = drivers.length ? drivers : [{ vendor: 'ADMS', label: 'Push reader (ADMS)', blurb: 'ZKTeco, eSSL and other readers with a Cloud Server setting.' }];

  const test = async () => {
    try {
      setTested(pull ? await testPull(pullBody()) : await testEtimeOffice(creds()));
    } catch (err) {
      setTested({ ok: false, message: String(err?.message || 'Could not test.') });
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = cloud
        ? await addDevice({ vendor: 'ETIMEOFFICE', name: form.name, direction: form.direction, ...creds() })
        : pull
          ? await addDevice(pullBody())
          : mapped
          ? await addDevice({ vendor: kind, name: form.name, direction: form.direction, sourceTimezone: form.sourceTimezone })
          : await addDevice({ serialNumber: form.serialNumber, name: form.name, direction: form.direction });
      if (r.pushToken) {
        /* Shown once: only its hash is kept. */
        setMade({ device: r.device, url: `${(matrix ? matrixBase : pushBase) || ''}${r.pushToken}` });
        return;
      }
      notify.success(
        cloud || pull ? `${r.device.name} connected. Punches are pulled every few minutes${kind === 'HTTP_PULL' ? '; open it to set where each field is' : ''}.` : mapped ? `${r.device.name} added. Open it to import a file.` : r.seenBefore ? `${r.device.name} added — it is already talking to CLOR.` : `${r.device.name} added. It shows online once it connects.`
      );
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not added.'));
    } finally {
      setSaving(false);
    }
  };

  if (made) {
    return (
      <Drawer
        widthClass="w-[min(40rem,96vw)]"
        open
        onClose={onSaved}
        title={`${made.device.name} added`}
        description={matrix ? 'Set this as the controller’s Push API server URL. It is shown once; you can make a new one later.' : 'Give this URL to the reader, its software or your middleware. It is shown once; you can make a new one later.'}
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={onSaved}>Done</button>}
      >
        <PushUrl url={made.url} />
        {matrix ? <MatrixSetupNote /> : <p className="ui-caption mt-4">Send punches with POST, as JSON, in whatever shape the device uses. The first thing it sends is kept so you can set where each field is — open the reader afterwards and choose <strong>Set up fields</strong>.</p>}
      </Drawer>
    );
  }

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title="Add reader"
      description={choices.find((d) => d.vendor === kind)?.blurb || ''}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-reader" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
        </>
      }
    >
      <form id="add-reader" onSubmit={save} className="grid gap-4">
        <fieldset>
          <legend className="ui-label">How it connects</legend>
          {choices.map((d) => (
            <label key={d.vendor} className="flex items-start gap-2 py-1 text-sm">
              <input type="radio" name="kind" className="mt-1" checked={kind === d.vendor} onChange={() => setKind(d.vendor)} />
              <span>
                {d.label}
                {d.unverified ? <span className="ui-pill ui-pill-warn ms-2">not tested on hardware</span> : null}
                <span className="ui-caption block">{d.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {cloud ? (
          <>
            <label className="block"><span className="ui-label">Corporate ID</span><input className="ui-input w-full" value={form.corporateId} onChange={set('corporateId')} placeholder="As on your e-Time Office login" /></label>
            <label className="block"><span className="ui-label">User name *</span><input className="ui-input w-full" required autoComplete="off" value={form.username} onChange={set('username')} /></label>
            <label className="block"><span className="ui-label">Password *</span><input type="password" className="ui-input w-full" required autoComplete="new-password" value={form.password} onChange={set('password')} /></label>
            <label className="block"><span className="ui-label">API address</span><input className="ui-input w-full" value={form.apiUrl} onChange={set('apiUrl')} placeholder="https://api.etimeoffice.com/api/" /></label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!form.username || !form.password} onClick={test}>Test connection</button>
              {tested ? (
                <span className="text-sm" role="status" style={{ color: tested.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>
                  {tested.ok ? `Connected — ${tested.punchesToday} punches today.` : tested.message}
                </span>
              ) : null}
            </div>
          </>
        ) : pull ? (
          <>
            <label className="block">
              <span className="ui-label">{kind === 'HTTP_PULL' ? 'URL to call *' : 'Address *'}</span>
              <input className="ui-input w-full ui-mono" required value={form.baseUrl} onChange={set('baseUrl')} placeholder={ADDRESS_HINT[kind]} />
              <span className="ui-caption">
                {kind === 'HTTP_PULL' ? 'Write {from} and {to} where the time window goes.' : 'The device or server must be reachable from the internet (a public address or a forwarded port). Readers on the office network alone are for the on-site connector, coming later.'}
              </span>
            </label>
            {kind === 'HTTP_PULL' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block"><span className="ui-label">Method</span><select className="ui-select w-full" value={form.method} onChange={set('method')}><option>GET</option><option>POST</option></select></label>
                <label className="block"><span className="ui-label">{'{from}'} and {'{to}'} written as</span><select className="ui-select w-full" value={form.timeFormat} onChange={set('timeFormat')}>{TIME_STAMPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="block"><span className="ui-label">Sign in with</span><select className="ui-select w-full" value={form.auth} onChange={set('auth')}><option value="none">Nothing</option><option value="basic">User name and password (Basic)</option><option value="digest">User name and password (Digest)</option><option value="header">A header (name + value)</option></select></label>
              </div>
            ) : null}
            {kind === 'HTTP_PULL' && form.method === 'POST' ? (
              <label className="block"><span className="ui-label">Body to send</span><textarea className="ui-input w-full ui-mono" rows={2} value={form.body} onChange={set('body')} placeholder='{"from":"{from}","to":"{to}"}' /></label>
            ) : null}
            {kind !== 'HTTP_PULL' || form.auth !== 'none' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="ui-label">{kind === 'HTTP_PULL' && form.auth === 'header' ? 'Header name' : 'User name'}{kind === 'HTTP_PULL' ? '' : ' *'}</span><input className="ui-input w-full" required={kind !== 'HTTP_PULL'} autoComplete="off" value={form.username} onChange={set('username')} placeholder={kind === 'HTTP_PULL' && form.auth === 'header' ? 'X-API-Key' : 'admin'} /></label>
                <label className="block"><span className="ui-label">{kind === 'HTTP_PULL' && form.auth === 'header' ? 'Header value' : 'Password'}{kind === 'HTTP_PULL' ? '' : ' *'}</span><input type="password" className="ui-input w-full" required={kind !== 'HTTP_PULL'} autoComplete="new-password" value={form.password} onChange={set('password')} /></label>
              </div>
            ) : null}
            <ZoneField value={form.sourceTimezone} onChange={(v) => setForm({ ...form, sourceTimezone: v })} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!form.baseUrl} onClick={test}>Test connection</button>
              {tested ? (
                <span className="text-sm" role="status" style={{ color: tested.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>
                  {tested.ok ? `Connected — ${tested.punchesToday} record${tested.punchesToday === 1 ? '' : 's'} today${kind === 'HTTP_PULL' ? `, ${tested.readable} readable with the mapping` : ''}.` : tested.message}
                </span>
              ) : null}
            </div>
          </>
        ) : mapped ? (
          <ZoneField value={form.sourceTimezone} onChange={(v) => setForm({ ...form, sourceTimezone: v })} />
        ) : (
          <label className="block">
            <span className="ui-label">Serial number *</span>
            <input className="ui-input w-full ui-mono" required pattern="[A-Za-z0-9_\-]{4,40}" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value.trim() })} placeholder="e.g. CQZ7224460123" />
          </label>
        )}
        <label className="block">
          <span className="ui-label">Name *</span>
          <input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} placeholder={cloud ? 'e.g. eSSL cloud' : kind === 'FILE' ? 'e.g. Monthly export from Matrix' : kind === 'HTTP_PUSH' ? 'e.g. Turnstile middleware' : kind === 'MATRIX_COSEC' ? 'e.g. Main door controller' : kind === 'HIKVISION' ? 'e.g. Hikvision gate' : kind === 'DAHUA' ? 'e.g. Dahua back door' : kind === 'BIOSTAR' ? 'e.g. BioStar HQ' : kind === 'HTTP_PULL' ? 'e.g. Old attendance software' : 'e.g. Main gate'} />
        </label>
        <fieldset>
          <legend className="ui-label">Direction</legend>
          {Object.entries(DIRECTIONS).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 py-1 text-sm">
              <input type="radio" name="direction" checked={form.direction === k} onChange={() => setForm({ ...form, direction: k })} /> {label}
            </label>
          ))}
          {mapped && !matrix ? <span className="ui-caption">Used when what it sends does not say in or out.</span> : null}
          {matrix ? <span className="ui-caption">A controller says entry or exit on every event; “Entry only” or “Exit only” overrides it.</span> : null}
        </fieldset>
      </form>
    </Drawer>
  );
}

function ZoneField({ value, onChange }) {
  return (
    <label className="block">
      <span className="ui-label">Times it sends are in</span>
      <input className="ui-input w-full" list="tz-list" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Asia/Kolkata" />
      <datalist id="tz-list">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      <span className="ui-caption">A time with its own offset (…+04:00, …Z) is converted whatever this says.</span>
    </label>
  );
}

function PushUrl({ url }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success('Copied.');
    } catch {
      notify.error('Could not copy — select it and copy by hand.');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="ui-mono ui-card min-w-0 flex-1 break-all px-3 py-2 text-sm">{url}</code>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={copy}>Copy</button>
    </div>
  );
}

const TIME_FORMATS = [
  ['auto', 'Work it out (ISO, YYYY-MM-DD, epoch)'],
  ['DMY', 'Day first — 31/12/2026 09:05'],
  ['MDY', 'Month first — 12/31/2026 09:05'],
  ['epoch', 'Seconds since 1970'],
  ['epoch_ms', 'Milliseconds since 1970'],
];
const BLANK_MAPPING = { records: '', employeeCode: '', timestamp: '', date: '', time: '', timeFormat: 'auto', direction: '', inValues: 'in, 0, checkin, entry', outValues: 'out, 1, checkout, exit', verifyMode: '', filterField: '', filterValues: '' };
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const fromMapping = (m) => (m ? { ...BLANK_MAPPING, ...m, inValues: (m.inValues || []).join(', '), outValues: (m.outValues || []).join(', '), filterValues: (m.filterValues || []).join(', ') } : { ...BLANK_MAPPING });
const toMapping = (f) => ({ ...f, inValues: list(f.inValues), outValues: list(f.outValues), filterValues: list(f.filterValues) });
/** Field names in a JSON body: the first record's keys, wherever the list is. */
const sniffHeaders = (text) => {
  try {
    let v = JSON.parse(text);
    for (let depth = 0; depth < 3 && v && typeof v === 'object' && !Array.isArray(v); depth += 1) {
      const arr = Object.values(v).find((x) => Array.isArray(x));
      if (!arr) break;
      v = arr;
    }
    const first = Array.isArray(v) ? v[0] : v;
    return first && typeof first === 'object' ? Object.keys(first) : [];
  } catch {
    return [];
  }
};

/**
 * A source read through a field mapping: HTTP push (its own URL) or a file.
 * The mapping is set against a real sample — the last thing the device sent,
 * or the file about to be imported — and previewed before anything is saved.
 */
function MappedDrawer({ device, pushBase, onClose, onChanged }) {
  const isFile = device.vendor === 'FILE';
  const isPull = device.vendor === 'HTTP_PULL';
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive, sourceTimezone: device.sourceTimezone || 'Asia/Kolkata' });
  const [map, setMap] = useState(fromMapping(device.mapping));
  const [sample, setSample] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const setM = (k) => (e) => setMap((m) => ({ ...m, [k]: e.target.value }));
  const headers = preview?.headers || [];

  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const loadLast = () =>
    act('last', async () => {
      const r = await lastPayload(device.id);
      if (!r.payload) {
        notify.error('Nothing has been sent to this URL yet.');
        return;
      }
      setSample(r.payload);
      /* Before any field is set, only show what came in and the names in it; a preview needs the employee code field. */
      if (map.employeeCode) setPreview(await previewMapping(device.id, { mapping: toMapping(map), sourceTimezone: form.sourceTimezone, sample: r.payload }));
      else setPreview({ records: 0, readable: 0, headers: sniffHeaders(r.payload), sample: [], errors: [] });
    });
  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await readFileText(f);
    setSample(text);
    setFileName(f.name);
    setPreview(null);
  };
  const run = (save) =>
    act(save ? 'import' : 'preview', async () => {
      const r = await previewMapping(device.id, { mapping: toMapping(map), sourceTimezone: form.sourceTimezone, sample: sample || undefined, save });
      setPreview(r);
      if (save) {
        notify.success(`${r.added} punch${r.added === 1 ? '' : 'es'} imported${r.duplicates ? `, ${r.duplicates} already there` : ''}.`);
        onChanged();
      }
    });
  const save = async (e) => {
    e.preventDefault();
    await act('save', async () => {
      await updateDevice(device.id, { ...form, mapping: map.employeeCode ? toMapping(map) : null });
      notify.success('Saved.');
      onChanged();
    });
  };
  const rotate = async () => {
    const ok = await confirmDialog({ title: 'Make a new URL?', message: 'The old URL stops working at once. Update the reader or software with the new one.', confirmLabel: 'New URL' });
    if (!ok) return;
    await act('rotate', async () => setNewUrl(`${pushBase || ''}${(await rotatePushToken(device.id)).pushToken}`));
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Remove ${device.name}?`, message: 'Only a source with no punches on record can be removed.', confirmLabel: 'Remove' });
    if (!ok) return;
    await act('delete', async () => {
      await deleteDevice(device.id);
      onChanged();
      onClose();
    });
  };
  const field = (k, label, hint) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input className="ui-input w-full ui-mono" list={headers.length ? 'hdr-list' : undefined} value={map[k]} onChange={setM(k)} placeholder={hint} />
    </label>
  );

  return (
    <Drawer
      widthClass="w-[min(56rem,96vw)]"
      open
      onClose={onClose}
      title={device.name}
      description={`${device.driverLabel} · ${device.lastSeenAt ? `${isFile ? 'imported' : isPull ? 'last pull' : 'last push'} ${ago(device.lastSeenAt)}` : isFile ? 'nothing imported yet' : isPull ? 'not pulled yet' : 'nothing received yet'}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-ghost" disabled={busy === 'delete'} onClick={remove}>Remove</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" form="mapped-form" className="ui-btn ui-btn-primary" disabled={busy === 'save'}>Save</button>
        </>
      }
    >
      <div className="space-y-6">
        {device.lastError ? <div className="ui-card p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>Last {isPull ? 'pull' : 'push'}: {device.lastError}</div> : null}
        {isPull ? <PullControls device={device} onChanged={onChanged} /> : null}
        {!isFile && !isPull ? (
          <section className="space-y-2" aria-labelledby="url-h">
            <h3 id="url-h" className="ui-t-sec">Push URL</h3>
            {newUrl ? (
              <PushUrl url={newUrl} />
            ) : (
              <p className="text-sm">
                <code className="ui-mono">{pushBase}{device.pushTokenPrefix}…</code> <span className="ui-caption">— the full URL was shown when it was added.</span>
              </p>
            )}
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === 'rotate'} onClick={rotate}>Make a new URL</button>
          </section>
        ) : null}

        <section className="space-y-3" aria-labelledby="map-h">
          <h3 id="map-h" className="ui-t-sec">Set up fields</h3>
          <p className="ui-caption">
            {isFile ? 'Choose a file; its column names appear below. Say which column holds what, preview, then import.' : isPull ? 'Sync now once, then load what the API answered, say which field holds what, and preview. Punches are read from the next pull.' : 'Load what the device last sent, say which field holds what, and preview. Punches are read from the next push.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {isFile ? (
              <label className="ui-btn ui-btn-secondary ui-btn-sm cursor-pointer">
                Choose file…
                <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={pickFile} />
              </label>
            ) : (
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy === 'last'} onClick={loadLast}>Load last payload</button>
            )}
            {fileName ? <span className="ui-caption">{fileName}</span> : null}
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!map.employeeCode || busy === 'preview' || (isFile && !sample)} onClick={() => run(false)}>Preview</button>
            {isFile ? (
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={!preview || !preview.readable || busy === 'import'} onClick={() => run(true)}>
                {busy === 'import' ? 'Importing…' : `Import ${preview?.readable || ''} punches`}
              </button>
            ) : null}
          </div>
          {sample && !isFile ? <pre className="ui-card ui-mono max-h-40 overflow-auto p-3 text-xs">{sample.slice(0, 3000)}</pre> : null}
          {headers.length ? (
            <p className="ui-caption">
              {isFile ? 'Columns' : 'Fields'} found: {headers.map((h) => <code key={h} className="ui-mono me-2">{h}</code>)}
            </p>
          ) : null}
          <datalist id="hdr-list">{headers.map((h) => <option key={h} value={h} />)}</datalist>
          <div className="grid gap-3 sm:grid-cols-2">
            {!isFile ? field('records', 'Where the list of punches is', 'e.g. data.events — blank if the answer is the list') : null}
            {field('employeeCode', 'Employee code *', isFile ? 'column name' : 'e.g. employeeNoString or user.id')}
            {field('timestamp', 'Date and time, one field', 'e.g. dateTime — or use the two below')}
            <label className="block">
              <span className="ui-label">How the time is written</span>
              <select className="ui-select w-full" value={map.timeFormat} onChange={setM('timeFormat')}>
                {TIME_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {field('date', 'Date (if separate)', 'e.g. PunchDate')}
            {field('time', 'Time (if separate)', 'e.g. PunchTime')}
            {field('direction', 'In / out field', 'e.g. attendanceStatus — blank uses the direction above')}
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="ui-label">Means in</span><input className="ui-input w-full" value={map.inValues} onChange={setM('inValues')} /></label>
              <label className="block"><span className="ui-label">Means out</span><input className="ui-input w-full" value={map.outValues} onChange={setM('outValues')} /></label>
            </div>
            {field('verifyMode', 'How they were verified', 'e.g. verifyMode (face, finger, card)')}
            <div className="grid grid-cols-2 gap-3">
              {field('filterField', 'Only records where', 'e.g. eventType')}
              <label className="block"><span className="ui-label">equals one of</span><input className="ui-input w-full" value={map.filterValues} onChange={setM('filterValues')} placeholder="e.g. granted" /></label>
            </div>
          </div>
          {preview && preview.records ? (
            <div className="ui-card space-y-2 p-3 text-sm" role="status">
              <div>
                <strong>{preview.readable}</strong> of {preview.records} record{preview.records === 1 ? '' : 's'} readable
                {preview.skipped ? ` · ${preview.skipped} skipped by the filter` : ''}
                {preview.added != null ? ` · ${preview.added} imported, ${preview.duplicates} already there` : ''}
              </div>
              {preview.sample?.length ? (
                <table className="ui-table w-full">
                  <thead><tr><th className="ui-th">Code</th><th className="ui-th">Time (India)</th><th className="ui-th">Direction</th></tr></thead>
                  <tbody>{preview.sample.map((p, i) => <tr key={i}><td className="ui-mono">{p.code}</td><td className="ui-mono">{p.localTime}</td><td>{p.direction || '—'}</td></tr>)}</tbody>
                </table>
              ) : null}
              {preview.errors?.length ? <ul className="ui-caption list-disc ps-5">{preview.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
            </div>
          ) : null}
        </section>

        <form id="mapped-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block">
            <span className="ui-label">Direction when not said</span>
            <select className="ui-select w-full" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              {Object.entries(DIRECTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <div className="sm:col-span-2"><ZoneField value={form.sourceTimezone} onChange={(v) => setForm({ ...form, sourceTimezone: v })} /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> {isFile ? 'In use' : 'Accepting punches'}
          </label>
        </form>
      </div>
    </Drawer>
  );
}

/** An e-Time Office connection: credentials, last pull, Sync now, fetch older punches. */
/** Where the URL goes on a Matrix controller. The menus differ a little by model; the guide calls it the Push API. */
function MatrixSetupNote() {
  return (
    <div className="ui-caption mt-4 space-y-1">
      <p>On the controller (or in its web page): <strong>Basic Settings → Communication → Server</strong>, switch <strong>Push API</strong> on, and enter this as the server URL (host, port 443 and path, as the screen splits them). Leave the device type as it is. The controller logs in and sends every event as it happens.</p>
      <p>CLOR has not yet tried this on a Matrix controller. If it connects but nothing arrives, the reader log and “last seen” here show how far it got.</p>
    </div>
  );
}

const clockWords = (sec) => {
  if (sec === null || sec === undefined) return 'not measured yet';
  const a = Math.abs(sec);
  if (a < 60) return 'right';
  const t = a < 3600 ? `${Math.round(a / 60)} min` : a < 86_400 ? `${Math.round(a / 360) / 10} h` : `${Math.round(a / 86_400)} days`;
  return `${t} ${sec > 0 ? 'fast' : 'slow'}`;
};

function MatrixDrawer({ device, matrixBase, onClose, onChanged }) {
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive, sourceTimezone: device.sourceTimezone || 'Asia/Kolkata' });
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const save = (e) => {
    e.preventDefault();
    act('save', async () => {
      await updateDevice(device.id, form);
      notify.success('Saved.');
      onChanged();
    });
  };
  const run = (action, done) =>
    act(action, async () => {
      await deviceCommand(device.id, action);
      notify.success(done);
      onChanged();
    });
  const rotate = async () => {
    const ok = await confirmDialog({ title: 'Make a new URL?', message: 'The old URL stops working at once. Enter the new one on the controller.', confirmLabel: 'New URL' });
    if (!ok) return;
    await act('rotate', async () => setNewUrl(`${matrixBase || ''}${(await rotatePushToken(device.id)).pushToken}`));
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Remove ${device.name}?`, message: 'Only a controller with no punches on record can be removed; otherwise switch it off.', confirmLabel: 'Remove' });
    if (!ok) return;
    await act('delete', async () => {
      await deleteDevice(device.id);
      onChanged();
      onClose();
    });
  };
  const cfg = device.config || {};

  return (
    <Drawer
      widthClass="w-[min(52rem,96vw)]"
      open
      onClose={onClose}
      title={device.name}
      description={`Matrix COSEC · ${device.online ? 'online' : device.lastSeenAt ? `last seen ${ago(device.lastSeenAt)}` : 'never connected'}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" form="matrix-form" className="ui-btn ui-btn-primary" disabled={busy === 'save'}>Save</button>
        </>
      }
    >
      <div className="space-y-6">
        {device.lastError ? <div className="ui-card p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{device.lastError}</div> : null}

        <section className="space-y-2" aria-labelledby="mx-status-h">
          <h3 id="mx-status-h" className="ui-t-sec">Controller</h3>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="ui-muted">Model</dt><dd>{device.model || '— (fills in at first login)'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="ui-muted">Serial on the controller</dt><dd className="ui-mono">{cfg.serialNo || '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="ui-muted">Users on it</dt><dd>{device.userCount ?? '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="ui-muted">Last event number</dt><dd>{cfg.lastSeq ?? '—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="ui-muted">Clock</dt><dd>{clockWords(device.clockOffsetSec)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="ui-muted">Commands waiting</dt><dd>{device.commandsWaiting || '0'}</dd></div>
          </dl>
          <p className="ui-caption">The clock is measured from each live event. When it is a minute or more out, CLOR sends the controller the time on its next poll.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => run('INFO', 'Asked for its user count.')}>Report user count</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => run('SET_TIME', 'The time goes to the controller on its next poll.')}>Set the time</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => run('REBOOT', 'Restart queued; it goes on its next poll.')}>Restart</button>
          </div>
        </section>

        <section className="space-y-2" aria-labelledby="mx-url-h">
          <h3 id="mx-url-h" className="ui-t-sec">Server URL on the controller</h3>
          {newUrl ? (
            <PushUrl url={newUrl} />
          ) : (
            <p className="text-sm">
              Starts <code className="ui-mono">{matrixBase}{device.pushTokenPrefix}…</code> — the full URL was shown when the controller was added.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={rotate}>{busy === 'rotate' ? 'Making…' : 'New URL'}</button>
          </div>
          <MatrixSetupNote />
        </section>

        <form id="matrix-form" onSubmit={save} className="grid gap-4">
          <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} /></label>
          <label className="block">
            <span className="ui-label">Direction</span>
            <select className="ui-select w-full" value={form.direction} onChange={set('direction')}>
              {Object.entries(DIRECTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="ui-caption">The controller says entry or exit on every event; “Entry only” or “Exit only” overrides it.</span>
          </label>
          <ZoneField value={form.sourceTimezone} onChange={(v) => setForm({ ...form, sourceTimezone: v })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Taking events
          </label>
        </form>

        <div>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={remove}>Remove controller</button>
        </div>
      </div>
    </Drawer>
  );
}

function CloudDrawer({ device, onClose, onChanged }) {
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive, corporateId: device.apiCorporateId || '', username: device.apiUsername || '', password: '', apiUrl: device.apiUrl || '' });
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      await updateDevice(device.id, { ...form, apiUrl: form.apiUrl || null, corporateId: form.corporateId || null, password: form.password || undefined });
      notify.success('Connection saved.');
      onChanged();
      onClose();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const sync = async (fromDate) => {
    setBusy(true);
    try {
      const r = await syncConnection(device.id, fromDate);
      notify.success(`${r.received} punches received, ${r.added} new.`);
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Sync failed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      widthClass="w-[min(52rem,96vw)]"
      open
      onClose={onClose}
      title={device.name}
      description={`e-Time Office · last pulled ${ago(device.lastFetchedAt)}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" form="cloud-form" className="ui-btn ui-btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-6">
        {device.lastError ? <div className="ui-card p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>Last pull failed: {device.lastError}</div> : null}
        <section className="space-y-2" aria-labelledby="sync-h">
          <h3 id="sync-h" className="ui-t-sec">Punches</h3>
          <p className="ui-caption">Pulled every few minutes. Sync now pulls at once; a date fetches older punches (up to 31 days back).</p>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => sync()}>{busy ? 'Pulling…' : 'Sync now'}</button>
            <input type="date" className="ui-input !w-auto" value={from} max={todayIst()} onChange={(e) => setFrom(e.target.value)} aria-label="Fetch from" />
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !from} onClick={() => sync(from)}>Fetch from this date</button>
          </div>
        </section>
        <form id="cloud-form" onSubmit={save} className="grid gap-4">
          <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} /></label>
          <label className="block"><span className="ui-label">Corporate ID</span><input className="ui-input w-full" value={form.corporateId} onChange={set('corporateId')} /></label>
          <label className="block"><span className="ui-label">User name</span><input className="ui-input w-full" autoComplete="off" value={form.username} onChange={set('username')} /></label>
          <label className="block"><span className="ui-label">Password</span><input type="password" className="ui-input w-full" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="Leave blank to keep the saved one" /></label>
          <label className="block"><span className="ui-label">API address</span><input className="ui-input w-full" value={form.apiUrl} onChange={set('apiUrl')} placeholder="https://api.etimeoffice.com/api/" /></label>
          <label className="block">
            <span className="ui-label">Direction</span>
            <select className="ui-select w-full" value={form.direction} onChange={set('direction')}>
              {Object.entries(DIRECTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Pulling punches
          </label>
        </form>
      </div>
    </Drawer>
  );
}

/** Sync now / fetch older, for anything CLOR pulls from. */
function PullControls({ device, onChanged }) {
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const sync = async (date) => {
    setBusy(true);
    try {
      const r = await syncConnection(device.id, date);
      notify.success(`${r.added} new punch${r.added === 1 ? '' : 'es'} (${r.received} record${r.received === 1 ? '' : 's'} received${r.readable != null ? `, ${r.readable} readable` : ''}).`);
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Could not pull.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2" aria-labelledby="sync-h">
      <h3 id="sync-h" className="ui-t-sec">Punches</h3>
      <p className="ui-caption">Pulled every few minutes. Sync now pulls at once; a date fetches older punches (up to 31 days back).</p>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => sync()}>{busy ? 'Pulling…' : 'Sync now'}</button>
        <input type="date" className="ui-input !w-auto" value={from} max={todayIst()} onChange={(e) => setFrom(e.target.value)} aria-label="Fetch from" />
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !from} onClick={() => sync(from)}>Fetch from this date</button>
      </div>
    </section>
  );
}

/** A Hikvision, Dahua or BioStar connection: address and credentials, last pull, Sync now. */
function PullDrawer({ device, onClose, onChanged }) {
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive, baseUrl: device.apiUrl || '', username: device.apiUsername || '', password: '', sourceTimezone: device.sourceTimezone || 'Asia/Kolkata' });
  const [tested, setTested] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      await updateDevice(device.id, { name: form.name, direction: form.direction, isActive: form.isActive, baseUrl: form.baseUrl, username: form.username, password: form.password || undefined, sourceTimezone: form.sourceTimezone });
      notify.success('Connection saved.');
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const test = async () => {
    try {
      setTested(await testPull({ vendor: device.vendor, name: device.name, direction: form.direction, sourceTimezone: form.sourceTimezone, baseUrl: form.baseUrl, username: form.username, password: form.password || null, deviceId: device.id }));
    } catch (err) {
      setTested({ ok: false, message: String(err?.message || 'Could not test.') });
    }
  };
  return (
    <Drawer
      widthClass="w-[min(52rem,96vw)]"
      open
      onClose={onClose}
      title={device.name}
      description={`${device.driverLabel} · ${device.lastFetchedAt ? `last pulled ${ago(device.lastFetchedAt)}` : 'not pulled yet'}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" form="pull-form" className="ui-btn ui-btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-6">
        {device.lastError ? <div className="ui-card p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>Last pull failed: {device.lastError}</div> : null}
        <p className="ui-caption">This driver follows the maker’s published API and has not been tried on a real device by CLOR. If a pull fails, send us the error shown above.</p>
        <PullControls device={device} onChanged={onChanged} />
        <form id="pull-form" onSubmit={save} className="grid gap-4">
          <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} /></label>
          <label className="block"><span className="ui-label">Address</span><input className="ui-input w-full ui-mono" required value={form.baseUrl} onChange={set('baseUrl')} placeholder={ADDRESS_HINT[device.vendor]} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="ui-label">User name</span><input className="ui-input w-full" autoComplete="off" value={form.username} onChange={set('username')} /></label>
            <label className="block"><span className="ui-label">Password</span><input type="password" className="ui-input w-full" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="Leave blank to keep the saved one" /></label>
          </div>
          <ZoneField value={form.sourceTimezone} onChange={(v) => setForm({ ...form, sourceTimezone: v })} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!form.baseUrl} onClick={test}>Test connection</button>
            {tested ? <span className="text-sm" role="status" style={{ color: tested.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>{tested.ok ? `Connected — ${tested.punchesToday} records today.` : tested.message}</span> : null}
          </div>
          <label className="block">
            <span className="ui-label">Direction when not said</span>
            <select className="ui-select w-full" value={form.direction} onChange={set('direction')}>
              {Object.entries(DIRECTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Pulling punches
          </label>
        </form>
      </div>
    </Drawer>
  );
}

const QUEUE_STATUS = {
  PENDING: { label: 'Waiting', pill: 'ui-pill-warn' },
  SENT: { label: 'Sent', pill: 'ui-pill-info' },
  DONE: { label: 'Done', pill: 'ui-pill-pos' },
  FAILED: { label: 'Failed', pill: 'ui-pill-neg' },
  CANCELLED: { label: 'Cancelled', pill: 'ui-pill-neutral' },
};

function ReaderDrawer({ device, onClose, onChanged }) {
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive, areaId: device.areaId || '' });
  const [queue, setQueue] = useState(null);
  const [queueStatus, setQueueStatus] = useState('');
  const [users, setUsers] = useState(null);
  const [areas, setAreas] = useState([]);

  const loadDetail = useCallback(() => {
    listDeviceCommands(device.id, queueStatus).then(setQueue).catch(() => setQueue({ commands: [], counts: {} }));
    listDeviceUsers(device.id).then(setUsers).catch(() => setUsers([]));
  }, [device.id, queueStatus]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);
  useEffect(() => {
    listStructure('areas').then(setAreas).catch(() => setAreas([]));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await updateDevice(device.id, { ...form, areaId: form.areaId || null });
      notify.success(r?.areaChanged ? 'Reader saved. Its area changed — see Sync status to add the new people and remove the rest.' : 'Reader saved.');
      onChanged();
      onClose();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const run = async (action, done) => {
    try {
      const r = await deviceCommand(device.id, action);
      notify.success(typeof done === 'function' ? done(r) : done);
      loadDetail();
      onChanged();
    } catch (err) {
      notify.error(String(err?.message || 'Not queued.'));
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Remove ${device.name}?`, message: 'Only a reader with no punches can be removed; otherwise switch it off.', confirmLabel: 'Yes, remove' });
    if (!ok) return;
    try {
      await deleteDevice(device.id);
      onChanged();
      onClose();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  return (
    <Drawer
      widthClass="w-[min(52rem,96vw)]"
      open
      onClose={onClose}
      title={device.name}
      description={`${device.serialNumber}${device.ip ? ` · ${device.ip}` : ''} · last seen ${ago(device.lastSeenAt)}`}
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Remove</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button>
          <button type="submit" form="reader-form" className="ui-btn ui-btn-primary">Save</button>
        </>
      }
    >
      <div className="space-y-6">
        <form id="reader-form" onSubmit={save} className="grid gap-4">
          <label className="block"><span className="ui-label">Name</span><input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block">
            <span className="ui-label">Direction</span>
            <select className="ui-select w-full" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              {Object.entries(DIRECTIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="ui-caption">Applies to punches from now on.</span>
          </label>
          {areas.length ? (
            <label className="block">
              <span className="ui-label">Serves</span>
              <select className="ui-select w-full" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                <option value="">Everyone</option>
                {areas.map((a) => <option key={a.id} value={a.id}>Only {a.name} area</option>)}
              </select>
              <span className="ui-caption">A site’s reader holds only that site’s staff — smaller, faster, and nobody else’s finger opens it. People with no area go to every reader.</span>
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Collecting punches
          </label>
        </form>

        <section aria-labelledby="actions-h">
          <h3 id="actions-h" className="ui-t-sec mb-2">Send to the reader</h3>
          <p className="ui-caption mb-2">Delivered on its next heartbeat (about 30 seconds).</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('FETCH_PUNCHES', 'Asked for every punch it holds. Duplicates are ignored.')}>Fetch all punches</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('FETCH_USERS', 'Asked for its user list.')}>Fetch its users</button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => run('SEND_STAFF', (r) => (r.queued ? `${r.queued} new ${r.queued === 1 ? 'person' : 'people'} queued for the reader.` : 'Everyone is already on the reader.'))}
            >
              Send new staff
            </button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('READ_ALL', 'Asked for its users, fingerprints, faces and counts. Sync status fills in as they arrive.')}>Read what is on it</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('INFO', 'Asked for its counts and capacity.')}>Refresh counts</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('SET_TIME', 'Time set queued. Its drift is measured again from its next live punch.')}>Set the time</button>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('REBOOT', 'Reboot queued.')}>Reboot</button>
          </div>
          <p className="ui-caption mt-2">“Send new staff” adds people the reader does not have, by employee code or Reader ID. Fetch its users first so people already on it are skipped.</p>
        </section>

        <ReaderMessage device={device} onSent={() => { loadDetail(); onChanged(); }} />

        <section aria-labelledby="bio-h">
          <h3 id="bio-h" className="ui-t-sec mb-2">Fingerprints and faces</h3>
          <p className="ui-caption mb-2">
            Enrol a person once, on any reader: their fingerprints and face are copied to every other reader automatically.
            {device.faceSupported === false ? ' This reader has no face recognition, so faces are not sent to it.' : ''}
            {device.faceMajorVer ? ` Face algorithm version ${device.faceMajorVer}${device.faceMinorVer ? `.${device.faceMinorVer}` : ''}.` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('FETCH_TEMPLATES', 'Asked for its fingerprints and faces. New ones are copied to the other readers.')}>
              Fetch fingerprints &amp; faces
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-sm"
              onClick={() => run('COPY_TEMPLATES', (r) => (r.people ? `Copying ${r.people} ${r.people === 1 ? 'person' : 'people'}’s fingerprints and faces to this reader (${r.queued} commands).` : 'No fingerprints or faces stored yet — fetch them from a reader first.'))}
            >
              Copy everyone’s fingerprints &amp; faces here
            </button>
          </div>
        </section>

        <section aria-labelledby="cmds-h">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id="cmds-h" className="ui-t-sec">Queue</h3>
            <select className="ui-select ui-btn-sm !w-auto" value={queueStatus} onChange={(e) => setQueueStatus(e.target.value)} aria-label="Show">
              <option value="">Latest</option>
              {Object.entries(QUEUE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}{queue?.counts?.[k] ? ` (${queue.counts[k]})` : ''}</option>
              ))}
            </select>
          </div>
          {queue?.counts?.FAILED || queue?.counts?.PENDING ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {queue.counts.FAILED ? (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={async () => { const r = await retryDeviceCommands(device.id); notify.success(`${r.retried} sent again.`); loadDetail(); onChanged(); }}>
                  Retry {queue.counts.FAILED} failed
                </button>
              ) : null}
              {queue.counts.PENDING ? (
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={async () => { if (!(await confirmDialog({ title: 'Cancel waiting changes?', message: `${queue.counts.PENDING} changes have not reached the reader yet. Cancelled ones are not sent.`, confirmLabel: 'Cancel them' }))) return; const r = await cancelDeviceCommands(device.id); notify.success(`${r.cancelled} cancelled.`); loadDetail(); onChanged(); }}>
                  Cancel {queue.counts.PENDING} waiting
                </button>
              ) : null}
            </div>
          ) : null}
          {!queue ? (
            <SkeletonCard lines={2} />
          ) : !queue.commands.length ? (
            <p className="ui-muted text-sm">Nothing here.</p>
          ) : (
            <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
              {queue.commands.slice(0, 40).map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{c.what}{c.employeeName ? ` — ${c.employeeName}` : c.pin ? ` — ID ${c.pin}` : ''}</span>
                    {c.lastError ? <span className="ui-caption block" style={{ color: 'rgb(var(--neg))' }}>{c.lastError}</span> : null}
                  </span>
                  <span className={`ui-pill shrink-0 ${QUEUE_STATUS[c.status]?.pill || 'ui-pill-neutral'}`} title={c.attempts > 1 ? `Sent ${c.attempts} times` : ''}>
                    {QUEUE_STATUS[c.status]?.label || c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="users-h">
          <h3 id="users-h" className="ui-t-sec mb-2">Users on the reader</h3>
          {!users ? (
            <SkeletonCard lines={2} />
          ) : !users.length ? (
            <p className="ui-muted text-sm">Not known yet — use “Fetch its users”.</p>
          ) : (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {users.map((u) => (
                <li key={u.id} className="flex justify-between gap-2">
                  <span className="truncate"><span className="ui-mono">{u.pin}</span> {u.name || ''}</span>
                  <span className="ui-caption" style={u.employeeName ? undefined : { color: 'rgb(var(--warn-ink))' }}>
                    {u.employeeName || 'no employee'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

/**
 * A line on the reader's screen (ClorTime's Device → Message, which stored
 * the text but never sent it). For everyone who walks up, or for one person
 * when they punch; it stays for the minutes given.
 */
function ReaderMessage({ device, onSent }) {
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [employeeId, setEmployeeId] = useState('');
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listEmployees().then((d) => setPeople(d?.employees || d || [])).catch(() => {});
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await deviceCommand(device.id, 'MESSAGE', { text: text.trim(), minutes: Number(minutes) || 60, ...(employeeId ? { employeeId } : {}) });
      notify.success(r.to === 'person' ? 'Queued — it shows the next time they punch.' : 'Queued — it shows on the reader within a minute.');
      setText('');
      onSent?.();
    } catch (err) {
      notify.error(String(err?.message || 'Not queued.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="msg-h">
      <h3 id="msg-h" className="ui-t-sec mb-2">Message on the reader</h3>
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="block min-w-[16rem] flex-1">
          <span className="ui-t-label block mb-1">Text</span>
          <input className="ui-input w-full" value={text} maxLength={200} placeholder="e.g. Office closes at 4 today" onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="block">
          <span className="ui-t-label block mb-1">Shows for</span>
          <select className="ui-select" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
            <option value={240}>4 hours</option>
            <option value={1440}>1 day</option>
            <option value={10080}>1 week</option>
          </select>
        </label>
        <label className="block">
          <span className="ui-t-label block mb-1">To</span>
          <select className="ui-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <button type="submit" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !text.trim()}>{busy ? 'Queuing…' : 'Show it'}</button>
      </form>
      <p className="ui-caption mt-2">A message to one person appears when they punch; to everyone, on the idle screen.</p>
    </section>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listStructure } from '@ui/personnel/api';
import {
  addDevice,
  approveDeviceNetwork,
  cancelDeviceCommands,
  deleteDevice,
  deviceCommand,
  listDeviceCommands,
  listDeviceUsers,
  listDevices,
  readerServer,
  retryDeviceCommands,
  syncConnection,
  testEtimeOffice,
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
 * Biometric readers (ZKTeco / eSSL). The reader sends its punches to CLOR —
 * nothing is opened at the office — and is claimed here by its serial number.
 * The same push protocol the on-premise ClorTime server uses.
 */
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
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Readers"
        description="ZKTeco and eSSL biometric readers sending punches to CLOR."
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
                  <th scope="col" className="ui-th">Serial</th>
                  <th scope="col" className="ui-th">Direction</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th">Model</th>
                  <th scope="col" className="ui-th text-end">Punches today</th>
                  <th scope="col" className="ui-th text-end">Commands waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => (
                  <tr key={d.id} className={VIRTUAL[d.vendor] ? undefined : 'ui-row-click'} onClick={VIRTUAL[d.vendor] ? undefined : () => setOpen(d)} title={VIRTUAL[d.vendor]?.title}>
                    <td className="ui-col-entity">{d.name}</td>
                    <td className="ui-col-meta">{d.vendor === 'ETIMEOFFICE' ? 'e-Time Office' : VIRTUAL[d.vendor]?.label || d.serialNumber}</td>
                    <td>{d.direction === 'both' ? 'In / out' : d.direction === 'in' ? 'Entry' : 'Exit'}</td>
                    <td className="ui-col-h-center whitespace-nowrap">
                      {!d.isActive ? (
                        <span className="ui-pill ui-pill-neutral">off</span>
                      ) : VIRTUAL[d.vendor] ? (
                        <span className="ui-pill ui-pill-neutral">{d.lastSeenAt ? `used ${ago(d.lastSeenAt)}` : 'not used yet'}</span>
                      ) : d.vendor === 'ETIMEOFFICE' ? (
                        <span className={`ui-pill ${d.lastError ? 'ui-pill-neg' : 'ui-pill-pos'}`} title={d.lastError || ''}>{d.lastError ? 'pull failing' : `pulled ${ago(d.lastFetchedAt)}`}</span>
                      ) : d.awaitingNetwork ? (
                        <span className="ui-pill ui-pill-warn" title={`Calling from ${d.awaitingNetwork}, which is not approved`}>new network</span>
                      ) : d.online ? (
                        <span className="ui-pill ui-pill-pos">online</span>
                      ) : (
                        <span className="ui-pill ui-pill-warn" title={d.lastSeenAt || ''}>{d.lastSeenAt ? `last seen ${ago(d.lastSeenAt)}` : 'never connected'}</span>
                      )}
                    </td>
                    <td className="ui-col-meta">{[d.model, d.firmware && `v${d.firmware}`].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-end tabular-nums">{d.punchesToday}</td>
                    <td className="text-end tabular-nums">{d.commandsWaiting || '—'}</td>
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

      {adding ? <AddReader onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
      {open ? (
        open.vendor && open.vendor !== 'ADMS' ? (
          <CloudDrawer device={open} onClose={() => setOpen(null)} onChanged={load} />
        ) : (
          <ReaderDrawer device={open} onClose={() => setOpen(null)} onChanged={load} />
        )
      ) : null}
    </div>
  );
}

function AddReader({ onClose, onSaved }) {
  const [kind, setKind] = useState('ADMS');
  const [form, setForm] = useState({ serialNumber: '', name: '', direction: 'both', corporateId: '', username: '', password: '', apiUrl: '' });
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cloud = kind === 'ETIMEOFFICE';
  const creds = () => ({ corporateId: form.corporateId || null, username: form.username, password: form.password, apiUrl: form.apiUrl || null });

  const test = async () => {
    try {
      setTested(await testEtimeOffice(creds()));
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
        : await addDevice({ serialNumber: form.serialNumber, name: form.name, direction: form.direction });
      notify.success(
        cloud ? `${r.device.name} connected. Punches are pulled every few minutes.` : r.seenBefore ? `${r.device.name} added — it is already talking to CLOR.` : `${r.device.name} added. It shows online once it connects.`
      );
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not added.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title="Add reader"
      description={cloud ? 'eSSL readers that sync to e-Time Office: CLOR pulls their punches from it.' : 'A serial number belongs to one company. Punches from a reader nobody has added are not recorded.'}
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
          <label className="flex items-start gap-2 py-1 text-sm">
            <input type="radio" name="kind" className="mt-1" checked={!cloud} onChange={() => setKind('ADMS')} />
            <span>The reader sends punches to CLOR <span className="ui-caption">— ZKTeco and most eSSL models (Cloud Server Setting)</span></span>
          </label>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input type="radio" name="kind" className="mt-1" checked={cloud} onChange={() => setKind('ETIMEOFFICE')} />
            <span>From e-Time Office <span className="ui-caption">— readers already syncing to eSSL’s cloud</span></span>
          </label>
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
        ) : (
          <label className="block">
            <span className="ui-label">Serial number *</span>
            <input className="ui-input w-full ui-mono" required pattern="[A-Za-z0-9_\-]{4,40}" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value.trim() })} placeholder="e.g. CQZ7224460123" />
          </label>
        )}
        <label className="block">
          <span className="ui-label">Name *</span>
          <input className="ui-input w-full" required maxLength={80} value={form.name} onChange={set('name')} placeholder={cloud ? 'e.g. eSSL cloud' : 'e.g. Main gate'} />
        </label>
        <fieldset>
          <legend className="ui-label">Direction</legend>
          {Object.entries(DIRECTIONS).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 py-1 text-sm">
              <input type="radio" name="direction" checked={form.direction === k} onChange={() => setForm({ ...form, direction: k })} /> {label}
            </label>
          ))}
        </fieldset>
      </form>
    </Drawer>
  );
}

/** An e-Time Office connection: credentials, last pull, Sync now, fetch older punches. */
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
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('REBOOT', 'Reboot queued.')}>Reboot</button>
          </div>
          <p className="ui-caption mt-2">“Send new staff” adds people the reader does not have, by employee code or Reader ID. Fetch its users first so people already on it are skipped.</p>
        </section>

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

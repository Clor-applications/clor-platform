import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  addDevice,
  deleteDevice,
  deviceCommand,
  listDeviceCommands,
  listDeviceUsers,
  listDevices,
  readerServer,
  updateDevice,
} from '../api/attendance';

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
export default function AttendanceDevices() {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    listDevices().then(setData).catch((e) => notify.error(String(e?.message || 'Could not load readers.')));
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

      <section className="ui-card p-5 text-sm" aria-labelledby="setup-h">
        <h2 id="setup-h" className="ui-t-sec mb-2">Connecting a reader</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            On the reader: <strong>Menu → Comm → Cloud Server Setting</strong>. Server address <code className="font-mono font-semibold">{server.host}</code>, port{' '}
            <code className="font-mono font-semibold">80</code>, domain name <strong>on</strong>, proxy <strong>off</strong>. (Port 443 with HTTPS on, if the model offers it.)
          </li>
          <li>Set the reader’s date and time to Indian time — punches are recorded at the reader’s clock.</li>
          <li>
            Add it here with the serial number from <strong>Menu → System Info → Device Info</strong>. Its stored punches come across on the first heartbeat.
          </li>
          <li>Each person’s user ID on the reader should be their employee code, or the Reader ID on their employee file.</li>
        </ol>
      </section>

      {!data ? (
        <SkeletonCard lines={4} />
      ) : !data.devices.length ? (
        <EmptyState icon={Cpu} title="No readers yet" description="Point a reader at CLOR as above, then add it by its serial number." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
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
                  <tr key={d.id} className="ui-row-click" onClick={() => setOpen(d)}>
                    <td className="ui-col-entity">{d.name}</td>
                    <td className="ui-col-meta">{d.serialNumber}</td>
                    <td>{d.direction === 'both' ? 'In / out' : d.direction === 'in' ? 'Entry' : 'Exit'}</td>
                    <td className="ui-col-h-center whitespace-nowrap">
                      {!d.isActive ? (
                        <span className="ui-pill ui-pill-neutral">off</span>
                      ) : d.online ? (
                        <span className="ui-pill ui-pill-pos">online</span>
                      ) : (
                        <span className="ui-pill ui-pill-warn" title={d.lastSeenAt || ''}>last seen {ago(d.lastSeenAt)}</span>
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

      {data?.unmatchedPunches ? (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm" role="status">
          <span>
            <strong>{data.unmatchedPunches}</strong> {data.unmatchedPunches === 1 ? 'punch is' : 'punches are'} from reader IDs that match no employee.
          </span>
          <span className="ui-caption">Match them under Unmatched punches.</span>
        </div>
      ) : null}

      {adding ? <AddReader onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
      {open ? <ReaderDrawer device={open} onClose={() => setOpen(null)} onChanged={load} /> : null}
    </div>
  );
}

function AddReader({ onClose, onSaved }) {
  const [form, setForm] = useState({ serialNumber: '', name: '', direction: 'both' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await addDevice(form);
      notify.success(r.seenBefore ? `${r.device.name} added — it is already talking to CLOR.` : `${r.device.name} added. It shows online once it connects.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not added.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Add reader"
      description="A serial number belongs to one company. Punches from a reader nobody has added are not recorded."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-reader" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
        </>
      }
    >
      <form id="add-reader" onSubmit={save} className="grid gap-4">
        <label className="block">
          <span className="ui-label">Serial number *</span>
          <input className="ui-input w-full font-mono" required pattern="[A-Za-z0-9_\-]{4,40}" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value.trim() })} placeholder="e.g. CQZ7224460123" />
        </label>
        <label className="block">
          <span className="ui-label">Name *</span>
          <input className="ui-input w-full" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main gate" />
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

function ReaderDrawer({ device, onClose, onChanged }) {
  const [form, setForm] = useState({ name: device.name, direction: device.direction, isActive: device.isActive });
  const [commands, setCommands] = useState(null);
  const [users, setUsers] = useState(null);

  const loadDetail = useCallback(() => {
    listDeviceCommands(device.id).then(setCommands).catch(() => setCommands([]));
    listDeviceUsers(device.id).then(setUsers).catch(() => setUsers([]));
  }, [device.id]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await updateDevice(device.id, form);
      notify.success('Reader saved.');
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
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => run('REBOOT', 'Reboot queued.')}>Reboot</button>
          </div>
          <p className="ui-caption mt-2">“Send new staff” adds people the reader does not have, by employee code or Reader ID. Fingerprints and faces are enrolled at the reader. Fetch its users first so people already on it are skipped.</p>
        </section>

        <section aria-labelledby="cmds-h">
          <h3 id="cmds-h" className="ui-t-sec mb-2">Recent commands</h3>
          {!commands ? (
            <SkeletonCard lines={2} />
          ) : !commands.length ? (
            <p className="ui-muted text-sm">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {commands.slice(0, 12).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{c.command}</span>
                  <span className={`ui-pill ${c.status === 'DONE' ? 'ui-pill-pos' : c.status === 'FAILED' ? 'ui-pill-neg' : 'ui-pill-warn'}`} title={c.returnCode != null ? `Return ${c.returnCode}` : ''}>
                    {c.status.toLowerCase()}
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
                  <span className="truncate"><span className="font-mono">{u.pin}</span> {u.name || ''}</span>
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

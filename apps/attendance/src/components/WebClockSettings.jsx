import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';

import Drawer from '@ui/components/ui/Drawer';
import SuggestInput from '@ui/components/ui/SuggestInput';
import ErrorState from '@ui/components/ui/ErrorState';
import { notify } from '@ui/components/ui/notify';
import { getWebClock, saveWebClock } from '../api/attendance';

/**
 * Clock-in from a browser (audit 7 Nov 2026, #6): whether it counts at all, and
 * from which addresses. People HR set to punch from their phone always punch
 * there, with their position checked against the punch areas; this is for
 * everyone else's Clock in button. The address fields suggest the network the
 * person setting it up is on and the ones clock-ins came from lately.
 */
export default function WebClockSettings({ onClose, canEdit = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [allowed, setAllowed] = useState(true);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const load = () => {
    setError(null);
    getWebClock()
      .then((d) => { setData(d); setAllowed(d.allowed !== false); setRows(d.addresses?.length ? d.addresses : []); })
      .catch((e) => setError(e));
  };
  useEffect(load, []);

  const suggestions = useMemo(() => [
    ...(data?.yourAddress ? [{ value: data.yourAddress, hint: 'This network' }] : []),
    ...((data?.recent || []).map((r) => ({ value: r.address, hint: `${r.clockIns} clock-in${r.clockIns === 1 ? '' : 's'}` }))),
  ], [data]);
  const original = JSON.stringify([data?.allowed !== false, data?.addresses || []]);
  const cleaned = rows.map((r) => r.trim()).filter(Boolean);
  const dirty = Boolean(data) && JSON.stringify([allowed, cleaned]) !== original;

  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      await saveWebClock({ allowed, addresses: cleaned });
      notify.success(!allowed ? 'Clock-in from a browser is off.' : cleaned.length ? 'Clock-in from a browser counts from these addresses only.' : 'Clock-in from a browser counts from anywhere.');
      onClose();
    } catch (e) {
      setProblem(String(e?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} dirty={dirty} title="Clock-in from a browser" widthClass="w-[min(32rem,96vw)] ui-drawer-sheet"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        {canEdit ? <button type="button" className="ui-btn ui-btn-primary" disabled={!data || busy || !dirty} aria-busy={busy || undefined} onClick={save}>Save</button> : null}
      </>}
    >
      {error ? <ErrorState error={error} onRetry={load} compact /> : !data ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="ui-checkbox mt-0.5" checked={allowed} disabled={!canEdit} onChange={(e) => setAllowed(e.target.checked)} />
            <span>
              <span className="block font-medium">Clock in and out from a browser</span>
              <span className="ui-caption">Off, only readers and phone punches count. People set to punch from their phone always punch there.</span>
            </span>
          </label>
          {allowed ? (
            <fieldset className="space-y-2" disabled={!canEdit}>
              <legend className="ui-label">Only from these addresses</legend>
              <p className="ui-caption">The office line’s address, or a block such as 49.205.10.0/24. With none, from anywhere.</p>
              {rows.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                  <SuggestInput
                    value={value}
                    onChange={(v) => setRows((list) => list.map((x, j) => (j === i ? v : x)))}
                    suggestions={suggestions.filter((s) => !rows.includes(s.value))}
                    aria-label={`Address ${i + 1}`}
                    inputMode="decimal"
                    autoComplete="off"
                  />
                  </div>
                  <button type="button" className="ui-icon-btn" aria-label={`Remove address ${i + 1}`} onClick={() => setRows((list) => list.filter((_, j) => j !== i))}><X size={16} aria-hidden="true" /></button>
                </div>
              ))}
              {rows.length < 50 ? (
                <button type="button" className="ui-btn ui-btn-soft ui-btn-sm" onClick={() => setRows((list) => [...list, ''])}><Plus size={14} aria-hidden="true" /> Add an address</button>
              ) : null}
              {data.yourAddress ? <p className="ui-caption">You are on {data.yourAddress}.</p> : null}
            </fieldset>
          ) : null}
          {problem ? <p className="ui-text-neg" role="alert">{problem}</p> : null}
        </div>
      )}
    </Drawer>
  );
}

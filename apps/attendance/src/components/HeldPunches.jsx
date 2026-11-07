import React, { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { notify } from '@ui/components/ui/notify';
import { decideHeldPunch, getHeldPunches } from '../api/attendance';

/**
 * Reader punches held for a look (audit 7 Nov 2026, #11): a time ahead of the
 * server's when it arrived, which is a reader whose clock is wrong, so it is
 * stored but on no day. Count releases one once its time has come; Discard
 * keeps it out. Lines with a date that does not exist (31 February) cannot be
 * a punch at all; they are listed so the reader's clock gets fixed.
 * Nothing is drawn when there is nothing held.
 */
export default function HeldPunches({ canDecide = true, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    getHeldPunches().then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (p, action) => {
    setBusy(p.id);
    try {
      await decideHeldPunch(p.id, action);
      notify.success(action === 'release' ? 'Counted. The day is worked out again.' : 'Discarded.');
      load();
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };

  const held = data?.held || [];
  const impossible = data?.impossible || [];
  if (!held.length && !impossible.length) return null;
  return (
    <section className="ui-card overflow-hidden" aria-labelledby="held-h">
      <header className="px-4 pt-4 pb-2">
        <h2 id="held-h" className="ui-t-sec">Held for a look</h2>
        <p className="ui-caption">The reader’s clock was ahead of ours, or the date does not exist. These are on nobody’s days. Set the reader’s clock right under Reader health.</p>
      </header>
      <div className="ui-table-scroll">
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col">Reader</th>
              <th scope="col">Reader ID</th>
              <th scope="col" className="ui-col-grow">Employee</th>
              <th scope="col" className="ui-col-date">Time on the punch</th>
              <th scope="col">Why</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="ui-rows">
            {held.map((p) => (
              <tr key={p.id}>
                <td>{p.reader}</td>
                <td className="ui-mono">{p.pin}</td>
                <td className="ui-col-entity">{p.employeeName || <span className="ui-caption">Not matched</span>}</td>
                <td className="ui-col-date whitespace-nowrap tabular-nums">{p.time}</td>
                <td><span className="ui-pill ui-pill-warn">{p.due ? 'Was ahead' : 'Ahead of today'}</span></td>
                <td className="ui-col-meta">
                  {canDecide ? (
                    <span className="flex gap-1">
                      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!p.due || busy === p.id} title={p.due ? undefined : 'Its time has not come yet'} onClick={() => decide(p, 'release')}><Check size={14} aria-hidden="true" /> Count</button>
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === p.id} onClick={() => decide(p, 'discard')}><X size={14} aria-hidden="true" /> Discard</button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
            {impossible.map((x) => (
              <tr key={x.id}>
                <td>{x.reader}</td>
                <td className="ui-mono">{x.pin || '—'}</td>
                <td className="ui-col-entity"><span className="ui-caption">—</span></td>
                <td className="ui-col-date whitespace-nowrap tabular-nums">{x.time || '—'}</td>
                <td><span className="ui-pill ui-pill-neg">No such date</span></td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

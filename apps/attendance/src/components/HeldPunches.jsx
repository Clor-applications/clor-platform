import React, { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import Modal from '@ui/components/ui/Modal';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { decideHeldPunch, decideHeldPunches, getHeldPunches } from '../api/attendance';

const plural = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** What a bulk decision did, in one sentence. */
function bulkSummary(out, action) {
  const parts = [action === 'release' ? `${plural(out.counted, 'punch', 'punches')} counted${out.shiftMinutes ? `, moved back ${out.shiftMinutes} min` : ''}` : `${plural(out.discarded, 'punch', 'punches')} discarded`];
  if (out.closedDays) parts.push(`${plural(out.closedDays, 'day is', 'days are')} in a closed month, so not changed — adjust in payroll`);
  if (out.notYet) parts.push(`${plural(out.notYet, 'is', 'are')} still ahead of today`);
  if (out.notMatched) parts.push(`${plural(out.notMatched, 'matches', 'match')} nobody yet`);
  /* Moved back, these land on a time the same reader already sent: repeats. They stay held, and hold the month close, until discarded. */
  if (out.resends) parts.push(`${plural(out.resends, 'is a repeat', 'are repeats')} of a punch already on record at the corrected time, so ${out.resends === 1 ? 'it stays held and keeps' : 'they stay held and keep'} the month from closing. Discard ${out.resends === 1 ? 'it' : 'them'}`);
  return `${parts.join('. ')}.`;
}

/**
 * Every held punch from one reader, a chunk per call (the server takes about 200 person-days at a time
 * so other work is not held up), calling again until none are left. `onProgress` gets the running total.
 */
async function decideAllFrom({ deviceId, month, action, shiftMinutes = 0, onProgress }) {
  const sum = { counted: 0, discarded: 0, closedDays: 0, notYet: 0, notMatched: 0, resends: 0, shiftMinutes: null };
  for (let round = 0; round < 1000; round += 1) {
    const out = await decideHeldPunches({ action, deviceId, month, ...(action === 'release' && shiftMinutes ? { shiftMinutes } : {}) });
    sum.counted += out.counted || 0;
    sum.discarded += out.discarded || 0;
    sum.closedDays += out.closedDays || 0;
    sum.notYet = out.notYet || 0;
    sum.notMatched = out.notMatched || 0;
    sum.resends = out.resends || 0;
    sum.shiftMinutes = out.shiftMinutes ?? sum.shiftMinutes;
    onProgress?.({ ...sum, left: out.left || 0 });
    if (!out.left || !(out.counted || out.discarded)) break;
  }
  return sum;
}

/**
 * Count all from one reader. When its clock looks ahead, the punches are moved back by that much unless
 * the person chooses to count them as the reader recorded them (final review of #144).
 */
function CountAllDialog({ reader, month, onClose, onDone }) {
  const ahead = reader.aheadMinutes || 0;
  /* The example uses this reader's own offset: a 09:00 punch, as the fast clock wrote it. */
  const asWritten = new Date(Date.UTC(2000, 0, 1, 9, ahead)).toISOString().slice(11, 16);
  const [moveBack, setMoveBack] = useState(ahead > 0);
  const [progress, setProgress] = useState(null);
  const working = progress !== null;
  const scope = month ? ` dated in ${monthName(month)}` : '';
  const total = reader.countable;
  const run = async (e) => {
    e?.preventDefault();
    if (working) return;
    setProgress({ counted: 0, left: total });
    try {
      const sum = await decideAllFrom({ deviceId: reader.deviceId, month, action: 'release', shiftMinutes: moveBack ? ahead : 0, onProgress: setProgress });
      onDone(sum);
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
      setProgress(null);
    }
  };
  return (
    <Modal
      title={`Count ${plural(total, 'punch', 'punches')} from ${reader.reader}?`}
      maxWidthClass="max-w-md"
      onClose={working ? () => {} : onClose}
      showCloseIcon={!working}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
        <button type="submit" form="count-all" className="ui-btn ui-btn-primary" disabled={working}>{working ? 'Counting…' : 'Count all'}</button>
      </>}
    >
      <form id="count-all" onSubmit={run} className="space-y-3">
        <p className="text-sm">Every held punch from this reader{scope} whose time has come goes on its person’s day, and the days are worked out again.</p>
        {ahead > 0 ? (
          <fieldset className="space-y-2" disabled={working}>
            <legend className="text-sm font-medium">This reader’s clock looks <span className="tabular-nums">{ahead}</span> min ahead.</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="count-as" className="mt-1" checked={moveBack} onChange={() => setMoveBack(true)} />
              <span>Count, moved back <span className="tabular-nums">{ahead}</span> min<span className="ui-caption block">A punch the reader wrote as {asWritten} counts as 09:00. The reader’s own time is kept beside it.</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="count-as" className="mt-1" checked={!moveBack} onChange={() => setMoveBack(false)} />
              <span>Count as recorded</span>
            </label>
          </fieldset>
        ) : null}
        {working ? (
          <p className="text-sm" role="status" aria-live="polite">
            Counted <span className="tabular-nums">{progress.counted.toLocaleString('en-IN')}</span> of <span className="tabular-nums">{total.toLocaleString('en-IN')}</span>…
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * Reader punches held for a look (audit 7 Nov 2026, #11): a time ahead of the
 * server's when it arrived, which is a reader whose clock is wrong, so it is
 * stored but on no day. Count releases one once its time has come; Discard
 * keeps it out. Lines with a date that does not exist (31 February) cannot be
 * a punch at all; they are listed so the reader's clock gets fixed.
 *
 * A reader whose clock ran ahead for weeks can leave thousands, so each reader
 * with held punches gets "Count all" and "Discard all" (review of #144). With
 * `month` (Month close), the list and those actions take that month only.
 * Nothing is drawn when there is nothing held.
 */
export default function HeldPunches({ canDecide = true, onChanged, month = null }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    getHeldPunches(month).then(setData).catch(() => setData(null));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const decide = async (p, action) => {
    setBusy(p.id);
    try {
      const out = await decideHeldPunch(p.id, action);
      notify.success(action === 'release' ? out?.message || 'Counted. The day is worked out again.' : 'Discarded.');
      load();
      onChanged?.();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };

  const [counting, setCounting] = useState(null);
  const finished = (sum, action) => {
    notify.success(bulkSummary(sum, action));
    load();
    onChanged?.();
  };
  const decideAll = async (r, action) => {
    if (action === 'release') {
      setCounting(r);
      return;
    }
    const scope = month ? ` dated in ${monthName(month)}` : '';
    const ok = await confirmDialog({
      title: `Discard ${plural(r.count, 'punch', 'punches')} from ${r.reader}?`,
      message: `Every held punch from this reader${scope} is kept out of attendance. They stay on record as discarded.`,
      confirmLabel: 'Discard all',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(`all:${r.deviceId}`);
    try {
      finished(await decideAllFrom({ deviceId: r.deviceId, month, action: 'discard' }), 'discard');
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };

  const held = data?.held || [];
  const impossible = data?.impossible || [];
  const readers = data?.readers || [];
  const total = data?.total ?? held.length;
  if (!held.length && !impossible.length) return null;
  return (
    <section className="ui-card overflow-hidden" aria-labelledby="held-h">
      {counting ? (
        <CountAllDialog
          reader={counting}
          month={month}
          onClose={() => setCounting(null)}
          onDone={(sum) => {
            setCounting(null);
            finished(sum, 'release');
          }}
        />
      ) : null}
      <header className="px-4 pt-4 pb-2">
        <h2 id="held-h" className="ui-t-sec">Held for a look</h2>
        <p className="ui-caption">The reader’s clock was ahead of ours, or the date does not exist. These are on nobody’s days. Set the reader’s clock right under Reader health.</p>
      </header>
      {canDecide && readers.length ? (
        <ul className="divide-y border-y" aria-label="Held punches by reader">
          {readers.map((r) => (
            <li key={r.deviceId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.reader}</p>
                <p className="ui-caption">
                  <span className="tabular-nums">{r.count.toLocaleString('en-IN')}</span> held{month ? ` in ${monthName(month)}` : ''}
                  {r.countable < r.count ? <>, <span className="tabular-nums">{r.countable.toLocaleString('en-IN')}</span> can be counted now</> : null}
                  {r.aheadMinutes ? <>. Clock looks <span className="tabular-nums">{r.aheadMinutes}</span> min ahead</> : null}
                </p>
              </div>
              <span className="flex flex-wrap gap-2">
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!r.countable || Boolean(busy)} onClick={() => decideAll(r, 'release')}>
                  <Check size={14} aria-hidden="true" /> {busy === `all:${r.deviceId}` ? 'Working…' : 'Count all from this reader'}
                </button>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={Boolean(busy)} onClick={() => decideAll(r, 'discard')}>
                  <X size={14} aria-hidden="true" /> Discard all
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
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
                      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!p.due || busy === p.id || busy.startsWith('all:')} title={p.due ? undefined : 'Its time has not come yet'} onClick={() => decide(p, 'release')}><Check size={14} aria-hidden="true" /> Count</button>
                      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === p.id || busy.startsWith('all:')} onClick={() => decide(p, 'discard')}><X size={14} aria-hidden="true" /> Discard</button>
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
      {total > held.length ? (
        <p className="ui-caption px-4 py-3">Showing the latest <span className="tabular-nums">{held.length.toLocaleString('en-IN')}</span> of <span className="tabular-nums">{total.toLocaleString('en-IN')}</span>. Count all or Discard all takes every one.</p>
      ) : null}
    </section>
  );
}

function monthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

import React, { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { confirmDialog, notify } from '@ui/components/ui/notify';
import { decideHeldPunch, decideHeldPunches, getHeldPunches } from '../api/attendance';

const plural = (n, one, many) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** What a bulk decision did, in one sentence. */
function bulkSummary(out, action) {
  const parts = [action === 'release' ? `${plural(out.counted, 'punch', 'punches')} counted` : `${plural(out.discarded, 'punch', 'punches')} discarded`];
  if (out.closedDays) parts.push(`${plural(out.closedDays, 'day is', 'days are')} in a closed month, so not changed — adjust in payroll`);
  if (out.notYet) parts.push(`${plural(out.notYet, 'is', 'are')} still ahead of today`);
  if (out.notMatched) parts.push(`${plural(out.notMatched, 'matches', 'match')} nobody yet`);
  if (out.left && !out.notYet && !out.notMatched) parts.push(`${plural(out.left, 'is', 'are')} left; run it again`);
  return `${parts.join('. ')}.`;
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

  const decideAll = async (r, action) => {
    const n = action === 'release' ? r.countable : r.count;
    const scope = month ? ` dated in ${monthName(month)}` : '';
    const ok = await confirmDialog({
      title: action === 'release' ? `Count ${plural(n, 'punch', 'punches')} from ${r.reader}?` : `Discard ${plural(n, 'punch', 'punches')} from ${r.reader}?`,
      message: action === 'release'
        ? `Every held punch from this reader${scope} whose time has come goes on its person’s day, and the days are worked out again.`
        : `Every held punch from this reader${scope} is kept out of attendance. They stay on record as discarded.`,
      confirmLabel: action === 'release' ? 'Count all' : 'Discard all',
      tone: action === 'release' ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusy(`all:${r.deviceId}`);
    try {
      const out = await decideHeldPunches({ action, deviceId: r.deviceId, month });
      notify.success(bulkSummary(out, action));
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
  const readers = data?.readers || [];
  const total = data?.total ?? held.length;
  if (!held.length && !impossible.length) return null;
  return (
    <section className="ui-card overflow-hidden" aria-labelledby="held-h">
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

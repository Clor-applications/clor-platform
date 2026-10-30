import React, { useEffect, useMemo, useState } from 'react';

import Drawer from '@ui/components/ui/Drawer';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { dayLabel, getHolidayCalendars, getRestrictedPicks, importHolidayCalendar } from '../api/attendance';

/*
 * Holidays per branch (time depth, gaps 17 and 22): a built-in calendar —
 * the national list, or a state's own days — added for everyone or for one
 * branch, with where it came from; and HR's view of who picked which
 * restricted holiday.
 */

export function CalendarImport({ year, onClose, onDone }) {
  const [pickYear, setPickYear] = useState(year);
  const req = useRequest(() => getHolidayCalendars(pickYear), [pickYear]);
  const data = req.data;
  const [key, setKey] = useState('');
  const [branchId, setBranchId] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const calendars = useMemo(() => data?.calendars || [], [data]);
  const branches = useMemo(() => data?.branches || [], [data]);
  const cal = calendars.find((c) => c.key === key) || null;

  /* A state's own days are for that state's branch: offered first, and picked when there is one. */
  useEffect(() => {
    if (!cal) return;
    if (!cal.state) { setBranchId(''); return; }
    const match = branches.find((b) => String(b.state || '').toLowerCase() === cal.state.toLowerCase());
    setBranchId(match ? match.id : '');
  }, [cal, branches]);
  useEffect(() => {
    setPreview(null);
    if (!key) return undefined;
    let live = true;
    importHolidayCalendar({ key, branchId: branchId || null, dryRun: true }).then((r) => { if (live) setPreview(r); }).catch((e) => { if (live) setPreview({ error: String(e?.message || 'Could not check.') }); });
    return () => { live = false; };
  }, [key, branchId]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await importHolidayCalendar({ key, branchId: branchId || null });
      notify.success(`${r.added.length} holiday${r.added.length === 1 ? '' : 's'} added${r.skipped.length ? `; ${r.skipped.length} already there or in a closed month` : ''}.`);
      onDone(Number(cal?.year) || pickYear);
    } catch (e) {
      notify.error(String(e?.message || 'Not added.'));
    } finally {
      setBusy(false);
    }
  };

  const branchName = branches.find((b) => b.id === branchId)?.name;
  return (
    <Drawer open onClose={onClose} title="Add a holiday calendar" widthClass="w-[min(36rem,96vw)] ui-drawer-sheet"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={!cal || busy || !preview?.added?.length} onClick={run}>{busy ? 'Adding…' : preview?.added?.length ? `Add ${preview.added.length} holiday${preview.added.length === 1 ? '' : 's'}` : 'Add'}</button>
      </>}
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <PopupSelect showValueSubtext={false} label="Year" value={String(pickYear)} onChange={(v) => { setKey(''); setPickYear(Number(v) || pickYear); }} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y) }))} />
          {calendars.length ? <PopupSelect showValueSubtext={false} label="Calendar" value={key} placeholder="Choose…" onChange={(v) => setKey(v || '')} options={calendars.map((c) => ({ value: c.key, label: c.name }))} /> : null}
        </div>
        {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !data ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : !calendars.length ? (
          <p className="ui-muted">No built-in calendar for {pickYear} yet. Add the days by hand, or import them from a spreadsheet.</p>
        ) : null}
        {cal ? (
          <>
            <PopupSelect showValueSubtext={false} label="For" value={branchId || 'ALL'} onChange={(v) => setBranchId(!v || v === 'ALL' ? '' : v)}
              options={[{ value: 'ALL', label: 'Everyone' }, ...branches.map((b) => ({ value: b.id, label: `${b.name} only${b.state ? ` (${b.state})` : ''}` }))]} />
            <p className="ui-caption">From: {cal.source}.{cal.note ? ` ${cal.note}` : ''}</p>
            {cal.state && !branchId ? <p className="ui-text-warn">{cal.state}’s own days usually belong to the branch in {cal.state}. Choose it, or they are holidays for everyone.</p> : null}
            {preview?.error ? <p className="ui-text-neg" role="alert">{preview.error}</p> : !preview ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
              <div>
                <h3 className="ui-t-label mb-1">{preview.added.length ? `Adds ${preview.added.length} for ${branchName || 'everyone'}` : 'Nothing new to add'}</h3>
                <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
                  {preview.added.map((h) => <li key={`${h.date}${h.name}`} className="flex justify-between gap-3 py-1.5"><span>{h.name}</span><span className="tabular-nums whitespace-nowrap ui-muted">{dayLabel(h.date)}</span></li>)}
                  {preview.skipped.map((h) => <li key={`s${h.date}${h.name}`} className="flex justify-between gap-3 py-1.5 ui-muted"><span>{h.name} <span className="ui-caption">· {h.why}</span></span><span className="tabular-nums whitespace-nowrap">{dayLabel(h.date)}</span></li>)}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

export function RestrictedPicks({ year, onClose }) {
  const req = useRequest(() => getRestrictedPicks(year), [year]);
  const d = req.data;
  const notYet = (d?.people || []).filter((p) => d.quota && p.picked < d.quota);
  return (
    <Drawer open onClose={onClose} title={`Restricted holidays picked, ${year}`} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet">
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : !d ? <div className="ui-skel ui-skel-text" aria-busy="true" /> : (
        <div className="space-y-5 text-sm">
          <p className="ui-muted">{d.quota ? `Each person picks up to ${d.quota} of the optional holidays; on a picked day they are off and paid.` : 'Restricted holidays are switched off: set how many each person may pick in Leave settings.'}</p>
          {!d.holidays.length ? <p className="ui-muted">No optional holidays in {year}. Mark a holiday optional to offer it.</p> : (
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {d.holidays.map((h) => (
                <li key={h.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{h.name}</span>
                    <span className="tabular-nums whitespace-nowrap ui-muted">{dayLabel(h.date)} · {h.people.length} picked</span>
                  </div>
                  {h.people.length ? <p className="ui-caption mt-0.5">{h.people.map((p) => p.name).join(', ')}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {d.quota && d.holidays.length ? (
            <div>
              <h3 className="ui-t-label mb-1">{notYet.length ? `${notYet.length} ${notYet.length === 1 ? 'person has' : 'people have'} picks left` : 'Everyone has picked'}</h3>
              {notYet.length ? <p className="ui-caption">{notYet.slice(0, 40).map((p) => `${p.name} (${p.left})`).join(', ')}{notYet.length > 40 ? ` and ${notYet.length - 40} more` : ''}</p> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

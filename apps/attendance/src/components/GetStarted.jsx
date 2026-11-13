import React, { useEffect, useState } from 'react';
import { Check } from '@ui/components/ui/lineIcons';

import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';
import { changeAttendanceSetup, getAttendanceSetup } from '../api/attendance';

/**
 * Attendance → Today, for a company still setting up: "Get started", six
 * steps worked out on the server from what is really there
 * (services/attendance/setup.ts). A step ticks itself once its records exist;
 * there is nothing here to tick by hand. The list is gone once all six are
 * done, or once somebody hides it for the company.
 *
 * Only asked for by someone who sets Attendance up for the whole company (the
 * right to change shifts, not a team-only role); everyone else's Today stays
 * as it was. A step this person cannot act on says so instead of a button.
 */
export function GetStartedList({ setup, openScreen, onHide, busy = false }) {
  if (!setup?.show) return null;
  return (
    <section className="space-y-2" aria-labelledby="get-started-h">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="get-started-h" className="ui-t-sec">Get started</h2>
          <p className="ui-caption">{setup.done} of {setup.total} done. Each step ticks itself once it is in place.</p>
        </div>
        {onHide ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={onHide}>Hide this list</button> : null}
      </div>
      <ol className="ui-card overflow-hidden divide-y">
        {setup.steps.map((s, i) => (
          <li key={s.key} className="ui-setup-step" data-done={s.done || undefined}>
            <span className="ui-setup-mark" aria-hidden="true">{s.done ? <Check size={13} /> : i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <span className={`ui-pill ${s.done ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{s.done ? 'Done' : 'To do'}</span>
              </div>
              <p className="ui-caption">{s.blurb}</p>
              <p className="ui-caption">{s.detail}</p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {s.can && openScreen ? (
                <>
                  {!s.done && s.alt ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen(s.alt.screen)}>{s.alt.label}</button> : null}
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen(s.screen)} aria-label={`${s.done ? 'Review' : 'Set up'}: ${s.title}`}>{s.done ? 'Review' : 'Set up'}</button>
                </>
              ) : !s.done ? (
                <span className="ui-caption">Someone with access does this</span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function GetStarted({ openScreen }) {
  const perms = usePermissions();
  const settled = Boolean(perms && !perms.loading);
  const mayAsk = settled && !perms.error && !perms.ownDocumentsOnly && can(perms, 'ATTENDANCE::Shifts::EDIT');
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mayAsk) return undefined;
    let live = true;
    getAttendanceSetup().then((d) => live && setSetup(d?.setup || null)).catch(() => live && setSetup(null));
    return () => {
      live = false;
    };
  }, [mayAsk]);

  const hide = async () => {
    setBusy(true);
    try {
      setSetup((await changeAttendanceSetup({ action: 'hide' }))?.setup || null);
      notify.success('Hidden. Settings → Attendance setup keeps the full checklist.');
    } catch (e) {
      notify.error(String(e?.message || 'Not hidden.'));
    } finally {
      setBusy(false);
    }
  };

  if (!mayAsk) return null;
  return <GetStartedList setup={setup} openScreen={openScreen} onHide={hide} busy={busy} />;
}

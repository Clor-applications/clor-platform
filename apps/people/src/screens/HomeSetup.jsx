import React, { useCallback, useEffect, useState } from 'react';
import { Check } from '@ui/components/ui/lineIcons';

import { changePeopleSetup, getPeopleSetup } from '@ui/personnel/api';
import { setFeature } from '@platform/auth';
import { branchId, orgId } from '@platform/context';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';

/**
 * People → Home, for a company still setting up (PRODUCT-VIEW §2): a short
 * list worked out on the server (services/people/setup.ts), in place of
 * "All caught up" until it is done. Each step opens its screen and ticks
 * itself once its records exist; a step can be skipped, the list hidden.
 * Beside it, simple mode's one-time suggestion once the company has grown.
 *
 * Renders nothing for someone who cannot set the company up (the server
 * refuses them), and nothing once the list is settled.
 */
export default function HomeSetup({ openScreen, onState }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');

  const apply = useCallback((d) => {
    setData(d);
    onState?.(d);
  }, [onState]);

  /* Only someone who may set the company up asks for the list (the server refuses everyone else): a team manager's Home made a 403 on every visit. */
  const perms = usePermissions();
  const settled = Boolean(perms && !perms.loading);
  const mayAsk = settled && (Boolean(perms.error) || can(perms, 'PEOPLE::Employees::CREATE'));
  useEffect(() => {
    if (!settled) return;
    if (!mayAsk) { apply(null); return; }
    getPeopleSetup().then(apply).catch(() => apply(null));
  }, [apply, settled, mayAsk]);

  const change = async (body, key) => {
    setBusy(key);
    try {
      apply(await changePeopleSetup(body));
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    } finally {
      setBusy('');
    }
  };

  const turnOffSimple = async () => {
    setBusy('simple');
    try {
      await setFeature(orgId(), branchId(), 'peopleSimpleMode', false, { trigger: 'outgrown' });
      window.dispatchEvent(new Event('clor:features-changed'));
      notify.success('Simple mode is off: every People screen is in the menu.');
      apply(await changePeopleSetup({ action: 'simpleAdviceSeen' }));
    } catch (e) {
      notify.error(String(e?.message || 'Not changed.'));
    } finally {
      setBusy('');
    }
  };

  if (!data) return null;
  const { setup, simpleMode } = data;
  const open = (s) => () => {
    if (s.app && s.done) window.location.assign(`?app=${s.app}`);
    else openScreen?.(s.screen);
  };

  return (
    <>
      {simpleMode?.suggest ? (
        <section className="ui-card p-4 flex flex-wrap items-start gap-3" aria-labelledby="simple-h" role="status">
          <div className="min-w-0 flex-1">
            <h2 id="simple-h" className="font-medium">Your company has grown</h2>
            <p className="ui-caption">
              {simpleMode.reasons.join(', ').replace(/^./, (c) => c.toUpperCase())}. Simple mode keeps organisation detail, such as legal entities, out of the menu. You can switch it off now, or later in Settings → Modules &amp; Apps.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy === 'simple'} onClick={turnOffSimple}>Show every screen</button>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy === 'simple'} onClick={() => change({ action: 'simpleAdviceSeen' }, 'simple')}>Keep it simple</button>
          </div>
        </section>
      ) : null}

      {setup?.show ? (
        <section className="space-y-2" aria-labelledby="setup-h">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="setup-h" className="ui-t-sec">Get People ready</h2>
              <p className="ui-caption">{setup.done} of {setup.total} done. Each step ticks itself once it is in place.</p>
            </div>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === 'hide'} onClick={() => change({ action: 'hide' }, 'hide')}>Hide this list</button>
          </div>
          <ol className="ui-card overflow-hidden divide-y">
            {setup.steps.map((s, i) => (
              <li key={s.key} className="ui-setup-step" data-done={s.done || undefined}>
                <span className="ui-setup-mark" aria-hidden="true">{s.done ? <Check size={13} /> : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <span className={`ui-pill ${s.done ? 'ui-pill-pos' : s.skipped ? 'ui-pill-outline' : 'ui-pill-neutral'}`}>{s.done ? 'Done' : s.skipped ? 'Skipped' : s.optional ? 'Optional' : 'To do'}</span>
                  </div>
                  <p className="ui-caption">{s.blurb}</p>
                  <p className="ui-caption">{s.detail}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {!s.done && s.alt ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen?.(s.alt.screen)}>{s.alt.label}</button> : null}
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={open(s)} aria-label={`${s.done ? 'Review' : 'Set up'}: ${s.title}`}>{s.done ? 'Review' : 'Set up'}</button>
                  {!s.done ? (
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === s.key} onClick={() => change({ action: s.skipped ? 'unskip' : 'skip', step: s.key }, s.key)} aria-label={`${s.skipped ? 'Undo skip' : 'Skip'}: ${s.title}`}>
                      {s.skipped ? 'Undo skip' : 'Skip'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

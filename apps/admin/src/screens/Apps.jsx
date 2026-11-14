import React, { useEffect, useState } from 'react';
import { OpenRegular, WarningRegular } from '@fluentui/react-icons';

import { getAccountMe, memberDirectory } from '@platform/admin/account';
import { getAccountOverview } from '@platform/admin/admin';
import { AppMark, PageHead } from './wsKit';
import { appState, hostLabel } from './AdminHome';
import { seatsByApp } from './overviewFigures';
import './workspace.css';
import './ws-home.css';

/**
 * Workspace → Apps (R&D hand-off WS-06): every CLOR app, whether it is in
 * this company's plan, how many use it, and the way in. The same figures as
 * Home — the person's own access (/account/me), the plan and its seats
 * (/account/overview, owners, admins and billing admins) and the seats in use
 * from the member directory (owners and admins). Nothing is invented: a figure
 * that was not read is left out.
 */
export default function Apps({ tenant, catalog = [], navItems = [], openScreen, openApp, openMoreApps }) {
  const [me, setMe] = useState(undefined);
  const [overview, setOverview] = useState(null);
  const [directory, setDirectory] = useState(null);

  useEffect(() => {
    let live = true;
    getAccountMe()
      .then((r) => {
        if (!live) return;
        setMe(r || null);
        const role = r?.role;
        if (role === 'OWNER' || role === 'ADMIN' || role === 'BILLING_ADMIN') getAccountOverview().then((o) => live && setOverview(o)).catch(() => {});
        if (role === 'OWNER' || role === 'ADMIN') memberDirectory().then((d) => live && setDirectory(d?.members || [])).catch(() => {});
      })
      .catch(() => live && setMe(null));
    return () => {
      live = false;
    };
  }, [tenant?.id]);

  const may = new Set(navItems.map((n) => n.key));
  const toBilling = may.has('billing') ? () => openScreen?.('billing') : null;
  const myApps = Array.isArray(me?.apps) ? me.apps : null;
  const products = catalog.filter((a) => !a.platform);
  const built = products.filter((a) => a.available);
  const planned = products.filter((a) => !a.available);
  const seatApps = built.map((a) => a.id);
  const seats = directory ? seatsByApp(directory, overview?.seats, seatApps) : null;
  const planName = overview?.plan?.name || null;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          title="Apps"
          description="Every CLOR app, what you pay for and who uses it."
          actions={
            toBilling ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={toBilling}>
                Compare plans
              </button>
            ) : null
          }
        />

        {me === undefined ? <p className="ws-card-blurb">Reading your apps…</p> : null}

        <ul className="ws-appgrid" role="list" aria-label="CLOR apps">
          {built.map((a) => {
            const s = appState(a, tenant, myApps);
            const inPlan = s.key === 'open' || s.key === 'noaccess' || s.key === 'off';
            const seat = seats?.find((x) => x.app === a.id);
            const unit = a.id === 'accounting' ? 'users' : 'employees';
            return (
              <li key={a.id}>
                <article className="ws-appcard ws-appcard--big" aria-labelledby={`app-${a.id}`}>
                  <div className="ws-appcard-top">
                    <AppMark app={a.id} size={40} off={!inPlan} title={a.name} />
                    <span className={s.key === 'open' ? 'ws-pill ws-pill--ok' : 'ws-pill ws-pill--neutral'}>{s.key === 'open' ? 'In plan' : s.key === 'plan' ? 'Not in plan' : s.label}</span>
                  </div>
                  <h2 id={`app-${a.id}`} className="ws-appcard-name">{a.name}</h2>
                  <p className="ws-appcard-sub ws-clamp-2" title={a.blurb}>{a.blurb}</p>
                  {seat || (inPlan && planName) ? (
                    <div className="ws-appcard-facts">
                      <span>{seat ? (seat.bought != null ? `${seat.used} of ${seat.bought} ${unit === 'users' ? 'users' : 'seats'}` : `${seat.used} ${seat.used === 1 ? 'person has' : 'people have'} access`) : ''}</span>
                      {inPlan && planName ? <span>{planName}</span> : null}
                    </div>
                  ) : null}
                  <div className="ws-appcard-foot">
                    {s.key === 'open' ? (
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openApp?.(a.id)}>
                        <OpenRegular aria-hidden="true" /> Open {hostLabel(a.id)}
                      </button>
                    ) : s.key === 'noaccess' ? (
                      <span className="ws-appcard-sub">Ask an administrator for a role.</span>
                    ) : s.key === 'off' && openMoreApps ? (
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={() => openMoreApps()}>
                        Switch it on
                      </button>
                    ) : toBilling ? (
                      <button type="button" className="ws-btn ws-btn--quiet" onClick={toBilling}>
                        Add to plan
                      </button>
                    ) : (
                      <span className="ws-appcard-sub">An owner can add it to the plan.</span>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
          {planned.map((a) => (
            <li key={a.id}>
              <article className="ws-appcard ws-appcard--big" aria-labelledby={`app-${a.id}`}>
                <div className="ws-appcard-top">
                  <AppMark app={a.id} size={40} off title={a.name} />
                  <span className="ws-pill ws-pill--neutral">Coming soon</span>
                </div>
                <h2 id={`app-${a.id}`} className="ws-appcard-name">{a.name}</h2>
                <p className="ws-appcard-sub ws-clamp-2" title={a.blurb}>{a.blurb}</p>
              </article>
            </li>
          ))}
        </ul>

        <p className="ws-band">
          <WarningRegular aria-hidden="true" style={{ width: 18, height: 18 }} />
          Apps share one employee list, one company list and one sign-in. Adding an app never asks you to re-enter people.
        </p>
      </div>
    </div>
  );
}

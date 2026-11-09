import React, { useEffect, useState } from 'react';

import { ClorLogo, ClorMark } from '@ui/components/brand';

import { EXPLORE_TEXT, KNOWN_APPS, exchangeOnce, readLinkOnce } from './exploreLink';

/**
 * Explore (roadmap item 6): somebody who asked for a demo on clor.in looks
 * around a made-up company, read-only, for 14 days.
 *
 * Three pieces, all here:
 *  - ExploreLanding: app.clor.in/explore?t=<token>&app=<app>, the link in
 *    the mail and on the demo form's thank-you. The token leaves the address
 *    at once, is traded for a session (server: routes/explore.ts), and the
 *    page reloads into the app they asked for.
 *  - ExploreEnded: the link ran out or was ended, in plain words, with the
 *    way to ask for a demo.
 *  - ExploreNotice: the slim line under the bar on every screen while
 *    exploring, with the days left. The server refuses every change
 *    (middleware/exploreReadOnly.ts); this only says so first.
 */

export function ExploreLanding({ demoUrl }) {
  /* Read once per page load: the first read takes the token out of the address. */
  const [link] = useState(readLinkOnce);
  const [state, setState] = useState(link.token ? 'opening' : 'ended');

  useEffect(() => {
    const { token, app } = link;
    if (!token) return undefined;
    let off = false;
    exchangeOnce(token)
      .then((r) => {
        if (off) return;
        try {
          localStorage.setItem('token', r.token);
          /* Whatever company this browser chose before is not the sample's. */
          for (const store of [localStorage, sessionStorage]) for (const key of Object.keys(store)) if (key.startsWith('clor.sel.')) store.removeItem(key);
          sessionStorage.setItem('clor.explore', '1');
        } catch {
          /* storage unavailable: the reload below still has the refresh cookie */
        }
        const open = KNOWN_APPS.has(r.app) ? r.app : app;
        window.location.replace(open ? `/?app=${open}` : '/');
      })
      .catch((e) => {
        if (off) return;
        setState(e?.code === 'EXPLORE_ENDED' || e?.status === 410 ? 'ended' : 'failed');
      });
    return () => {
      off = true;
    };
  }, [link]);

  if (state === 'opening') {
    return (
      <div className="min-h-dvh grid place-items-center p-6" style={{ backgroundColor: 'rgb(var(--surface))' }}>
        <div className="grid justify-items-center gap-4 text-center" role="status">
          <ClorMark size={40} />
          <p className="ui-muted text-sm">Opening the sample company…</p>
        </div>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <ExploreEnded
        demoUrl={demoUrl}
        title="The sample company did not open"
        text="CLOR could not be reached just now. Try the link again in a minute."
      />
    );
  }
  return <ExploreEnded demoUrl={demoUrl} />;
}

export function ExploreEnded({ demoUrl, title = 'This link has ended', text = 'Links to the sample company work for 14 days. Ask for a demo and we will send you a new one, and show you CLOR with your own kind of work.' }) {
  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--surface))' }}>
      <header className="flex h-14 items-center px-4" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
        <a href={demoUrl.replace(/\/demo$/, '')} aria-label="CLOR, back to clor.in">
          <ClorLogo size={20} />
        </a>
      </header>
      <main className="mx-auto px-6 py-12 grid gap-4" style={{ maxWidth: '36rem' }}>
        <h1 className="ui-t-page">{title}</h1>
        <p className="ui-muted">{text}</p>
        <div className="flex flex-wrap gap-2">
          <a className="ui-btn ui-btn-primary" href={demoUrl}>Request a demo</a>
          <a className="ui-btn ui-btn-secondary" href="/signin">Sign in</a>
        </div>
      </main>
    </div>
  );
}

export function ExploreNotice({ explore, demoUrl }) {
  if (!explore) return null;
  const days = Number(explore.daysLeft);
  const left = Number.isFinite(days) ? (days <= 1 ? 'Last day' : `${days} days left`) : '';
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm"
      style={{ backgroundColor: 'rgb(var(--explore-soft))', borderBottom: '1px solid rgb(var(--explore-line))', borderLeft: '3px solid rgb(var(--explore-mark))', color: 'rgb(var(--fg))' }}
    >
      <span className="min-w-0 flex-1">{EXPLORE_TEXT}</span>
      {left ? <span className="tabular-nums" style={{ color: 'rgb(var(--explore-ink))' }}>{left}</span> : null}
      {/* TODO(explore): "Start your own company" once self-serve sign-up from Explore opens (roadmap). */}
      <a className="ui-btn ui-btn-secondary ui-btn-sm" href={demoUrl}>Request a demo</a>
    </div>
  );
}

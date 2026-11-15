import React from 'react';

import { ClorLogo } from '@ui/components/brand';
import LegalLinks from './legal/LegalLinks';

/**
 * The frame every stop between the door and the app sits in: two-factor setup,
 * a company this person cannot open, the first company's setup, a suspended
 * account, an ended sample link (owner, 15 Nov 2026: "wherever it redirects,
 * everything should look good").
 *
 * One frame so these pages read as part of CLOR rather than an app that failed
 * to draw: white ground, the logo where the app's bar would be, who is signed in
 * with a way out, one centred column, and the legal links at the foot.
 *
 * `icon`: a Lucide glyph for the tile above the title. `tone`: 'alert' inks the
 * tile in the negative colour, for a stop that is a problem rather than a step.
 * `who`: the signed-in person's email or name; with `onSignOut` the bar offers
 * Sign out. `size`: 'narrow' (a form), 'wide' (a choice of several cards).
 */
export default function GatePage({ icon: Icon, tone, eyebrow, title, subtitle, who, onSignOut, homeHref, size = 'narrow', children, labelledBy = 'gate-title' }) {
  const logo = <ClorLogo size={22} title={homeHref ? 'CLOR, back to clor.in' : 'CLOR'} />;
  return (
    <div className="ui-gate">
      <header className="ui-gate-bar">
        {homeHref ? <a href={homeHref} className="inline-flex">{logo}</a> : logo}
        <div className="flex-1" />
        {who ? <span className="ui-gate-who">{who}</span> : null}
        {onSignOut ? (
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onSignOut}>Sign out</button>
        ) : null}
      </header>

      <main id="main-content" className={`ui-gate-main ${size === 'wide' ? 'is-wide' : ''}`} aria-labelledby={labelledBy}>
        <div className="ui-gate-head">
          {Icon ? (
            <span className={`ui-gate-tile${tone === 'alert' ? ' is-alert' : ''}`} aria-hidden="true">
              <Icon size={18} />
            </span>
          ) : null}
          {eyebrow ? <p className="ui-gate-eyebrow">{eyebrow}</p> : null}
          <h1 id={labelledBy} className="ui-t-page">{title}</h1>
          {subtitle ? <p className="ui-gate-sub">{subtitle}</p> : null}
        </div>
        <div className="ui-gate-body">{children}</div>
      </main>

      <footer className="ui-gate-foot">
        <LegalLinks className="flex justify-center" />
        <p>© 2026 CLOR Applications Private Limited</p>
      </footer>
    </div>
  );
}

/**
 * A numbered step in a gate's short sequence. `state`: 'done' (a check, the
 * title and `summary`), 'current' (the title and its body), 'next' (the title, quiet).
 */
export function GateStep({ n, title, state, summary, last = false, children }) {
  return (
    <li className={`ui-gate-step is-${state}${last ? ' is-last' : ''}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="ui-gate-step-n" aria-hidden="true">{state === 'done' ? '✓' : n}</span>
      <div className="ui-gate-step-main">
        <p className="ui-gate-step-title">
          {title}
          <span className="sr-only">{state === 'done' ? ', done' : state === 'current' ? ', current step' : ', to do'}</span>
        </p>
        {state === 'done' && summary ? <p className="ui-gate-step-summary">{summary}</p> : null}
        {state === 'current' ? <div className="ui-gate-step-body">{children}</div> : null}
      </div>
    </li>
  );
}

import React from 'react';
import { BarChart3, TrendingUp, Users, Zap } from 'lucide-react';

import { ClorLogo } from '@ui/components/brand';
import LegalLinks from './legal/LegalLinks';

/**
 * The frame both sign-in and sign-up sit in.
 *
 * One layout rather than two, because the two pages are the same room with a
 * different form in it — and a sign-up that looked like a different product
 * would make somebody wonder whether they had followed the right link.
 *
 * The brand side is clor.in's own hero, so the step from the website into the
 * app does not change rooms: the warm ground and its orange glow, the same
 * headline, and the workspace illustration. It carries the platform claim, not
 * the accounting one — somebody signing in may be here for payroll alone.
 */

const POINTS = [
  { Icon: Users, text: 'Connect your teams' },
  { Icon: Zap, text: 'Streamline operations' },
  { Icon: BarChart3, text: 'Get real-time insights' },
  { Icon: TrendingUp, text: 'Scale as your business grows' },
];

/* The default brand side: clor.in's hero. A caller that is not the customer's door (the operator console) passes its own. */
function CustomerBrand() {
  return (
    <>
      <div className="ui-auth-copy">
        <p className="ui-auth-eyebrow">Your business. One workspace.</p>
        <h2 className="ui-auth-title">
          Every part of your business, working in <span className="ui-auth-accent">harmony.</span>
        </h2>
        <p className="ui-auth-lede">Connect your teams, streamline operations and grow — all in one place. Built for modern businesses.</p>
        <ul className="ui-auth-points">
          {POINTS.map(({ Icon, text }) => (
            <li key={text}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <img
        className="ui-auth-art"
        src="/brand/auth-workspace.webp"
        width="1000"
        height="562"
        alt="The Clor workspace on a laptop and a phone, with every app connected to it."
        decoding="async"
      />
    </>
  );
}

export default function AuthLayout({ title, subtitle, wide = false, onHome, children, footer, brand }) {
  return (
    <div className="ui-auth min-h-dvh">
      <div className="ui-min-h-viewport flex">
        <aside className="ui-auth-brand hidden lg:flex" aria-label="About Clor">
          <div className="ui-auth-brand-inner">
            <button type="button" onClick={onHome} className="text-left" aria-label="Clor, back to clor.in">
              <ClorLogo size={30} />
            </button>

            {brand || <CustomerBrand />}

            <p className="ui-caption">© 2026 Clor Applications Pvt Ltd</p>
          </div>
        </aside>

        <div className="relative flex-1 flex items-center justify-center px-6 py-10">
          <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
            <div className="lg:hidden mb-8 text-center">
              <button type="button" onClick={onHome} className="inline-flex items-center gap-2" aria-label="Clor, back to clor.in">
                <ClorLogo size={30} />
              </button>
            </div>

            <div className="ui-auth-card ui-in">
              <div className="mb-7">
                <h1 className="ui-auth-form-title">{title}</h1>
                <p className="ui-muted mt-2 text-sm">{subtitle}</p>
              </div>

              {children}
            </div>

            {footer ? <div className="mt-6 text-center text-sm">{footer}</div> : null}
            <LegalLinks className="mt-6 flex justify-center" />
          </div>
        </div>
      </div>
    </div>
  );
}

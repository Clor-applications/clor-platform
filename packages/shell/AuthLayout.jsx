import React from 'react';

import { ClorLogo } from '@ui/components/brand';
import LegalLinks from './legal/LegalLinks';

/**
 * The frame both sign-in and sign-up sit in.
 *
 * One layout rather than two, because the two pages are the same room with a
 * different form in it — and a sign-up that looked like a different product
 * would make somebody wonder whether they had followed the right link.
 *
 * The brand side carries the platform claim, not the accounting one. Somebody
 * signing in may be here for payroll and have no books at all.
 */

const Tick = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
  </svg>
);

const POINTS = [
  ['One sign-in, every app', 'Books, payroll and people behind the same door.'],
  ['A database for each app', 'Buying payroll does not give you a ledger you never asked for.'],
  ['They already know each other', 'Attendance closes the month into Payroll, and the pay run posts to Books.'],
];

export default function AuthLayout({ title, subtitle, wide = false, onHome, children, footer }) {
  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <div className="ui-min-h-viewport flex">
        {/* Light, like clor.in and the rest of the app: a quiet stone panel, not a dark brand wall. */}
        <div
          className="hidden lg:flex lg:w-[42%] relative"
          style={{ backgroundColor: 'rgb(var(--surface-sunken))', borderRight: '1px solid rgb(var(--border))' }}
        >
          <div className="p-12 flex flex-col w-full">
            <div>
              <button type="button" onClick={onHome} className="text-left" aria-label="Clor, back to clor.in">
                <ClorLogo size={28} />
              </button>

              <h2 className="ui-display mt-12 text-[2.5rem] leading-[1.08] max-w-[16ch]" style={{ color: 'rgb(var(--fg))' }}>
                Your books, people and payroll, on the same records.
              </h2>
              <p className="mt-5 leading-relaxed max-w-[46ch] ui-muted">
                Accounting, HR, payroll and attendance for Indian companies. Use one app, or use them together on one
                workspace and one sign-in.
              </p>

              <ul className="mt-8 space-y-4">
                {POINTS.map(([heading, body]) => (
                  <li key={heading} className="flex items-start gap-3.5">
                    <span
                      className="mt-0.5 w-6 h-6 rounded-lg grid place-items-center flex-shrink-0"
                      style={{ backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}
                      aria-hidden="true"
                    >
                      <Tick className="w-3.5 h-3.5" />
                    </span>
                    <span>
                      <span className="block font-medium text-[0.9375rem]">{heading}</span>
                      <span className="block text-sm mt-0.5 ui-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-auto pt-8 ui-caption">© 2026 Clor Applications Pvt Ltd</p>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center px-6 py-10">
          <div className="ui-ambient ui-ambient-quiet" aria-hidden="true" />

          <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
            <div className="lg:hidden mb-8 text-center">
              <button type="button" onClick={onHome} className="inline-flex items-center gap-2">
                <ClorLogo size={28} />
              </button>
            </div>

            <div className="ui-card p-8 ui-in">
              <div className="mb-7">
                <h1 className="ui-display text-[1.75rem]">{title}</h1>
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

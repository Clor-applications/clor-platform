import React from 'react';

import ClorMark from './ClorMark';
import AuthIllustration from '@ui/components/AuthIllustration';
import { useTilt } from '@ui/components/ui/useTilt';

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
  ['They already know each other', 'Payroll posts its journal into Accounting. Nobody exports a file.'],
];

export default function AuthLayout({ title, subtitle, wide = false, onHome, children, footer }) {
  const { ref, onPointerMove, onPointerLeave } = useTilt({ maxDeg: 7, scale: 1.02 });

  return (
    <div className="min-h-dvh" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
      <div className="ui-min-h-viewport flex">
        <div
          className="hidden lg:flex lg:w-[46%] relative overflow-hidden"
          style={{ backgroundColor: 'rgb(var(--brand-panel))' }}
        >
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              backgroundImage:
                'radial-gradient(38rem 24rem at 20% 10%, rgb(var(--brand) / 0.55), transparent 62%),' +
                'radial-gradient(30rem 20rem at 90% 85%, rgb(var(--accent) / 0.28), transparent 60%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.06]"
            aria-hidden="true"
            style={{ backgroundImage: 'repeating-linear-gradient(180deg, #fff 0 1px, transparent 1px 2.25rem)' }}
          />

          <div className="relative z-10 p-12 flex flex-col w-full text-white">
            <div>
              <button type="button" onClick={onHome} className="flex items-center gap-3 text-left">
                <ClorMark size={44} />
                <span>
                  <span className="ui-display text-2xl block">Clor</span>
                  <span className="text-white/55 text-xs tracking-wide">One platform. One set of records.</span>
                </span>
              </button>

              <h2 className="ui-display mt-10 text-[2.75rem] leading-[1.05] max-w-[16ch]">
                Run the business, not four programs.
              </h2>
              <p className="mt-5 text-white/65 leading-relaxed max-w-[46ch]">
                Accounting, Payroll, People and Projects on one platform — each with its own records,
                all behind one sign-in.
              </p>

              <ul className="mt-8 space-y-4">
                {POINTS.map(([heading, body]) => (
                  <li key={heading} className="flex items-start gap-3.5">
                    <span
                      className="mt-0.5 w-6 h-6 rounded-lg grid place-items-center ring-1 ring-white/15 flex-shrink-0"
                      aria-hidden="true"
                    >
                      <Tick className="w-3.5 h-3.5" />
                    </span>
                    <span>
                      <span className="block font-medium text-[0.9375rem]">{heading}</span>
                      <span className="block text-white/55 text-sm mt-0.5">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div
              ref={ref}
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              className="ui-tilt3d flex-1 min-h-[3rem] mt-8 flex items-end"
            >
              <AuthIllustration className="h-[clamp(8rem,24vh,17rem)] w-auto max-w-full select-none" />
            </div>

            <p className="mt-8 text-white/40 text-xs">© 2026 Clor · Your records stay on your server</p>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center px-6 py-10">
          <div className="ui-ambient ui-ambient-quiet" aria-hidden="true" />

          <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
            <div className="lg:hidden mb-8 text-center">
              <button type="button" onClick={onHome} className="inline-flex items-center gap-2">
                <ClorMark size={40} />
                <span className="ui-display text-xl">Clor</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}

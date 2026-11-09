import React from 'react';
import { Check } from '@ui/components/ui/lineIcons';
import { ClorLogo } from '@ui/components/brand';
import LegalLinks from './legal/LegalLinks';

/**
 * The frame both sign-in and sign-up sit in.
 *
 * One layout rather than two, because the two pages are the same room with a
 * different form in it — and a sign-up that looked like a different product
 * would make somebody wonder whether they had followed the right link.
 *
 * The brand side says plainly what CLOR does and shows a day in it. It
 * carries the platform claim, not the accounting one — somebody signing in may
 * be here for payroll alone. No slogan, accent word or decoration (owner,
 * 8 Nov 2026: drop what reads as machine-made).
 */

/* What a day in CLOR looks like: two things done, one waiting on you. */
const TODAY = [
  { text: 'GSTR-1 filed', done: true },
  { text: 'Salaries paid', done: true },
  { text: '2 leave requests', done: false },
];

/* The default brand side. A caller that is not the customer's door (the operator console) passes its own. */
function CustomerBrand() {
  return (
    <>
      <div className="ui-auth-copy">
        <h2 className="ui-auth-title">Accounts, GST, staff and salaries for small businesses in India.</h2>
      </div>

      <div className="ui-auth-today" aria-label="An example day">
        <p className="ui-auth-today-title">Today</p>
        <ul>
          {TODAY.map(({ text, done }) => (
            <li key={text} className={done ? undefined : 'is-waiting'}>
              {done ? <span className="ui-auth-today-done" aria-hidden="true"><Check size={12} strokeWidth={3} /></span> : <span className="ui-auth-today-ring" aria-hidden="true" />}
              <span>{text}</span>
              <span className="sr-only">{done ? ', done' : ', waiting on you'}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default function AuthLayout({ title, subtitle, wide = false, onHome, children, footer, brand }) {
  return (
    <div className="ui-auth min-h-dvh">
      <div className="ui-min-h-viewport flex">
        <aside className={`ui-auth-brand hidden lg:flex${brand ? '' : ' is-board'}`} aria-label="About CLOR">
          <div className="ui-auth-brand-inner">
            <button type="button" onClick={onHome} className="text-left">
              <ClorLogo size={30} title="CLOR, back to clor.in" />
            </button>

            {brand || <CustomerBrand />}

            <p className="ui-caption">© 2026 Clor Applications Pvt Ltd</p>
          </div>
        </aside>

        <div className="relative flex-1 flex items-center justify-center px-6 py-10">
          <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
            <div className="lg:hidden mb-8 text-center">
              <button type="button" onClick={onHome} className="inline-flex items-center gap-2">
                <ClorLogo size={30} title="CLOR, back to clor.in" />
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

import React from 'react';
import { ArrowSquareOut, CalendarX, CaretRight, Receipt, Wallet } from '@phosphor-icons/react';

import { PanelHead, rupees } from './bits';

/* Each link's mark tinted by meaning: clay for exceptions to correct, violet for pay records, green for money out to people. */
const LOOK = { shiftExceptions: { icon: CalendarX, tint: 'peach' }, lossOfPay: { icon: Wallet, tint: 'lilac' }, reimbursements: { icon: Receipt, tint: 'mint' } };

/**
 * Across the apps (owner's suite spec, 5–6 Nov 2026): Attendance's shift exceptions, Payroll's loss of pay before
 * the month's run is locked, and reimbursements to pay or to enter in the books. A link to another app opens it.
 */
export default function AppLinks({ links, openScreen }) {
  if (!links?.length) return null;
  return (
    <section aria-labelledby="apps-h">
      <PanelHead id="apps-h" icon={ArrowSquareOut} tint="sky" title="Across your apps" />
      <ul className="people-list">
        {links.map((l) => {
          const { icon: Icon, tint } = LOOK[l.key] || LOOK.shiftExceptions;
          const body = (
            <>
              <span className="home-mark" data-tint={tint}><Icon size={16} weight="duotone" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2"><span className="text-sm font-medium">{l.title}</span><b className="home-link-count tabular-nums" data-zero={l.count === 0 || undefined}>{l.count}</b></span>
                <span className="ui-caption block">{l.detail}{l.amount ? <> · <span className="tabular-nums">{rupees(l.amount)}</span> to pay</> : null}</span>
              </span>
              {l.app ? <ArrowSquareOut size={16} className="ui-subtle shrink-0" aria-label={`Opens ${l.app === 'payroll' ? 'Payroll' : 'Attendance'}`} /> : <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />}
            </>
          );
          return (
            <li key={l.key}>
              {l.app
                ? <a className="people-row people-row-action" href={`?app=${l.app}&open=${encodeURIComponent(l.screen)}`}>{body}</a>
                : <button type="button" className="people-row people-row-action" onClick={() => openScreen?.(l.screen, l.params)}>{body}</button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

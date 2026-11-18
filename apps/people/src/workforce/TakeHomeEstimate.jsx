import React from 'react';
import { takeHome } from '@ui/picks/round44';
import { wholeRupees as money } from '@ui/utils/money';

/**
 * Round 44 "takehomecalc" A: the yearly CTC typed on an offer, worked into
 * the money in hand each month. An estimate: half the pay as basic, PF on it
 * up to ₹15,000, ₹200 professional tax and new-regime tax.
 */
export default function TakeHomeEstimate({ ctc }) {
  const t = takeHome(ctc);
  if (!t) return null;
  return (
    <div className="ui-takehome" role="status">
      <p className="tabular-nums"><span className="ui-muted">Net pay, about</span> <b>{money(t.rounded)} a month</b></p>
      <p className="ui-caption tabular-nums">
        {money(t.gross)} gross − {money(t.pf)} PF − {money(t.pt)} professional tax{t.tax ? ` − ${money(t.tax)} income tax` : ', no income tax'}.
        {' '}An estimate on the new tax regime; the payslip works out the exact figure.
      </p>
    </div>
  );
}

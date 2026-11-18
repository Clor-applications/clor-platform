import React, { useEffect, useState } from 'react';
import { compareRegimes, cappedDeductions } from './regimeTax';
import { getPayslips } from './portalApi';

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * Old and new regime worked out side by side, the lower one marked, with a
 * button to pick it (round 39, taxregime A). The yearly salary starts from the
 * latest payslip's earnings times twelve and can be changed. An estimate:
 * payroll works out the exact tax on each payslip.
 */
export default function TaxCompare({ guard, items, declared, senior, regime, onPick, disabled }) {
  const [yearly, setYearly] = useState('');
  useEffect(() => {
    let live = true;
    const ask = guard ? guard(getPayslips()) : getPayslips();
    Promise.resolve(ask)
      .then((d) => {
        const latest = d?.available && Array.isArray(d.slips) ? d.slips.find((s) => Number(s.gross) > 0) : null;
        if (live && latest) setYearly((y) => (y === '' ? String(Math.round(Number(latest.gross) * 12)) : y));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [guard]);

  const amount = Number(yearly) || 0;
  const result = amount > 0 ? compareRegimes(amount, cappedDeductions(items, declared, { senior }), { senior }) : null;
  const name = (r) => (r === 'OLD' ? 'Old' : 'New');

  return (
    <div className="ui-tax-compare" role="group" aria-label="Old and new regime compared">
      <label className="block">
        <span className="ui-label">Your salary for the year, before tax</span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          className="ui-input ui-num w-full"
          value={yearly}
          onChange={(e) => setYearly(e.target.value)}
          disabled={disabled}
        />
      </label>
      {result ? (
        <>
          <div className="ui-tax-compare-rows">
            {['OLD', 'NEW'].map((r) => (
              <div key={r} className={`ui-tax-compare-row${result.lower === r ? ' is-lower' : ''}`}>
                <span>{name(r)} regime</span>
                <span className="tabular-nums">{rupees(r === 'OLD' ? result.old : result.new)}</span>
              </div>
            ))}
          </div>
          <p className="ui-caption" role="status">
            {result.lower
              ? `${name(result.lower)} saves you about ${rupees(result.saves)} this year.`
              : 'Both come to the same tax this year.'}{' '}
            About, on this salary and what you declared; payroll works out the exact tax.
          </p>
          {result.lower && result.lower !== regime && !disabled ? (
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onPick(result.lower)}>
              Use the {name(result.lower).toLowerCase()} regime
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

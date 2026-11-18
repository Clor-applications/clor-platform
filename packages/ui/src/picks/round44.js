/*
 * Round 44 picks (18 Nov 2026), money for staff. Plain helpers, no server:
 * - takehomecalc A: a yearly CTC worked into the money in hand each month.
 * - payrollcalendar A: the month's payroll steps with the days left to pay.
 */

/* New tax regime slabs (yearly taxable income, rate), with the ₹75,000
   standard deduction and the section 87A rebate up to ₹12,00,000. */
const SLABS = [
  [400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3],
];
const STANDARD_DEDUCTION = 75000;
const REBATE_LIMIT = 1200000;
const PF_WAGE_CAP = 15000;
const PT_MONTHLY = 200;

function slabTax(taxable) {
  let tax = 0;
  let from = 0;
  for (const [upTo, rate] of SLABS) {
    if (taxable <= from) break;
    tax += (Math.min(taxable, upTo) - from) * rate;
    from = upTo;
  }
  return tax;
}

/** Yearly income tax under the new regime: rebate, marginal relief, 4% cess. Surcharge left out. */
export function newRegimeTax(yearlyGross) {
  const taxable = Math.max(0, yearlyGross - STANDARD_DEDUCTION);
  let tax = slabTax(taxable);
  if (taxable <= REBATE_LIMIT) tax = 0;
  else tax = Math.min(tax, taxable - REBATE_LIMIT); // marginal relief just above the rebate limit
  return Math.round(tax * 1.04);
}

/**
 * Monthly take-home from a yearly CTC, as an estimate. Basic is half the
 * monthly pay; the company's PF (12% of basic up to ₹15,000) sits inside the
 * CTC and the same is taken from pay; ₹200 professional tax; new-regime tax.
 */
export function takeHome(annualCtc) {
  const ctc = Number(String(annualCtc ?? '').replace(/,/g, ''));
  if (!Number.isFinite(ctc) || ctc <= 0) return null;
  const monthly = ctc / 12;
  let basic = 0.5 * (monthly - 0.12 * PF_WAGE_CAP);
  if (basic < PF_WAGE_CAP) basic = (0.5 * monthly) / 1.06;
  const pf = Math.round(0.12 * Math.min(basic, PF_WAGE_CAP));
  const gross = Math.round(monthly - pf);
  const tax = Math.round(newRegimeTax(gross * 12) / 12);
  const pt = gross > 0 ? PT_MONTHLY : 0;
  const net = Math.max(0, gross - pf - pt - tax);
  return { monthly: Math.round(monthly), gross, pf, pt, tax, net, rounded: Math.round(net / 100) * 100 };
}

const dayMs = 86400000;
const toUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const daysBetween = (fromIso, toIso) => Math.round((toUtc(toIso) - toUtc(fromIso)) / dayMs);

/**
 * The month's payroll steps for the overview strip: inputs close (the period's
 * last day), run and review, approve, pay (the period's pay date). Each step is
 * done, now or next, from the run's status.
 */
export function payCalendar(period, run, today) {
  if (!period) return null;
  const status = run?.status || '';
  let at;
  if (['PAID', 'POSTED'].includes(status)) at = 4;
  else if (['APPROVED', 'LOCKED'].includes(status)) at = 3;
  else if (['DRAFT', 'CALCULATED', 'REVIEW'].includes(status)) at = 1;
  else at = period.endDate && today > period.endDate ? 1 : 0;
  const steps = [
    { key: 'inputs', label: 'Inputs close', date: period.endDate || null },
    { key: 'review', label: 'Run and review', date: null },
    { key: 'approve', label: 'Approve', date: null },
    { key: 'pay', label: 'Pay', date: period.paymentDate || null },
  ].map((s, i) => ({ ...s, state: i < at ? 'done' : i === at ? 'now' : 'next' }));
  let left = '';
  let late = false;
  if (at < 4 && period.paymentDate) {
    const d = daysBetween(today, period.paymentDate);
    late = d < 0;
    left = d > 1 ? `Pay in ${d} days` : d === 1 ? 'Pay tomorrow' : d === 0 ? 'Pay today' : `Pay was due ${-d} day${d === -1 ? '' : 's'} ago`;
  } else if (at === 4) left = 'Paid';
  return { steps, left, late };
}

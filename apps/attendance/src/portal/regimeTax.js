/**
 * Old and new regime side by side (round 39, pick taxregime A), for the
 * employee's own tax form. An estimate on a year's salary and the deductions
 * typed in the form: standard deduction, slabs, rebate with the new regime's
 * marginal relief, and 4% cess. Payroll's own engine (server statutory/engine)
 * still works out the tax on each payslip; surcharge, rent allowance and
 * professional tax are left out here, so the screen says "about".
 *
 * Figures are the FY 2025–26 ones: new regime ₹75,000 standard deduction,
 * nil to ₹4 lakh, then 5% steps every ₹4 lakh to 30% above ₹24 lakh, rebate
 * up to ₹12 lakh taxable; old regime ₹50,000, nil to ₹2.5 lakh (₹3 lakh at
 * 60 or older), 5%, 20%, 30%, rebate up to ₹5 lakh.
 */

const NEW_BANDS = [
  [400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30],
];
const OLD_BANDS = [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]];
const OLD_SENIOR_BANDS = [[300000, 0], [500000, 5], [1000000, 20], [Infinity, 30]];

function slabTax(bands, income) {
  let tax = 0;
  let previous = 0;
  for (const [ceiling, rate] of bands) {
    if (income <= previous) break;
    tax += ((Math.min(income, ceiling) - previous) * rate) / 100;
    previous = ceiling;
  }
  return tax;
}

/** Tax for a year under one regime, rounded to the rupee. */
export function regimeTax(regime, yearly, deductions = 0, { senior = false } = {}) {
  const income = Math.max(0, Number(yearly) || 0);
  if (regime === 'NEW') {
    const taxable = Math.max(0, income - 75000);
    let tax = slabTax(NEW_BANDS, taxable);
    if (taxable <= 1200000) tax = Math.max(0, tax - 60000);
    else tax = Math.min(tax, taxable - 1200000);
    return Math.round(tax * 1.04);
  }
  const taxable = Math.max(0, income - 50000 - Math.max(0, Number(deductions) || 0));
  let tax = slabTax(senior ? OLD_SENIOR_BANDS : OLD_BANDS, taxable);
  if (taxable <= 500000) tax = Math.max(0, tax - 12500);
  return Math.round(tax * 1.04);
}

/** What the old regime lets off: each declared item, at most its cap. */
export function cappedDeductions(items = [], declared = {}, { senior = false } = {}) {
  return items.reduce((sum, i) => {
    const v = Math.max(0, Number(declared[i.code]) || 0);
    const cap = senior && i.seniorCap ? i.seniorCap : i.cap;
    return sum + (cap ? Math.min(v, cap) : v);
  }, 0);
}

/** Both regimes and which is lower: { old, new, lower: 'OLD'|'NEW'|null, saves }. */
export function compareRegimes(yearly, deductions, opts) {
  const oldTax = regimeTax('OLD', yearly, deductions, opts);
  const newTax = regimeTax('NEW', yearly, 0, opts);
  const lower = oldTax === newTax ? null : oldTax < newTax ? 'OLD' : 'NEW';
  return { old: oldTax, new: newTax, lower, saves: Math.abs(oldTax - newTax) };
}

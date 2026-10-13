import { round2 } from './money';
/**
 * TDS on a sales invoice.
 *
 * On the sell side TDS is not a tax the business charges — it is tax the
 * *customer* withholds from the payment and deposits against the seller's PAN.
 * So it never changes the invoice: the goods, the GST and the total are what
 * they were, and what moves is how much cash arrives. The document states the
 * deduction so both sides agree on the figure before the payment is short.
 *
 * That distinction matters in the ledger too. Reducing the invoice total by
 * the TDS would understate output GST and lose the receivable; the deduction
 * is a separate asset — tax already paid on the seller's behalf — that is
 * claimed against the year's liability.
 *
 * The base is the taxable value, not the total. CBDT Circular 23/2017: where
 * GST on services is shown separately on the invoice, tax is deducted on the
 * amount excluding that GST.
 */

/**
 * The sections a sales invoice actually meets.
 *
 * Three things every entry carries, because leaving any of them out produced a
 * wrong number:
 *
 *   `rate` / `rateIndividual`
 *       194C is 1% where the payee is an individual or a HUF and 2% for
 *       everyone else, and the app charged 2% for all of them. 194J is not one
 *       rate at all: technical services, call centre and royalty are 2%, and
 *       professional services are 10%. Carrying a single "professional or
 *       technical @ 10%" entry meant every technical-services deduction was
 *       five times what was due.
 *
 *   `single` / `annual`
 *       The thresholds. Nothing is deducted below them, and the app had no
 *       notion of them at all — it would deduct 10% on a 5,000 rupee
 *       professional bill where nothing is owed until 50,000.
 *
 *   `wholeOnceCrossed`
 *       How the threshold behaves when it is crossed, which differs by section
 *       and is the part that is easy to get backwards. For 194C, 194J, 194H,
 *       194I and 194A the deduction applies to the WHOLE aggregate once the
 *       limit is passed, earlier payments included — five payments of 25,000
 *       cross the 1,00,000 annual limit and TDS is due on all 1,25,000. For
 *       194Q only the EXCESS over 50 lakh is charged.
 *
 * Rates remain defaults, not law for every case: a certificate under section
 * 197 overrides everything, and no PAN means 20%. The rate stays editable and
 * the section only seeds it.
 *
 * Codes are the familiar pre-2026 ones. From 1 April 2026 the Income-tax Act
 * 2025 consolidates TDS under section 393 and TCS under 394 — rates and
 * thresholds unchanged — so `newAct` carries the reference a FY 2026-27 return
 * needs alongside the code everyone still says out loud.
 */

export const TDS_SECTIONS = [
  {
    code: '194C',
    label: 'Contractor / sub-contractor',
    rate: 2,
    rateIndividual: 1,
    single: 30000,
    annual: 100000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 6(i)',
  },
  {
    code: '194J(a)',
    label: 'Technical services, call centre, royalty',
    rate: 2,
    annual: 50000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 6(iii).D(a)',
  },
  {
    code: '194J(b)',
    label: 'Professional services',
    rate: 10,
    annual: 50000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 6(iii).D(b)',
  },
  {
    code: '194H',
    label: 'Commission or brokerage',
    rate: 2,
    annual: 20000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 1(ii)',
  },
  {
    code: '194I(a)',
    label: 'Rent — plant, machinery, equipment',
    rate: 2,
    monthly: 50000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 2(ii).D(a)',
  },
  {
    code: '194I(b)',
    label: 'Rent — land, building, furniture',
    rate: 10,
    monthly: 50000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 2(ii).D(b)',
  },
  {
    code: '194A',
    label: 'Interest other than on securities',
    rate: 10,
    annual: 50000,
    wholeOnceCrossed: true,
    newAct: '393(1) Table 5(ii)',
  },
  {
    code: '194T',
    label: 'Partner salary, remuneration or interest',
    rate: 10,
    annual: 20000,
    wholeOnceCrossed: true,
    newAct: '393(3) Table 7',
  },
  {
    code: '194Q',
    label: 'Purchase of goods',
    rate: 0.1,
    annual: 5000000,
    /* Only the excess over 50 lakh, never the whole. */
    wholeOnceCrossed: false,
    newAct: '393(1) Table 8(ii)',
  },
];

/** A payee who is an individual or a HUF is charged less under 194C. */
export const DEDUCTEE_TYPES = [
  { key: 'COMPANY', label: 'Company, firm or other' },
  { key: 'INDIVIDUAL', label: 'Individual or HUF' },
];

export const tdsSection = (code) =>
  TDS_SECTIONS.find((s) => s.code === String(code || '').trim()) || null;

/**
 * The rate a section defaults to for this kind of payee, or 0 when the code is
 * not one we carry. Only 194C differs by payee today, but the shape is the
 * question the law asks, so it is asked for every section.
 */
export const tdsDefaultRate = (code, deducteeType = 'COMPANY') => {
  const s = tdsSection(code);
  if (!s) return 0;
  if (deducteeType === 'INDIVIDUAL' && s.rateIndividual != null) return Number(s.rateIndividual);
  return Number(s.rate ?? 0);
};

/** Whether the payee type changes anything for this section, for the form. */
export const tdsVariesByDeductee = (code) => tdsSection(code)?.rateIndividual != null;

/**
 * Whether the threshold has been passed, given what this party has already been
 * paid under this section in the financial year.
 *
 * `paidSoFar` excludes the document being entered. A section with a single-bill
 * limit is crossed by either test: one bill above `single`, or an aggregate
 * above `annual`.
 *
 * @returns {{ crossed: boolean, base: number, reason: string }}
 *   `base` is the amount TDS is actually charged on, which is the whole
 *   aggregate for most sections and only the excess for 194Q.
 */
export const tdsThresholdState = (code, thisDocValue, paidSoFar = 0) => {
  const s = tdsSection(code);
  const value = Number(thisDocValue) || 0;
  const prior = Number(paidSoFar) || 0;
  if (!s) return { crossed: false, base: 0, reason: 'Unknown section' };

  const aggregate = round2(prior + value);
  const limit = Number(s.annual ?? s.monthly ?? 0);
  const single = Number(s.single ?? 0);

  const bySingle = single > 0 && value > single;
  const byAggregate = limit > 0 && aggregate > limit;
  if (!bySingle && !byAggregate) {
    const short = round2(limit - aggregate);
    return {
      crossed: false,
      base: 0,
      reason: limit ? `Below the ${s.code} limit — ${short.toFixed(2)} of headroom left this year` : 'No threshold',
    };
  }

  if (!s.wholeOnceCrossed) {
    // 194Q: only what sits above the limit is charged.
    const excess = Math.max(0, round2(aggregate - limit));
    return { crossed: excess > 0, base: Math.min(excess, value), reason: `${s.code} — on the excess over the limit` };
  }

  /*
   * Once crossed, the whole aggregate is liable, earlier payments included. On
   * the document that crosses it, that means deducting on this value plus
   * everything already paid without deduction.
   */
  return {
    crossed: true,
    base: prior > 0 ? aggregate : value,
    reason: bySingle && !byAggregate ? `${s.code} — single bill above the limit` : `${s.code} — annual limit crossed`,
  };
};


/**
 * What the customer will withhold.
 *
 * @param taxableValue the invoice's taxable amount — after any invoice-level
 *        discount and including other charges, but before GST
 * @param rate percent
 */
export const tdsAmountOn = (taxableValue, rate) => {
  const base = Number(taxableValue) || 0;
  const pct = Number(rate) || 0;
  if (base <= 0 || pct <= 0) return 0;
  return round2((base * pct) / 100);
};

/** "194J · Professional or technical services @ 10%" */
export const tdsLabel = (code, rate) => {
  const s = tdsSection(code);
  const pct = Number(rate) || 0;
  if (!s) return pct ? `TDS @ ${pct}%` : 'TDS';
  return `${s.code} · ${s.label} @ ${pct}%`;
};

/** The short form a totals row and a printed document use. */
export const tdsShortLabel = (code, rate) => {
  const pct = Number(rate) || 0;
  const c = String(code || '').trim();
  return c ? `TDS ${c} @ ${pct}%` : `TDS @ ${pct}%`;
};

export default TDS_SECTIONS;

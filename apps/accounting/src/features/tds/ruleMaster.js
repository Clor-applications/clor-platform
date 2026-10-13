import { TDS_SECTIONS } from '@ui/utils/tds';

/**
 * The TDS rule master: what the law says, and when it said it.
 *
 * The architecture the specification insists on is a separation the code did
 * not have. A ledger answers WHERE a deduction is posted. A rule answers WHY
 * it applies, at WHAT rate, above WHICH threshold and under WHICH statutory
 * reference. Until now the only tax data was a flat section list read at the
 * moment a form rendered, so "what rate did we deduct at in June" could only
 * be answered by whatever the list says today.
 *
 * Two things follow from that, and they are the whole of this file:
 *
 *   A nature is stable. CONTRACTOR is CONTRACTOR for ever, whatever the Act
 *   calls it this year, because every posted deduction, every report and every
 *   ledger mapping points at it.
 *
 *   A rule is versioned by effective date. Rates, thresholds and section
 *   references change; a posted transaction keeps the version it was computed
 *   under. Nothing here is ever edited in place.
 *
 * The rates and thresholds are not invented here: they come from the section
 * master the deduction engine already used, so there remains exactly one place
 * in the product where a rate is written down.
 */

/**
 * When the Income-tax Act, 2025 takes over.
 *
 * Up to 31 March 2026 a deduction is made under the familiar section — 194C,
 * 194J(b). From 1 April 2026 the same deduction is made under the consolidated
 * section 393 reference, at unchanged rates and thresholds. Which of the two a
 * transaction carries is decided by the transaction's own date and never by
 * today's calendar: a bill dated last March, entered next week, is still a
 * bill under the old Act.
 */
export const NEW_ACT_FROM = '2026-04-01';

/** Far enough back to cover any book this product will ever open. */
const OPEN_FROM = '2000-04-01';

const day = (v) => String(v || '').slice(0, 10);

/**
 * The FROZEN internal identity of each nature.
 *
 * A nature code is a primary business identifier: every posted event, every
 * ledger mapping and every party default stores one, for ever. It used to be
 * derived from the section's display label — which meant renaming a label
 * silently reissued the identifier and orphaned everything that pointed at
 * the old one. That is exactly what "do not use visible names as primary
 * identifiers" forbids, one string-transform removed.
 *
 * So the codes are frozen here as literals, keyed by the statutory section
 * (itself stable). The values are today's derived spellings, kept verbatim —
 * "prettier" codes would orphan the very data the freeze protects. Rename a
 * label freely; the code does not move. A NEW section must be given a code
 * here deliberately (the fallback derivation below only keeps an unmapped
 * dev build rendering — the master test refuses to ship one).
 */
export const NATURE_CODES = {
  '194C': 'CONTRACTOR_SUB_CONTRACTOR',
  '194J(a)': 'TECHNICAL_SERVICES_CALL_CENTRE_ROYALTY',
  '194J(b)': 'PROFESSIONAL_SERVICES',
  '194H': 'COMMISSION_OR_BROKERAGE',
  '194I(a)': 'RENT_PLANT_MACHINERY_EQUIPMENT',
  '194I(b)': 'RENT_LAND_BUILDING_FURNITURE',
  '194A': 'INTEREST_OTHER_THAN_ON_SECURITIES',
  '194T': 'PARTNER_SALARY_REMUNERATION_OR_INTEREST',
  '194Q': 'PURCHASE_OF_GOODS',
};

const natureCodeFor = (section) =>
  NATURE_CODES[String(section?.code || '').trim()] ||
  /* Unmapped section: derive so a dev build still renders — the master test
     fails the build until a literal code is assigned above. */
  String(section?.label || section?.code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/**
 * The natures a company deducts under.
 *
 * One per section the engine knows, with a stable code of its own. The list is
 * derived rather than typed so a section added to the master appears here too,
 * instead of in one of two lists that then disagree.
 */
export const TDS_NATURES = TDS_SECTIONS.map((s) => ({
  code: natureCodeFor(s),
  name: s.label,
  /* What people still say out loud, and what the returns still print. */
  legacySection: s.code,
  active: true,
}));

/*
 * §29 — the masters are FROZEN at load, not merely pinned by tests. A rule
 * version referenced by a posted transaction must never change meaning; with
 * these three deep-frozen, an attempted in-place edit throws where it
 * happens instead of silently restating history. Changes ship as NEW
 * versions appended to the source.
 */
const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};
deepFreeze(NATURE_CODES);
deepFreeze(TDS_NATURES);

export const natureByCode = (code) =>
  TDS_NATURES.find((n) => n.code === String(code || '').trim().toUpperCase()) || null;

/** The nature a legacy section code belongs to — for rows written before this. */
export const natureForSection = (sectionCode) => {
  const want = String(sectionCode || '').trim();
  if (!want) return null;
  const section = TDS_SECTIONS.find((s) => s.code === want);
  return section ? natureByCode(natureCodeFor(section)) : null;
};

/**
 * Every rule version, both sides of the 2026 boundary.
 *
 * Two versions per nature today: the same rate and threshold under the old
 * Act's section, and under the new Act's reference from 1 April 2026.
 *
 * CRITICAL — historical rules are never overwritten. A change to the rate,
 * the threshold, the section reference or the ledger mapping is a NEW
 * version with its own effective window; the old version keeps its id and
 * its figures for ever, because posted TDS records name that id and must
 * replay under it. ruleVersioning.test.js pins the shipped payloads — an
 * in-place edit fails the build; only appending a version passes.
 *
 * Field map against the specification: natureCode (internal nature code),
 * historicalSection (the pre-2026 section), statutoryReference (current),
 * sectionCode (section / reporting code), rate + rateIndividual (deductee
 * category rates — read via ruleDeducteeRates), single/annual/monthly +
 * wholeOnceCrossed (threshold), calculationBase, deductionTrigger,
 * returnCategory, effectiveFrom/To, active. Ledger mapping is realized per
 * company through the chart (ruleLedgerMapping in the engine): the ledgers
 * are company data and cannot live in a statutory master, and every posted
 * event snapshots the ledger it actually used alongside the version id.
 */
export const TDS_RULE_VERSIONS = TDS_SECTIONS.flatMap((s) => {
  const code = natureCodeFor(s);
  const shared = {
    natureCode: code,
    /* The section the deduction was historically made under — stable even
       after the 2026 Act renames the current reference. */
    historicalSection: s.code,
    rate: Number(s.rate ?? 0),
    rateIndividual: s.rateIndividual == null ? null : Number(s.rateIndividual),
    /* Thresholds, as the section master states them. */
    single: s.single ?? null,
    annual: s.annual ?? null,
    monthly: s.monthly ?? null,
    wholeOnceCrossed: s.wholeOnceCrossed !== false,
    /* The base is the taxable value, not the invoice total — CBDT Circular
       23/2017, where GST is shown separately. */
    calculationBase: 'TAXABLE_VALUE',
    /* Credit or payment, whichever is earlier: the deduction is due at the
       bill, and a payment against a bill already deducted does not deduct
       again. The engine enforces that; the rule states it. */
    deductionTrigger: 'CREDIT_OR_PAYMENT_EARLIER',
    active: true,
  };
  return [
    {
      ...shared,
      id: `${code}@V1`,
      version: 1,
      statutoryReference: s.code,
      sectionCode: s.code,
      returnCategory: '26Q',
      effectiveFrom: OPEN_FROM,
      effectiveTo: '2026-03-31',
    },
    {
      ...shared,
      id: `${code}@V2`,
      version: 2,
      /* Same deduction, consolidated reference. */
      statutoryReference: s.newAct || s.code,
      sectionCode: s.code,
      returnCategory: '26Q',
      effectiveFrom: NEW_ACT_FROM,
      effectiveTo: null,
    },
  ];
});

deepFreeze(TDS_RULE_VERSIONS);

/**
 * The rule in force for a nature on a date.
 *
 * The date is the transaction's, always. Resolving from `new Date()` is the
 * bug this signature exists to prevent: it would restate a March bill under an
 * April section the moment the year turned.
 */
export const resolveRule = (natureCode, onDate, { rules = TDS_RULE_VERSIONS } = {}) => {
  const code = String(natureCode || '').trim().toUpperCase();
  const d = day(onDate);
  if (!code || !d) return null;
  const candidates = rules
    .filter((r) => r.active !== false)
    .filter((r) => r.natureCode === code)
    .filter((r) => day(r.effectiveFrom) <= d)
    .filter((r) => !r.effectiveTo || day(r.effectiveTo) >= d);
  if (!candidates.length) return null;
  /* Newest applicable version wins where two overlap — a correction issued
     later for the same window is the one that stands. */
  return candidates.slice().sort((a, b) => b.version - a.version)[0];
};

/** The rule version a posted transaction named, by id, for report headings. */
export const ruleById = (id, { rules = TDS_RULE_VERSIONS } = {}) =>
  rules.find((r) => r.id === String(id || '')) || null;

/**
 * The rate this rule applies to this payee.
 *
 * 194C is 1% for an individual or HUF and 2% for everyone else; every other
 * section carries one rate. A certificate under section 197, or a missing PAN,
 * overrides both — that is the party's business, not the rule's, and it is
 * applied by the engine.
 */
export const ruleRate = (rule, deducteeType = 'COMPANY') => {
  if (!rule) return 0;
  if (deducteeType === 'INDIVIDUAL' && rule.rateIndividual != null) return Number(rule.rateIndividual);
  return Number(rule.rate ?? 0);
};

/** "194C" before April 2026, "393(1) Table 6(i)" after — for display. */
export const ruleReference = (rule) => String(rule?.statutoryReference || rule?.sectionCode || '');

/** The rule's rate per deductee category, as the master states them. */
export const ruleDeducteeRates = (rule) => {
  if (!rule) return [];
  const rows = [{ category: 'COMPANY', rate: Number(rule.rate ?? 0) }];
  if (rule.rateIndividual != null) rows.push({ category: 'INDIVIDUAL', rate: Number(rule.rateIndividual) });
  return rows;
};

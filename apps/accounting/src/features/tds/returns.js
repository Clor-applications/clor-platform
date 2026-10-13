import { companyTdsProfile } from './engine';
import { natureByCode } from './ruleMaster';
import { allocationsByEvent, isLive, tdsEvents, tdsExceptions, tdsReconciliation } from './reports';

/**
 * Is this quarter fit to file?
 *
 * The specification's V1 stops short of filing — no portal, no TRACES — and
 * that is the right boundary. What it does not stop short of is knowing: a
 * quarter is either complete or it is not, and the difference is a handful of
 * checks somebody would otherwise do by eye, in a spreadsheet, in April.
 *
 * So this answers two questions and nothing else. What stands in the way, and
 * what the return would say if it were filed today.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (v) => String(v || '').slice(0, 10);

/** A PAN that the department will actually accept. */
const isValidPan = (pan) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan || '').trim().toUpperCase());

/**
 * Every check the quarter has to pass, with what failing each one means.
 *
 * BLOCK is "this cannot be filed": a deduction with no section, no ledger or
 * no rule cannot be described to the department at all. WARNING is "this can
 * be filed and will be queried" — a missing PAN is the deductee's problem
 * arriving as ours. INFO is a note for the person doing the work.
 */
export const quarterValidation = (db, companyId, quarter) => {
  const profile = companyTdsProfile(db?.companies?.find?.((c) => Number(c?.id) === Number(companyId)) || null);
  const events = tdsEvents(db, companyId, { quarter, side: 'PAYABLE' }).filter(isLive);
  const allocations = allocationsByEvent(db, companyId);
  const problems = [];

  const add = (severity, code, message, eventId = null) =>
    problems.push({ severity, code, message, eventId });

  if (!quarter) add('BLOCK', 'NO_QUARTER', 'Choose the quarter to validate.');
  if (!events.length) add('INFO', 'EMPTY', 'Nothing was deducted in this quarter.');

  /* The deductor, before the deductees. A return with no TAN is not a return. */
  if (!String(profile.tan || '').trim()) {
    add('BLOCK', 'NO_TAN', 'The company has no TAN. Settings → Tax compliances.');
  }
  if (!String(profile.deductorName || '').trim()) {
    add('WARNING', 'NO_DEDUCTOR_NAME', 'No deductor name is recorded; the challan and the return both carry one.');
  }

  for (const e of events) {
    const who = e.partyName || `party ${e.partyId}`;
    if (!String(e.sectionCode || '').trim()) {
      add('BLOCK', 'NO_SECTION', `${who}: no section was recorded for this deduction.`, e.id);
    }
    if (!String(e.ruleVersionId || '').trim()) {
      add('BLOCK', 'NO_RULE', `${who}: no rule version, so the rate cannot be proved.`, e.id);
    }
    if (!String(e.ledgerId || '').trim()) {
      add('BLOCK', 'NO_LEDGER', `${who}: the deduction is not posted to any ledger.`, e.id);
    }
    if (!isValidPan(e.panSnapshot)) {
      add(
        'WARNING',
        'PAN_INVALID',
        String(e.panSnapshot || '').trim()
          ? `${who}: the PAN recorded at deduction is not a valid PAN.`
          : `${who}: no PAN was recorded at deduction.`,
        e.id
      );
    }
    if (Number(e.tdsAmount || 0) <= 0) {
      add('WARNING', 'ZERO_AMOUNT', `${who}: the deduction is zero.`, e.id);
    }
    const paid = allocations.for(e.id);
    if (paid <= 0) {
      add('WARNING', 'UNPAID', `${who}: deducted but not yet paid to the department.`, e.id);
    } else if (paid < Number(e.tdsAmount || 0) - 0.005) {
      add('WARNING', 'PART_PAID', `${who}: only part of this deduction is covered by a challan.`, e.id);
    }
  }

  /* Everything the register already knows about, kept out of duplicate rows. */
  const seen = new Set(problems.map((p) => `${p.code}:${p.eventId}`));
  for (const x of tdsExceptions(db, companyId, { quarter })) {
    if (seen.has(`${x.code}:${x.eventId}`)) continue;
    if (x.code === 'DUPLICATE') add('BLOCK', x.code, x.message, x.eventId);
  }

  /* Ledger reconciliation: a ledger with more challaned against it than was
     ever deducted onto it is two books telling different stories. */
  for (const l of tdsReconciliation(db, companyId, { quarter }).ledgers) {
    if (l.outstanding < -0.005) {
      add('WARNING', 'LEDGER_RECON', `${l.name}: ${Math.abs(l.outstanding)} more challaned than deducted on this ledger.`);
    }
  }

  const blocking = problems.filter((p) => p.severity === 'BLOCK');
  const warnings = problems.filter((p) => p.severity === 'WARNING');

  return {
    quarter,
    problems,
    blocking,
    warnings,
    /* Ready means nothing blocks. Warnings are filed with, and explained. */
    ready: blocking.length === 0 && events.length > 0,
    eventCount: events.length,
  };
};

/**
 * What the return would say: one row per deductee per section.
 *
 * A 26Q is deductee-wise, not document-wise — five bills to one contractor
 * under 194C are one line with one total, and the challan that paid them is
 * named against it. Built from the snapshots, so a rate that changed last
 * April does not restate a deduction made before it.
 */
export const returnDataset = (db, companyId, quarter) => {
  const company = db?.companies?.find?.((c) => Number(c?.id) === Number(companyId)) || null;
  const profile = companyTdsProfile(company);
  const events = tdsEvents(db, companyId, { quarter, side: 'PAYABLE' }).filter(isLive);
  const allocations = allocationsByEvent(db, companyId);
  const challans = Array.isArray(db?.tdsChallans) ? db.tdsChallans : [];
  const links = Array.isArray(db?.tdsChallanAllocations) ? db.tdsChallanAllocations : [];

  const rows = new Map();
  for (const e of events) {
    const key = `${e.partyId}:${e.sectionCode}:${e.rate}`;
    const at = rows.get(key) || {
      deducteeId: e.partyId,
      deductee: e.partyName || '',
      pan: String(e.panSnapshot || '').toUpperCase(),
      natureCode: e.natureCode,
      nature: natureByCode(e.natureCode)?.name || e.natureCode,
      sectionCode: e.sectionCode,
      /* The reference as it stood when the deduction was made — a quarter
         spanning April 2026 legitimately carries both Acts. */
      sectionReference: e.sectionReference || e.sectionCode,
      rate: Number(e.rate || 0),
      baseAmount: 0,
      tdsAmount: 0,
      paidAmount: 0,
      deductionDates: [],
      challans: new Set(),
      events: [],
    };
    at.baseAmount = r2(at.baseAmount + Number(e.baseAmount || 0));
    at.tdsAmount = r2(at.tdsAmount + Number(e.tdsAmount || 0));
    at.paidAmount = r2(at.paidAmount + allocations.for(e.id));
    at.deductionDates.push(day(e.deductionDate || e.transactionDate));
    at.events.push(e.id);
    for (const link of links) {
      if (String(link.tdsTransactionId) !== String(e.id)) continue;
      const challan = challans.find((c) => String(c.id) === String(link.challanId));
      if (challan?.number) at.challans.add(String(challan.number));
    }
    rows.set(key, at);
  }

  const lines = [...rows.values()]
    .map((r) => ({
      ...r,
      deductionDates: [...new Set(r.deductionDates)].sort(),
      challans: [...r.challans].sort(),
      unpaidAmount: r2(r.tdsAmount - r.paidAmount),
    }))
    .sort((a, b) => a.deductee.localeCompare(b.deductee) || a.sectionCode.localeCompare(b.sectionCode));

  return {
    quarter,
    deductor: {
      name: profile.deductorName || company?.name || '',
      tan: profile.tan,
      type: profile.deductorType,
    },
    lines,
    totals: {
      baseAmount: r2(lines.reduce((t, l) => t + l.baseAmount, 0)),
      tdsAmount: r2(lines.reduce((t, l) => t + l.tdsAmount, 0)),
      paidAmount: r2(lines.reduce((t, l) => t + l.paidAmount, 0)),
      deductees: new Set(lines.map((l) => String(l.deducteeId))).size,
    },
  };
};

/**
 * A deterministic signature of the dataset — the same events in the same
 * state give the same string, and one changed paisa changes it. The freeze
 * stores it; drift between the frozen signature and today's is how the
 * screen knows the quarter moved after somebody froze it.
 */
export const datasetChecksum = (dataset) => {
  const text = (dataset?.lines || [])
    .map((l) => [l.deducteeId, l.sectionCode, l.rate, l.baseAmount, l.tdsAmount, l.paidAmount].join('|'))
    .join(';');
  /* djb2 — stability matters here, cryptography does not. */
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(16)}-${(dataset?.lines || []).length}`;
};

/** The quarter's filing record, if one has been started. */
export const filingFor = (db, companyId, quarter) =>
  (Array.isArray(db?.tdsFilings) ? db.tdsFilings : []).find(
    (f) => Number(f?.companyId) === Number(companyId) && String(f?.quarter) === String(quarter)
  ) || null;

/** The dataset as a CSV, which is what a filing agent actually asks for. */
export const returnCsv = (dataset) => {
  const head = [
    'Deductee',
    'PAN',
    'Section',
    'Statutory reference',
    'Rate %',
    'Amount paid/credited',
    'TDS deducted',
    'TDS deposited',
    'Deduction dates',
    'Challans',
  ];
  const cell = (v) => {
    const text = String(v ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = (dataset?.lines || []).map((l) =>
    [
      l.deductee,
      l.pan,
      l.sectionCode,
      l.sectionReference,
      l.rate,
      l.baseAmount,
      l.tdsAmount,
      l.paidAmount,
      l.deductionDates.join(' '),
      l.challans.join(' '),
    ]
      .map(cell)
      .join(',')
  );
  return [head.join(','), ...body].join('\n');
};

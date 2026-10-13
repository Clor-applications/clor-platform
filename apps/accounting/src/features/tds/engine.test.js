import { describe, expect, it, vi } from 'vitest';

import {
  NEW_ACT_FROM,
  TDS_NATURES,
  natureForSection,
  resolveRule,
  ruleRate,
} from './ruleMaster';
import {
  companyTdsProfile,
  priorBaseFor,
  resolveTds,
  returnQuarter,
  tdsEventFrom,
  tdsLedgersFor,
} from './engine';

/**
 * The tax engine, tested as the specification describes it.
 *
 * The two facts the whole architecture exists to protect:
 *
 *   a deduction is computed under the rule in force on the TRANSACTION's date,
 *   not today's;
 *
 *   and what was posted stays posted — changing a vendor, a rate or a ledger
 *   mapping tomorrow rewrites nothing.
 */

const CONTRACTOR = natureForSection('194C').code;
const PROFESSIONAL = natureForSection('194J(b)').code;

const company = (over = {}) => ({
  id: 1,
  name: 'Neev Steels',
  profile: { taxCompliances: { tds: { enabled: true, tan: 'BLRN12345F', ...over } } },
});

const LEDGERS = [
  { id: 101, name: 'TDS Payable - Contractor', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' },
  { id: 102, name: 'TDS Payable - Professional Fees', tdsNatureCode: PROFESSIONAL, tdsSide: 'PAYABLE' },
  { id: 103, name: 'TDS Receivable - Contractor', tdsNatureCode: CONTRACTOR, tdsSide: 'RECEIVABLE' },
  { id: 104, name: 'TDS Payable - Contractor (closed)', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE', isActive: false },
];

const vendor = (over = {}) => ({
  id: 9,
  name: 'Steel Supply Co',
  pan: 'AABCU9603R',
  tdsApplicable: true,
  tdsNatureCode: CONTRACTOR,
  ...over,
});

const ask = (over = {}) =>
  resolveTds({
    company: company(),
    party: vendor(),
    transactionDate: '2026-09-12',
    taxableBase: 100000,
    ledgers: LEDGERS,
    ...over,
  });

describe('the switch', () => {
  it('deducts nothing at all when TDS is off for the company', () => {
    const off = resolveTds({
      company: company({ enabled: false }),
      party: vendor(),
      transactionDate: '2026-09-12',
      taxableBase: 100000,
      ledgers: LEDGERS,
    });
    expect(off.applicable).toBe(false);
    expect(off.tdsAmount).toBe(0);
  });

  it('reads the company profile from where the tax screen writes it', () => {
    expect(companyTdsProfile(company()).tan).toBe('BLRN12345F');
    expect(companyTdsProfile({}).enabled).toBe(false);
  });
});

describe('which nature applies', () => {
  it('takes what the transaction says first', () => {
    expect(ask({ explicitNatureCode: PROFESSIONAL }).natureCode).toBe(PROFESSIONAL);
  });

  it('then what the party says', () => {
    expect(ask().natureCode).toBe(CONTRACTOR);
  });

  it('then what the company says', () => {
    const result = resolveTds({
      company: company({ defaultNatureCode: PROFESSIONAL }),
      party: { id: 5, name: 'Someone', pan: 'AABCU9603R' },
      transactionDate: '2026-09-12',
      taxableBase: 100000,
      ledgers: LEDGERS,
    });
    expect(result.natureCode).toBe(PROFESSIONAL);
  });

  it('and otherwise deducts nothing rather than guessing', () => {
    const result = resolveTds({
      company: company(),
      party: { id: 5, name: 'Someone' },
      transactionDate: '2026-09-12',
      taxableBase: 100000,
      ledgers: LEDGERS,
    });
    expect(result.applicable).toBe(false);
    expect(result.natureCode).toBe('');
  });

  it('honours a party marked as not liable', () => {
    expect(ask({ party: vendor({ tdsApplicable: false }) }).applicable).toBe(false);
  });
});

describe('which rule was in force', () => {
  /* The transition the Act made, and the reason the date is an argument. */
  it('uses the old section up to 31 March 2026', () => {
    const rule = resolveRule(CONTRACTOR, '2026-03-31');
    expect(rule.statutoryReference).toBe('194C');
  });

  it('uses the new reference from 1 April 2026', () => {
    const rule = resolveRule(CONTRACTOR, NEW_ACT_FROM);
    expect(rule.statutoryReference).toMatch(/^393/);
    /* Same deduction — the rate did not move with the reference. */
    expect(rule.rate).toBe(resolveRule(CONTRACTOR, '2026-03-31').rate);
  });

  it('is decided by the transaction date, not by today', () => {
    /* A March bill entered in September is still a March bill. */
    const march = ask({ transactionDate: '2026-03-15' });
    expect(march.statutoryReference).toBe('194C');
    const april = ask({ transactionDate: '2026-04-15' });
    expect(april.statutoryReference).toMatch(/^393/);
  });

  it('blocks rather than guessing when no rule covers the date', () => {
    const result = ask({ transactionDate: '1990-01-01' });
    expect(result.applicable).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it('follows the payee where the section says the rate does', () => {
    const rule = resolveRule(CONTRACTOR, '2026-09-12');
    expect(ruleRate(rule, 'COMPANY')).toBe(2);
    expect(ruleRate(rule, 'INDIVIDUAL')).toBe(1);
  });
});

describe('the figure', () => {
  it('is the rule rate on the taxable value', () => {
    const result = ask();
    expect(result.rate).toBe(2);
    expect(result.tdsAmount).toBe(2000);
  });

  it('is nothing below the threshold, and says why', () => {
    const result = ask({ taxableBase: 10000 });
    expect(result.tdsAmount).toBe(0);
    expect(result.thresholdCrossed).toBe(false);
    expect(result.thresholdReason).toBeTruthy();
  });

  it('can deduct below the statutory threshold when the company explicitly chooses it', () => {
    const result = ask({ company: company({ thresholdHandling: 'ALWAYS_DEDUCT' }), taxableBase: 10000 });
    expect(result.thresholdCrossed).toBe(true);
    expect(result.tdsAmount).toBe(200);
  });

  it('applies the configured round-off preference', () => {
    const exact = ask({ company: company({ roundOffPreference: 'TWO_DECIMALS' }), taxableBase: 100033, explicitRate: 0.5 });
    const rounded = ask({ company: company({ roundOffPreference: 'NEAREST_RUPEE' }), taxableBase: 100033, explicitRate: 0.5 });
    expect(exact.tdsAmount).toBe(500.17);
    expect(rounded.tdsAmount).toBe(500);
  });

  /* Once the annual limit is passed the whole aggregate is liable, earlier
     bills included — so the figure has to know what came before it. */
  it('counts what the party was already billed this year', () => {
    const result = ask({ taxableBase: 20000, priorBase: 95000 });
    expect(result.thresholdCrossed).toBe(true);
    expect(result.baseAmount).toBe(115000);
    expect(result.tdsAmount).toBe(2300);
  });

  it('deducts at 20% where the party has no PAN, and says so', () => {
    const result = ask({ party: vendor({ pan: '' }) });
    expect(result.rate).toBe(20);
    expect(result.warnings.map((w) => w.code)).toContain('PAN_MISSING');
  });

  it('honours a lower-deduction certificate while it is valid', () => {
    const certificate = { number: 'CERT/1', rate: 0.5, validFrom: '2026-04-01', validTo: '2027-03-31' };
    expect(ask({ party: vendor({ tdsCertificate: certificate }) }).rate).toBe(0.5);
    /* Expired: the rule's own rate returns. */
    expect(
      ask({
        transactionDate: '2027-06-01',
        party: vendor({ tdsCertificate: { ...certificate, validTo: '2027-03-31' } }),
      }).rate
    ).toBe(2);
  });

  it('lets this transaction type a rate over the rule', () => {
    expect(ask({ explicitRate: 5 }).tdsAmount).toBe(5000);
  });
});

describe('where it posts', () => {
  it('offers only the ledgers mapped to this nature and side', () => {
    expect(tdsLedgersFor(LEDGERS, { natureCode: CONTRACTOR, side: 'PAYABLE' }).map((l) => l.id)).toEqual([101]);
  });

  it('never offers the receivable side to a payable deduction', () => {
    const ids = tdsLedgersFor(LEDGERS, { natureCode: CONTRACTOR, side: 'PAYABLE' }).map((l) => l.id);
    expect(ids).not.toContain(103);
  });

  /* §19's fourth exclusion: filed under TDS Payable but mapped to nothing
     is not offerable — an unmapped ledger answers no nature's question. */
  it('leaves out an unmapped ledger, even on the right side', () => {
    const withUnmapped = [...LEDGERS, { id: 106, name: 'TDS Payable - Misc', tdsSide: 'PAYABLE' }];
    expect(tdsLedgersFor(withUnmapped, { natureCode: CONTRACTOR, side: 'PAYABLE' }).map((l) => l.id)).toEqual([101]);
  });

  it('leaves out a closed ledger', () => {
    expect(tdsLedgersFor(LEDGERS, { natureCode: CONTRACTOR, side: 'PAYABLE' }).map((l) => l.id)).not.toContain(104);
  });

  it('picks the only mapped ledger without asking', () => {
    expect(ask().ledgerId).toBe('101');
  });

  it('prefers the ledger the party is mapped to', () => {
    const two = [...LEDGERS, { id: 105, name: 'TDS Payable - Contractor (site)', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' }];
    const result = ask({ ledgers: two, party: vendor({ tdsLedgerId: '105' }) });
    expect(result.ledgerId).toBe('105');
  });

  /* Configuration → Taxation → TDS names a company default; it stands
     between the party's own mapping and the lone-eligible fallback. */
  it('falls back to the company default ledger when the party names none', () => {
    const two = [...LEDGERS, { id: 105, name: 'TDS Payable - Contractor (site)', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' }];
    const result = ask({
      ledgers: two,
      company: company({ defaultPayableLedgerId: '105' }),
      party: vendor({ tdsLedgerId: '' }),
    });
    expect(result.ledgerId).toBe('105');
  });

  it('the party mapping still beats the company default', () => {
    const two = [...LEDGERS, { id: 105, name: 'TDS Payable - Contractor (site)', tdsNatureCode: CONTRACTOR, tdsSide: 'PAYABLE' }];
    const result = ask({
      ledgers: two,
      company: company({ defaultPayableLedgerId: '105' }),
      party: vendor({ tdsLedgerId: '101' }),
    });
    expect(result.ledgerId).toBe('101');
  });

  it('a wrong-nature company default is simply not eligible', () => {
    const result = ask({
      company: company({ defaultPayableLedgerId: '102' }),
      party: vendor({ tdsLedgerId: '' }),
    });
    /* 102 accumulates PROFESSIONAL; the lone contractor ledger wins. */
    expect(result.ledgerId).toBe('101');
  });

  /* A deduction with nowhere to post cannot be posted — §22 makes this a
     BLOCK, not a warning. */
  it('blocks when the nature has no mapped ledger', () => {
    const result = ask({ ledgers: [] });
    expect(result.blocked).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('NO_LEDGER');
  });

  it('still reads a ledger written before natures existed', () => {
    const legacy = [{ id: 201, name: 'TDS Payable - Contractor', tdsSection: '194C', tdsSide: 'PAYABLE' }];
    expect(tdsLedgersFor(legacy, { natureCode: CONTRACTOR, side: 'PAYABLE' }).map((l) => l.id)).toEqual([201]);
  });
});

describe('deducting twice', () => {
  /* The bill deducted it; the payment against that bill must not deduct it
     again. §16, and mandatory. */
  it('does not deduct again for the same obligation', () => {
    const result = ask({ existingEventFor: () => ({ id: 'tds-1', sourceType: 'bill', sourceId: 7 }) });
    expect(result.applicable).toBe(false);
    expect(result.duplicateOf).toEqual({ id: 'tds-1', sourceType: 'bill', sourceId: 7 });
  });

  it('asks only about the nature and rule it resolved', () => {
    const seen = vi.fn(() => null);
    ask({ existingEventFor: seen });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ natureCode: CONTRACTOR }));
  });
});

describe('the compliance record', () => {
  it('snapshots everything that could change later', () => {
    const result = ask();
    const event = tdsEventFrom(result, {
      company: company(),
      party: vendor(),
      source: { type: 'bill', id: 7, number: 'BILL-1' },
      branchId: 'b1',
      date: '2026-09-12',
    });

    expect(event).toMatchObject({
      companyId: 1,
      branchId: 'b1',
      sourceType: 'bill',
      sourceId: 7,
      partyId: 9,
      panSnapshot: 'AABCU9603R',
      tanSnapshot: 'BLRN12345F',
      transactionDate: '2026-09-12',
      natureCode: CONTRACTOR,
      sectionCode: '194C',
      baseAmount: 100000,
      rate: 2,
      tdsAmount: 2000,
      ledgerId: '101',
      status: 'Posted',
    });
    expect(event.ruleVersionId).toBeTruthy();
  });

  it('files the deduction in the right quarter', () => {
    expect(returnQuarter('2026-09-12')).toBe('FY 2026-27 Q2');
    expect(returnQuarter('2026-04-01')).toBe('FY 2026-27 Q1');
    expect(returnQuarter('2027-02-14')).toBe('FY 2026-27 Q4');
  });

  /* The point of the snapshot: history does not move when the master does. */
  it('keeps the reference the rule gave at the time', () => {
    const march = ask({ transactionDate: '2026-03-15' });
    const event = tdsEventFrom(march, {
      company: company(),
      party: vendor(),
      source: { type: 'bill', id: 1 },
      date: '2026-03-15',
    });
    expect(event.sectionReference).toBe('194C');
    expect(event.returnQuarter).toBe('FY 2025-26 Q4');
  });
});

describe('what came before', () => {
  const bills = [
    { id: 1, vendorId: 9, date: '2026-05-01', tdsNatureCode: CONTRACTOR, subtotal: 40000 },
    { id: 2, vendorId: 9, date: '2026-06-01', tdsNatureCode: CONTRACTOR, subtotal: 30000, status: 'Cancelled' },
    { id: 3, vendorId: 9, date: '2026-07-01', tdsNatureCode: PROFESSIONAL, subtotal: 50000 },
    { id: 4, vendorId: 8, date: '2026-07-01', tdsNatureCode: CONTRACTOR, subtotal: 90000 },
    { id: 5, vendorId: 9, date: '2025-05-01', tdsNatureCode: CONTRACTOR, subtotal: 70000 },
  ];

  it('counts this party, this nature, this year, this document aside', () => {
    expect(priorBaseFor(bills, { partyId: 9, natureCode: CONTRACTOR, onDate: '2026-09-12' })).toBe(40000);
  });

  it('leaves out the document being edited', () => {
    expect(
      priorBaseFor(bills, { partyId: 9, natureCode: CONTRACTOR, onDate: '2026-09-12', excludeId: 1 })
    ).toBe(0);
  });
});

describe('the natures themselves', () => {
  it('carry a stable code that does not move with the Act', () => {
    expect(TDS_NATURES.every((n) => /^[A-Z0-9_]+$/.test(n.code))).toBe(true);
    expect(natureForSection('194C').code).toBe(CONTRACTOR);
  });
});

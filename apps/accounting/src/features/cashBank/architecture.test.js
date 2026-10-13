/**
 * @vitest-environment node
 *
 * Reads source and computes; never renders. A jsdom for it is about
 * twenty-five seconds of wall clock that nothing touches.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The Cash & Bank architecture, enforced rather than remembered.
 *
 * The required flow is: statement/transaction → allocation or match →
 * central accounting engine → journal entry → reconciliation. Cash & Bank
 * itself must never update GL or ledger balance fields, settle bills or
 * invoices by hand, or invent journal lines outside the engine. These rules
 * were once broken here — the old manual-transaction form carried its own
 * settlement ladder with hand-minted voucher numbers — so they are pinned as
 * tests: a regression should fail a build, not wait for an audit.
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(DIR)
  .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), 'utf8') }));

describe('Cash & Bank touches no balance it does not own', () => {
  it('never writes paidAmount — bills and invoices settle only through the payment service', () => {
    const offenders = sources.filter((s) => /paidAmount\s*:/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('never writes an opening balance or a stored ledger balance', () => {
    const offenders = sources
      .filter((s) => /openingBalance\s*:\s*(?!Number|String)/.test(s.text) || /ledgerBalance\s*:/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('every file that composes a journal posts it through the central engine', () => {
    /* Composing = building an entry with a debit/credit total. Reading or
       flagging existing entries (reconciliation does) is not composing. */
    const offenders = sources
      .filter((s) => /totalDebit\s*:/.test(s.text))
      .filter((s) => !s.text.includes('postJournalToLedger'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('party settlements go through the payment service, not local voucher records', () => {
    /* A hand-built voucher betrays itself by minting its own number. */
    const offenders = sources
      .filter((s) => /paymentNo\s*:\s*`PAY-|receiptNo\s*:\s*`RCPT-/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('keeps the imported-row guard: bank-side facts of an imported line stay immutable', () => {
    const module = sources.find((s) => s.file === 'CashBankModule.jsx');
    expect(module.text).toMatch(/if \(t\.imported\)/);
  });
});

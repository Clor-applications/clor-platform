/**
 * One payment, several accounts.
 *
 * A bank payment of ₹10,500 to the GST department is not three payments. It is
 * one credit to the bank and three debits — tax, late fee, interest — and the
 * form that could only name a supplier and a bill forced it to be recorded as
 * three records that reconcile against one line on the statement, or as one
 * record with the fee buried in a "charges" box that posts nowhere useful.
 *
 * So the allocation is a list of ledgers and amounts, and the rule is the one
 * rule double entry has: the side that is one line and the side that is many
 * must come to the same figure. Bills and invoices already allocated on the
 * form count toward that total rather than sitting outside it — settling a
 * bill IS an allocation, to the party's own control account.
 */

/* Imported and re-exported, not redefined: an allocation and the entry it
   settles have to round the same way. `export … from` alone would publish the
   name without binding it here, and this file uses it a dozen times — which
   is a ReferenceError the moment somebody allocates a receipt. */
import { round2, toPaise } from '@ui/utils/money';

export { round2 };

/** Paise, so equality is an integer comparison and never a float one. */
export const paise = toPaise;

export const emptyAllocationRow = () => ({ ledgerId: '', amount: '', description: '' });

/** Rows the user actually filled in: a ledger and a non-zero amount. */
export const usableRows = (rows) =>
  (Array.isArray(rows) ? rows : []).filter(
    (r) => String(r?.ledgerId || '').trim() && Math.abs(Number(r?.amount) || 0) > 0.004
  );

/**
 * What the allocation adds up to, and what is left.
 *
 * `documentTotal` is whatever the document side of the form has already
 * allocated — bills on a payment, invoices on a receipt. It is part of the
 * total, not a separate pot: a receipt of ₹10,500 that settles ₹10,000 of
 * invoices has ₹500 still to place, and that is what the form must say.
 */
export const allocationSummary = ({ rows, documentTotal = 0, amount = 0 }) => {
  const ledgerTotal = usableRows(rows).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const docs = Number(documentTotal) || 0;
  const allocated = round2(ledgerTotal + docs);
  const target = round2(Number(amount) || 0);
  return {
    ledgerTotal: round2(ledgerTotal),
    documentTotal: round2(docs),
    allocated,
    unallocated: round2(target - allocated),
    balanced: paise(allocated) === paise(target) && paise(target) !== 0,
  };
};

/**
 * Why the form cannot be saved yet, or null.
 *
 * Stated as one sentence naming the figure, because "allocation mismatch" on
 * an accounting screen tells somebody that something is wrong and not what.
 */
export const allocationError = ({ rows, documentTotal = 0, amount = 0, noun = 'payment', hasParty = false }) => {
  const list = Array.isArray(rows) ? rows : [];
  const target = round2(Number(amount) || 0);
  if (paise(target) <= 0) return `Enter the ${noun} amount first.`;

  /* A row with an amount and no ledger is the commonest half-finished state,
     and it is the one the total will silently ignore. */
  const orphan = list.find((r) => !String(r?.ledgerId || '').trim() && Math.abs(Number(r?.amount) || 0) > 0.004);
  if (orphan) return 'One allocation row has an amount but no account — pick a ledger for it, or clear the amount.';

  const negative = usableRows(list).find((r) => Number(r.amount) < 0);
  if (negative) return 'An allocation cannot be negative. Record the other side as its own line.';

  const { allocated, unallocated, balanced } = allocationSummary({ rows: list, documentTotal, amount });
  if (balanced) return null;

  /*
   * A remainder against a named party is an advance, not a gap.
   *
   * The money sits on that party's account until a document claims it, which
   * is an allocation — to their control ledger — and the product has always
   * recorded it that way. Only a remainder with nobody to hold it has to be
   * placed by hand: a GST payment or a bank charge has no account to sit on.
   */
  if (hasParty && unallocated > 0) return null;
  if (paise(allocated) === 0) return `Allocate the ${noun} to at least one account.`;
  return unallocated > 0
    ? `₹${unallocated.toFixed(2)} of this ${noun} is still unallocated.`
    : `The allocation is over by ₹${Math.abs(unallocated).toFixed(2)}.`;
};

/**
 * The journal this allocation posts.
 *
 * `direction` is the money's: OUT credits the bank and debits every allocated
 * account, IN does the reverse. Nothing here knows about bills, TDS or
 * charges — by the time a figure reaches this function it is a ledger and an
 * amount, which is the whole point of the redesign.
 */
export const allocationJournalLines = ({ rows, direction, bankLedgerId, amount, nameOf }) => {
  const name = typeof nameOf === 'function' ? nameOf : () => '';
  const out = String(direction).toUpperCase() === 'OUT';
  const lines = usableRows(rows).map((r) => ({
    accountId: String(r.ledgerId),
    accountName: name(r.ledgerId),
    debit: out ? round2(r.amount) : 0,
    credit: out ? 0 : round2(r.amount),
    description: String(r.description || '').trim() || undefined,
  }));
  if (!lines.length) return [];
  return [
    ...lines,
    {
      accountId: String(bankLedgerId),
      accountName: name(bankLedgerId),
      debit: out ? 0 : round2(amount),
      credit: out ? round2(amount) : 0,
    },
  ];
};

/**
 * Every status this product can put on a document, declared once.
 *
 * Before this there was no list to add a status to — you wrote a string. So
 * the same idea arrived in two spellings (`Approved` and `APPROVED`,
 * `Cancelled` and `CANCELLED`), and anything the pill's hardcoded ten-word
 * tone list did not recognise came out grey. Eleven of the twenty-one words in
 * use rendered as the same neutral grey, including `Unpaid` and `Approved`.
 *
 * The one that mattered most: `Draft` and `Unpaid` were identical on screen.
 * One is a document nobody has sent. The other is money somebody owes you. A
 * list exists to be scanned, and those two were indistinguishable at scanning
 * speed.
 *
 * Two rules hold this together:
 *
 * 1. A status not in this file is *visibly* unknown, not quietly grey. A new
 *    string added anywhere shows up as a fault, so it gets registered rather
 *    than silently joining the grey pile.
 *
 * 2. Tone says how to feel, never what the word is. `Cancelled` is neutral,
 *    not red: cancelling is usually a correction — wrong customer, wrong
 *    number — and painting a normal day's work as an emergency teaches people
 *    to ignore red. Red is kept for `Overdue` and `Rejected`, where something
 *    genuinely is wrong.
 */

/** tone → how the pill is coloured. Matches the --pos/--neg/--warn/--info tokens. */
export const STATUS_TONES = ['pos', 'neg', 'warn', 'info', 'neutral', 'outline'];

const REGISTRY = [
  // --- money owed to us, and money we owe -----------------------------------
  // Outline, not grey fill: a draft is the absence of a document, not a
  // state of the money. It has to be distinguishable from Unpaid at a glance —
  // that pair being identical was the defect this registry exists to fix.
  { key: 'draft', label: 'Draft', tone: 'outline', statusTone: 'draft', aliases: ['draft'] },
  { key: 'unpaid', label: 'Unpaid', tone: 'neutral', statusTone: 'sent', aliases: ['unpaid', 'issued'] },
  { key: 'partial', label: 'Partial', tone: 'warn', statusTone: 'partial', aliases: ['partial', 'partially paid'] },
  { key: 'overdue', label: 'Overdue', tone: 'neg', statusTone: 'overdue', aliases: ['overdue', 'over due'] },
  { key: 'paid', label: 'Paid', tone: 'pos', statusTone: 'paid', aliases: ['paid', 'settled'] },
  // Deliberately neutral. See the note above.
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral', statusTone: 'cancelled', aliases: ['cancelled', 'canceled', 'void'] },

  // --- approval ------------------------------------------------------------
  { key: 'pendingApproval', label: 'Pending approval', statusTone: 'partial', tone: 'warn', aliases: ['pending approval', 'pending', 'awaiting approval'] },
  { key: 'approved', label: 'Approved', statusTone: 'paid', tone: 'pos', aliases: ['approved'] },
  { key: 'rejected', label: 'Rejected', statusTone: 'overdue', tone: 'neg', aliases: ['rejected', 'declined'] },

  // --- stock movement ------------------------------------------------------
  { key: 'inTransit', label: 'In transit', statusTone: 'sent', tone: 'warn', aliases: ['in transit', 'transferred out', 'transfer out'] },
  { key: 'received', label: 'Received', statusTone: 'paid', tone: 'pos', aliases: ['received', 'transfer in'] },
  { key: 'shortReceived', label: 'Short received', statusTone: 'outstanding', tone: 'warn', aliases: ['short received', 'short'] },

  // --- order / document lifecycle -----------------------------------------
  /**
   * "Open" is not "Unpaid", and folding the two together was a mistake in the
   * first version of this file.
   *
   * Every status: 'Open' the product writes is on a sales order, a purchase
   * order or a delivery challan — a commitment waiting to be fulfilled, with
   * nothing owed on it yet. Aliasing it to Unpaid put "Unpaid" on an order
   * that had not been delivered, let alone billed, and told the proprietor
   * money was owed that nobody had been invoiced for. An invoice never carries
   * this word: its status is derived as Unpaid, Partial, Paid or Overdue.
   */
  { key: 'open', label: 'Open', statusTone: 'sent', tone: 'neutral', aliases: ['open'] },
  { key: 'closed', label: 'Closed', statusTone: 'cancelled', tone: 'pos', aliases: ['closed', 'completed', 'fulfilled'] },
  // Both are derived by the sales-order list from ordered/delivered/billed
  // counts, and neither had ever been declared — so a fully delivered order
  // came out flagged as an unknown status, which is the registry working but
  // is not a thing to leave in front of a user.
  { key: 'delivered', label: 'Delivered', statusTone: 'paid', tone: 'pos', aliases: ['delivered'] },
  { key: 'billed', label: 'Billed', statusTone: 'paid', tone: 'pos', aliases: ['billed'] },
  { key: 'posted', label: 'Posted', statusTone: 'paid', tone: 'pos', aliases: ['posted'] },
  { key: 'active', label: 'Active', statusTone: 'paid', tone: 'pos', aliases: ['active'] },
  { key: 'sent', label: 'Sent', tone: 'neutral', statusTone: 'sent', aliases: ['sent'] },
  // A quote that became an invoice. Positive: the deal closed, and it is the
  // signal that stops anyone quoting the same job twice.
  { key: 'converted', label: 'Converted', statusTone: 'paid', tone: 'pos', aliases: ['converted'] },
  { key: 'invoiced', label: 'Invoiced', statusTone: 'paid', tone: 'pos', aliases: ['invoiced'] },
  { key: 'expired', label: 'Expired', statusTone: 'cancelled', tone: 'neutral', aliases: ['expired', 'lapsed'] },
  { key: 'returned', label: 'Returned', statusTone: 'refund', tone: 'warn', aliases: ['returned'] },

  // --- reconciliation ------------------------------------------------------
  { key: 'recorded', label: 'Recorded', statusTone: 'paid', tone: 'pos', aliases: ['recorded'] },
  { key: 'categorised', label: 'Categorised', statusTone: 'paid', tone: 'pos', aliases: ['categorised', 'categorized'] },
  { key: 'uncategorised', label: 'Uncategorised', statusTone: 'outstanding', tone: 'warn', aliases: ['uncategorised', 'uncategorized'] },
  { key: 'balanced', label: 'Balanced', statusTone: 'paid', tone: 'pos', aliases: ['balanced'] },
  { key: 'unbalanced', label: 'Unbalanced', statusTone: 'overdue', tone: 'neg', aliases: ['unbalanced'] },
  // A posting that was taken back. Cancelled, not failed: the entry was
  // correct enough to post and was undone on purpose.
  { key: 'reversed', label: 'Reversed', statusTone: 'cancelled', tone: 'neutral', aliases: ['reversed'] },

  // --- external filings ----------------------------------------------------
  { key: 'registered', label: 'Registered', statusTone: 'paid', tone: 'pos', aliases: ['registered'] },
  { key: 'failed', label: 'Failed', statusTone: 'overdue', tone: 'neg', aliases: ['failed', 'error'] },
];

/** Every alias, lowercased, pointing at its entry. Built once. */
const BY_ALIAS = new Map();
for (const entry of REGISTRY) {
  for (const a of entry.aliases) BY_ALIAS.set(a, entry);
  BY_ALIAS.set(entry.label.toLowerCase(), entry);
}

/**
 * Resolve any string the codebase produces to a canonical status.
 *
 * An unrecognised value comes back with `known: false` so the caller can show
 * it as a fault. Returning a grey pill instead is what let eleven statuses
 * drift into meaninglessness without anyone noticing.
 */
export const resolveStatus = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return { key: 'none', label: '—', tone: 'neutral', statusTone: null, known: true };
  const hit = BY_ALIAS.get(text.toLowerCase());
  if (hit) return { key: hit.key, label: hit.label, tone: hit.tone, statusTone: hit.statusTone || null, known: true };
  return { key: 'unknown', label: text, tone: 'neutral', statusTone: null, known: false };
};

/** For tests and for the design docs: the canonical list, in declaration order. */
export const allStatuses = () => REGISTRY.map((e) => ({ key: e.key, label: e.label, tone: e.tone }));

export default resolveStatus;

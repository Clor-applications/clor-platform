import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

const orgId = () => {
  const id = String(platformOrgId() || '').trim();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};
const base = () => `/orgs/${encodeURIComponent(orgId())}/ledger`;

// The ledger is branch-scoped, not warehouse-scoped. Sending x-warehouse-id
// would make tenantContext check warehouse access the caller may not have, and
// reject a request that has nothing to do with stock.
const opts = { skipWarehouseHeader: true };

export const getTrialBalance = (allBranches = false, from = '', to = '') => {
  const q = new URLSearchParams();
  if (allBranches) q.set('allBranches', 'true');
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const qs = q.toString();
  return apiFetch(`${base()}/trial-balance${qs ? `?${qs}` : ''}`, opts);
};

export const getAccountLedgerLines = (ledgerAccountId, { from = '', to = '', allBranches = false } = {}) => {
  const q = new URLSearchParams();
  if (allBranches) q.set('allBranches', 'true');
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const qs = q.toString();
  return apiFetch(`${base()}/accounts/${encodeURIComponent(ledgerAccountId)}/lines${qs ? `?${qs}` : ''}`, opts);
};

export const getLedgerAccounts = () => apiFetch(`${base()}/accounts`, opts);

/**
 * Creates (or re-syncs, keyed by sourceKey) one server ledger account.
 * Used when a cash/bank ledger is added to the client chart of accounts so it
 * becomes a real payment mode in receipt/payment entry.
 */
export const createLedgerAccount = ({ name, accountType, controlKind, sourceKey }) =>
  apiFetch(`${base()}/accounts`, {
    ...opts,
    method: 'POST',
    body: { name, accountType, controlKind, sourceKey },
  });

export const getJournalEntries = (limit = 50) => apiFetch(`${base()}/entries?limit=${limit}`, opts);

/**
 * The postings a document still has in the books, if any.
 *
 * Asked before an issued document is offered for editing. The obvious query —
 * "is there a POSTED entry for this document?" — is wrong, and quietly so: a
 * reversal copies the original's source document, so after a cancellation the
 * only POSTED row is the contra, whose amounts are the negation of the entry it
 * undid. A live posting is one that is POSTED and is not a contra that one of
 * this document's own entries points at, which is exactly how the server
 * decides whether to refuse an edit (`postingState.ts`).
 *
 * Deliberately not read from the document's status: a Draft invoice posts
 * today, so Draft does not mean "not in the books" — the entries do.
 */
export const getDocumentPostings = async (docType, docId) => {
  const key = String(docId || '').trim();
  if (!key) return [];
  const query = `docType=${encodeURIComponent(String(docType || ''))}&docId=${encodeURIComponent(key)}&limit=200`;
  const { entries } = await apiFetch(`${base()}/entries?${query}`, opts);
  const rows = Array.isArray(entries) ? entries : [];
  const contras = new Set(rows.map((e) => e?.reversedById).filter(Boolean));
  return rows.filter((e) => e?.status === 'POSTED' && !contras.has(e.id));
};

/**
 * A manual journal entry, posted to the general ledger on the server.
 *
 * The route has existed since the ledger was built and nothing called it: a
 * journal entry raised in the app was written to the browser and nowhere else.
 * That is worse than losing a document — a journal is a ledger posting, so the
 * trial balance, the P&L and the balance sheet differed by machine, and the
 * server's own books were missing entries somebody had made on purpose.
 */
export const postJournalEntry = ({ date, journalCode = 'JV', narration, lines }) =>
  apiFetch(`${base()}/entries`, {
    method: 'POST',
    body: { date, journalCode, narration: narration || null, lines },
    ...opts,
  });

/**
 * Reversing a posted entry, which is how a journal is taken back.
 *
 * A posting that has reached the ledger is never edited or erased — it is
 * reversed by an equal and opposite entry, so the audit trail shows both what
 * was recorded and that it was undone.
 */
export const reverseJournalEntry = (entryId, narration) =>
  apiFetch(`${base()}/entries/${entryId}/reverse`, {
    method: 'POST',
    body: { narration: narration || undefined },
    ...opts,
  });

/** The fiscal years the server knows about, and how far each is locked. */
export const getFiscalYears = () => apiFetch(`${base()}/fiscal-years`, opts);

/**
 * Locking (or unlocking) a fiscal year on the server.
 *
 * The server refuses to post into a locked period, so this is what makes a
 * closed year actually closed. A lock held only in the browser stops the
 * machine that set it and nothing else.
 */
export const lockFiscalYear = (name, lockedThrough) =>
  apiFetch(`${base()}/fiscal-years/${encodeURIComponent(name)}/lock`, {
    method: 'POST',
    body: { lockedThrough: lockedThrough || null },
    ...opts,
  });

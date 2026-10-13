import { tdsDefaultRate, tdsSection } from './tds';

/**
 * The TDS ledgers a purchase can be deducted against.
 *
 * On the buy side TDS is the buyer's own obligation: the vendor is paid short
 * and the difference is owed to the government until it is deposited. That
 * liability has to land in a real ledger, and which one is a decision the
 * company already made in its chart of accounts — a ledger under TDS Payable,
 * one per section it deducts under, each naming the section it accumulates.
 *
 * So the bill does not ask for a section out of a list of every section in the
 * Act. It asks which of *this company's* TDS ledgers the deduction belongs to,
 * and the section, and therefore the rate, follows from the ledger.
 *
 * Receivable TDS is a different animal — tax withheld from what the company is
 * owed, an asset — and is deliberately not offered here.
 */

/** Walk a group to its root, so a ledger under a nested group still counts. */
const groupChain = (groups, groupId) => {
  const byId = new Map((groups || []).map((g) => [String(g?.id), g]));
  const chain = [];
  const seen = new Set();
  let cur = byId.get(String(groupId || '')) || null;
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    chain.push(cur);
    const pid = cur.parentGroupId;
    if (pid === null || pid === undefined || pid === '') break;
    cur = byId.get(String(pid)) || null;
  }
  return chain;
};

/**
 * Which side of the books a TDS group is, or '' when it is not a TDS group.
 *
 * The group already answers this — a ledger filed under TDS Payable is a
 * liability and one under TDS Receivable is an asset — so the side is read
 * from the chart rather than asked for a second time on the ledger form, where
 * the two answers could disagree.
 */
export const tdsGroupSide = (groups, groupId) => {
  const chain = groupChain(groups, groupId);
  if (!chain.length) return '';
  const names = chain.map((g) => String(g?.name || '').toLowerCase());
  if (!names.some((n) => /\btds\b/.test(n))) return '';
  return names.some((n) => /receivable|asset|advance/.test(n)) ? 'RECEIVABLE' : 'PAYABLE';
};

/**
 * Whether a group is a TDS *payable* group.
 *
 * The same word test the ledger form uses to decide a ledger needs a TDS
 * mapping, minus the receivable side: "TDS Receivable" is an asset and has no
 * business reducing what a vendor is paid.
 */
export const isTdsPayableGroup = (groups, groupId) => {
  const chain = groupChain(groups, groupId);
  if (!chain.length) return false;
  const names = chain.map((g) => String(g?.name || '').toLowerCase());
  if (!names.some((n) => /\btds\b/.test(n))) return false;
  /* Receivable/asset/advance anywhere in the chain means the other side. */
  return !names.some((n) => /receivable|asset|advance/.test(n));
};

/**
 * This company's TDS payable ledgers, in name order.
 *
 * `db.chartOfAccounts` rows, as the ledger master writes them: `groupId`,
 * and — for a TDS ledger — the `tdsSection` it accumulates and an optional
 * `tdsRate` where the company holds a certificate or a rate of its own.
 */
export const tdsPayableLedgers = (db, companyId) => {
  const groups = (db?.accountGroups || []).filter((g) => String(g?.companyId) === String(companyId));
  return (db?.chartOfAccounts || [])
    .filter((a) => String(a?.companyId) === String(companyId))
    .filter((a) => a?.isActive !== false)
    .filter((a) => a?.tdsRateActive !== false)
    .filter((a) => isTdsPayableGroup(groups, a?.groupId))
    .slice()
    .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
};

/**
 * The rate to deduct at, for a ledger.
 *
 * The ledger's own rate wins where it has one — that is where a company records
 * a lower-deduction certificate under section 197, or the 20% that applies when
 * the vendor has no PAN. Otherwise the section master decides, which is the one
 * place rates live.
 */
export const tdsLedgerRate = (ledger, deducteeType = 'COMPANY') => {
  const individual = Number(ledger?.tdsRateIndividual);
  if (deducteeType === 'INDIVIDUAL' && Number.isFinite(individual) && individual >= 0) return individual;
  const own = Number(ledger?.tdsRate);
  if (Number.isFinite(own) && own >= 0 && ledger?.tdsRate !== '' && ledger?.tdsRate != null) return own;
  const code = String(ledger?.tdsSection || '').trim();
  if (!code) return 0;
  return Number(tdsDefaultRate(code, deducteeType)) || 0;
};

/** "TDS 194C — Contractors @ 2%", for a picker row. */
export const tdsLedgerLabel = (ledger, deducteeType = 'COMPANY') => {
  const name = String(ledger?.name || '').trim() || 'TDS';
  const code = String(ledger?.tdsSection || '').trim();
  const rate = tdsLedgerRate(ledger, deducteeType);
  if (!code) return name;
  const section = tdsSection(code);
  const title = section?.label ? ` — ${section.label}` : '';
  return `${name} · ${code}${title}${rate ? ` @ ${rate}%` : ''}`;
};

export default tdsPayableLedgers;

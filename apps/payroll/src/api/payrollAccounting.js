import { apiFetch } from '@platform/http';
import { orgId as platformOrgId } from '@platform/context';

/**
 * What Payroll needs from Accounting, named as Payroll thinks of it.
 *
 * Payroll screens used to import Accounting's own API client to fetch the
 * chart of accounts. That worked, and it quietly made the two applications
 * one: a change to Accounting's client signature would have broken payroll
 * screens, and there would have been nothing to say why payroll cared.
 *
 * This is the frontend half of the integration boundary. It is the only place
 * in Payroll that knows how to reach Accounting, it speaks in Payroll's words
 * — "accounts a salary can post to", "accounts money can leave from" — and it
 * returns plain data. When Accounting moves behind its own service, this file
 * changes and no payroll screen does.
 */

const orgId = () => {
  const id = platformOrgId();
  if (!id) throw new Error('Missing active org. Please select an organization.');
  return id;
};

const opts = { skipWarehouseHeader: true };

const ledgers = async () => {
  const data = await apiFetch(`/orgs/${encodeURIComponent(orgId())}/ledger/accounts`, opts);
  return Array.isArray(data?.accounts) ? data.accounts.filter((a) => a.isActive !== false) : [];
};

/**
 * Where a cost lands. An earning and an employer contribution are costs.
 */
export async function expenseAccounts() {
  return (await ledgers()).filter((a) => a.accountType === 'EXPENSE');
}

/**
 * Where something withheld goes.
 *
 * Most of what is withheld is owed onward — provident fund, ESI, tax — which
 * is a liability. A loan recovery takes back money the company lent, which
 * reduces an asset. Both are offered because both are correct, for different
 * deductions.
 */
export async function withheldToAccounts() {
  return (await ledgers()).filter((a) => a.accountType === 'LIABILITY' || a.accountType === 'ASSET');
}

/** Accounts salary money can actually leave from. */
export async function paymentAccounts() {
  return (await ledgers()).filter((a) => ['CASH', 'BANK'].includes(a.controlKind));
}

/** Everything, for a screen that needs to show what a mapping points at. */
export const allAccounts = ledgers;

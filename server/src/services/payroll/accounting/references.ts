import { accountingFor } from './client.js';

/**
 * GAP-010: the Accounting records Payroll names by id — cost centres and
 * ledger accounts — checked through the accounting client before they are
 * written, so a payroll row never starts out pointing at nothing. Only a value
 * that changes is checked: a cost centre switched off later does not stop
 * anybody editing the rest of a record that already carries it.
 */
export async function costCentreRefusal(accountId: string, orgId: string, id: string | null | undefined, current?: string | null) {
  if (!id || id === current) return null;
  const centres = await accountingFor(accountId).getCostCentres(orgId);
  return centres.some((c) => c.id === id) ? null : 'No such cost centre in Accounting, or it is switched off.';
}

export async function ledgerRefusal(accountId: string, orgId: string, ids: Array<string | null | undefined>, current: Array<string | null | undefined> = []) {
  const accounting = accountingFor(accountId);
  for (const id of ids) {
    if (!id || current.includes(id)) continue;
    const ledger = await accounting.getLedger(orgId, id);
    if (!ledger) return 'No such ledger account.';
    if (!ledger.isActive) return `${ledger.name} is no longer active.`;
  }
  return null;
}

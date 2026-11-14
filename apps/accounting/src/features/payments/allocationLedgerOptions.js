/** Active company ledgers available to categorize a receipt or payment. */
export const allocationLedgerOptions = (accounts, companyId, cashBankLedgerId) =>
  (Array.isArray(accounts) ? accounts : [])
    .filter((account) => String(account?.companyId) === String(companyId))
    .filter((account) => account?.isActive !== false && account?.active !== false && !account?.hiddenFromChart)
    .filter((account) => String(account.id) !== String(cashBankLedgerId || ''))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

import { GST_STATE_BY_CODE } from '@ui/utils/gst';

const STATES = Object.entries(GST_STATE_BY_CODE)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * What actually differs between a customer and a vendor.
 *
 * Short on purpose. The two specs describe the same form twice and list the
 * differences at the end of the vendor one: the noun, which side of the ledger
 * an opening balance normally sits, sales price list against purchase, and a
 * TDS configuration that only a payee needs. Everything not in here is the same
 * for both by construction, rather than by two files having been kept in step.
 */
export const CUSTOMER_CFG = {
  kind: 'CUSTOMER',
  noun: 'Customer',
  states: STATES,
  nameHint: 'The name that appears on the invoice.',
  groupHint: 'Which group under Sundry Debtors this customer rolls up to in the balance sheet.',
  currencyHint: 'The currency this customer is billed in. Their ledger is kept in it; your books stay in the company’s own currency.',
  openingBalanceHint: 'What they already owed on the day the books begin. Leave at zero for a new customer.',
  openingHint: 'Dr means they owe you, which is the usual direction for a customer. Cr means you owe them — an advance they have already paid.',
  defaultBalanceType: 'Dr',
  priceListLabel: 'Price List',
  /*
   * A customer has a TDS profile too, and it means something different.
   *
   * On the buy side the profile decides what THIS company deducts. On the sell
   * side it says what the customer is expected to deduct from what they pay —
   * shown on the invoice, and recognised as receivable only when a receipt
   * records that they actually did. Same fields, and the difference is in what
   * the transactions do with them, not in the master.
   */
  showTdsConfig: true,
  tdsSideLabel: 'expected from this customer',
  /*
   * Whether a credit note may be raised against them at all.
   *
   * Some customers are settled by note routinely; others are a case where a
   * note is how money leaves without anybody deciding to send it. The master
   * says which, and the credit note form refuses the ones it is told to.
   */
  noteToggle: {
    title: 'Credit Notes',
    label: 'Allow credit notes for this customer',
    help: 'If disabled, credit notes cannot be raised for this customer.',
  },
};

export const VENDOR_CFG = {
  kind: 'VENDOR',
  noun: 'Vendor',
  states: STATES,
  nameHint: 'The name that appears on their bills and on your purchase documents.',
  groupHint: 'Which group under Sundry Creditors this vendor rolls up to in the balance sheet.',
  currencyHint: 'The currency this vendor bills you in. Their ledger is kept in it; your books stay in the company’s own currency.',
  openingBalanceHint: 'What you already owed them on the day the books begin. Leave at zero for a new vendor.',
  /*
   * Cr, not Dr. A vendor balance is money the business owes, which is the
   * opposite direction to a customer — the one accounting difference between
   * the two forms that a person could get wrong without noticing.
   */
  openingHint: 'Cr means you owe them, which is the usual direction for a vendor. Dr means they owe you — an advance you have already paid.',
  defaultBalanceType: 'Cr',
  priceListLabel: 'Purchase Price List',
  showTdsConfig: true,
  tdsSideLabel: 'deducted from this vendor',
  noteToggle: {
    title: 'Debit Notes',
    label: 'Allow debit notes for this vendor',
    help: 'If disabled, debit notes cannot be raised against this vendor.',
  },
};

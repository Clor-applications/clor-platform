import { describe, expect, it } from 'vitest';

import { getCustomFields, saveCustomFields } from '@ui/utils/invoicePrefs';

/**
 * A company's own fields belong to one kind of document.
 *
 * The writer put every list under `invoice` whoever was editing, so a field
 * added from a bill turned up on invoices — and a bill could never have a list
 * of its own at all. The reader still falls back to the invoice list for a
 * document type nobody has configured, so nothing already defined disappears.
 */

const company = (customFields) => ({ id: 1, docSettings: { customFields } });

const FIELD = (label) => ({
  key: label.toLowerCase(),
  label,
  type: 'Text',
  formPlacement: 'header',
  printPlacement: 'none',
});

describe('whose fields are whose', () => {
  it('writes a bill’s fields to the bill, not to the invoice', () => {
    const db = { companies: [company({ invoice: [FIELD('Transporter')] })] };
    const next = saveCustomFields(db, 1, [FIELD('Gate pass')], 'bill');

    expect(getCustomFields(next[0], 'bill').map((f) => f.label)).toEqual(['Gate pass']);
    /* The invoice's own list is untouched. */
    expect(getCustomFields(next[0], 'invoice').map((f) => f.label)).toEqual(['Transporter']);
  });

  it('still writes the invoice by default', () => {
    const db = { companies: [company({})] };
    const next = saveCustomFields(db, 1, [FIELD('Contract no')]);
    expect(getCustomFields(next[0], 'invoice').map((f) => f.label)).toEqual(['Contract no']);
  });

  /* Nothing a company already defined disappears the day this shipped. */
  it('falls back to the invoice list for a document nobody has configured', () => {
    const c = company({ invoice: [FIELD('Transporter')] });
    expect(getCustomFields(c, 'purchaseOrder').map((f) => f.label)).toEqual(['Transporter']);
  });

  it('does not fall back once that document has a list of its own', () => {
    const c = company({ invoice: [FIELD('Transporter')], bill: [FIELD('Gate pass')] });
    expect(getCustomFields(c, 'bill').map((f) => f.label)).toEqual(['Gate pass']);
  });

  it('reads an empty list as empty, not as the invoice’s', () => {
    const c = company({ invoice: [FIELD('Transporter')], bill: [] });
    expect(getCustomFields(c, 'bill')).toEqual([]);
  });
});

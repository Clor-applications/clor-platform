import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The accounting distinction prompt 10 draws, pinned as architecture:
 *
 * A customer's TDS on the master and the invoice is EXPECTED behaviour —
 * shown, carried on the document, reported as an expectation. The ACTUAL
 * TDS Receivable is recognized only where the customer's deduction is
 * confirmed: the receipt (or an adjustment journal). So the sales side must
 * never write a TDS event, and the receipt must — a sales file importing
 * tdsEventFrom is this test's definition of the bug.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('expected TDS never becomes actual before the receipt', () => {
  it('no sales screen writes a TDS event', () => {
    for (const file of ['features/sales/index.jsx', 'features/sales/SalesOrders.jsx', 'features/sales/RecurringInvoices.jsx']) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text.includes('tdsEventFrom'), `${file} must not recognize TDS`).toBe(false);
    }
  });

  it('the receipt is where the actual receivable is recognized', () => {
    const receipt = readFileSync(join(SRC, 'features/payments/RecordReceiptForm.jsx'), 'utf8');
    expect(receipt).toMatch(/tdsEventFrom/);
    expect(receipt).toMatch(/side:\s*'RECEIVABLE'/);
  });
});

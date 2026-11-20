import { describe, it, expect, vi } from 'vitest';

vi.mock('./context', () => ({ orgId: () => 'org-1', branchId: () => 'br-1', warehouseId: () => '' }));

const { idempotencyKeyFor } = await import('./http');

/* Audit, 21 Nov 2026: the operator console's money writes carried no key, so a double click could bill twice. */
describe('which writes carry an Idempotency-Key', () => {
  it('covers the operator console money writes', () => {
    for (const p of ['/ops/payments/manual', '/ops/invoices', '/ops/invoices/inv-1/issue', '/ops/invoices/inv-1/mark-paid', '/ops/invoices/inv-1/void', '/ops/invoicing/renewals/run']) {
      expect(idempotencyKeyFor('POST', p, { n: p })).toBeTruthy();
    }
  });
  it('leaves reads and other operator writes alone', () => {
    expect(idempotencyKeyFor('GET', '/ops/invoices', null)).toBeNull();
    expect(idempotencyKeyFor('POST', '/ops/invoices/inv-1/remind', {})).toBeNull();
    expect(idempotencyKeyFor('POST', '/ops/step-up', { code: '1' })).toBeNull();
  });
  it('reuses the key for the same write sent again at once', () => {
    const a = idempotencyKeyFor('POST', '/ops/payments/manual', { amount: 100 });
    const b = idempotencyKeyFor('POST', '/ops/payments/manual', { amount: 100 });
    const c = idempotencyKeyFor('POST', '/ops/payments/manual', { amount: 200 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

import { describe, expect, it } from 'vitest';
import { firstAvailableNumber } from '../services/numbering.js';

describe('automatic voucher number allocation', () => {
  it('skips an existing number even when a different series or manual entry used it', async () => {
    const existing = new Set(['INV-2627-00101']);
    const client = { invoice: { findFirst: async ({ where }: any) => existing.has(where.number) ? { id: 'taken' } : null } };
    const result = await firstAvailableNumber(client as any, 'company-1', 'INVOICE', { prefix: 'INV-', suffix: '', padding: 5, resetPolicy: 'FISCAL_YEAR' }, 101, '2026-27');
    expect(result).toEqual({ number: 'INV-2627-00102', value: 102 });
  });

  it('checks receipt and payment numbers in the same payment register', async () => {
    const client = { payment: { findFirst: async ({ where }: any) => where.number === 'PAY-005' ? { id: 'taken' } : null } };
    const result = await firstAvailableNumber(client as any, 'company-1', 'PAYMENT', { prefix: 'PAY-', suffix: '', padding: 3, resetPolicy: 'NEVER' }, 5, 'ALL');
    expect(result.number).toBe('PAY-006');
  });
});

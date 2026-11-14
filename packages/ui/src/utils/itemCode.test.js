import { describe, expect, it } from 'vitest';

import { nextItemCode } from './itemCode';

const company = { id: 1, docSettings: {} };

describe('item code numbering', () => {
  it('starts goods at 20001 and services at 10001', () => {
    expect(nextItemCode({ items: [] }, company, 'Goods')).toBe('20001');
    expect(nextItemCode({ items: [] }, company, 'Service')).toBe('10001');
  });

  it('continues within each item type range without reusing a code', () => {
    const db = {
      items: [
        { companyId: 1, code: '20001' },
        { companyId: 1, code: '10001' },
      ],
    };
    expect(nextItemCode(db, company, 'Goods')).toBe('20002');
    expect(nextItemCode(db, company, 'Service')).toBe('10002');
  });
});

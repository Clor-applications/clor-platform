import { describe, expect, it } from 'vitest';

import { accessInWords } from '../services/accessWords.js';

/* Workspace › Members: one person's permissions as sentences, app by app. Pure. */
describe('access in words', () => {
  it('an administrator is said in one line', () => {
    expect(accessInWords(['SALES::Invoices::VIEW'], true)).toEqual([{ app: 'all', label: 'Everything', lines: ['Every app this company has, with its settings, users and roles.'] }]);
  });

  it('says what is changed, what is only looked at, and what is approved, deleted and exported, app by app', () => {
    const words = accessInWords([
      'SALES::Invoices::VIEW', 'SALES::Invoices::CREATE', 'SALES::Invoices::EDIT', 'SALES::Invoices::DELETE',
      'CASHBANK::Receipts::VIEW', 'CASHBANK::Receipts::EXPORT',
      'PAYROLL::Pay runs::VIEW', 'PAYROLL::Pay runs::APPROVE',
      'PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT',
      'SETTINGS::Users::VIEW',
    ]);
    expect(words.map((w) => w.label)).toEqual(['Books', 'People', 'Payroll', 'Company settings']);
    expect(words[0].lines).toEqual(['Adds and changes Invoices', 'Only looks at Receipts', 'Deletes Invoices', 'Exports Receipts']);
    expect(words[1].lines).toEqual(['Adds and changes Employees']);
    expect(words[2].lines).toEqual(['Only looks at Pay runs', 'Approves Pay runs']);
    expect(words[3].lines).toEqual(['Only looks at Users']);
  });

  it('names six areas and counts the rest; a permission with no area is named by its module', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((x) => `SALES::${x}::EDIT`);
    expect(accessInWords(many)[0].lines).toEqual(['Adds and changes A, B, C, D, E, F and 2 more']);
    expect(accessInWords(['REPORTS::::VIEW'])[0]).toEqual({ app: 'company', label: 'Company settings', lines: ['Only looks at Reports'] });
    expect(accessInWords(['SALES::Quotes::VIEW', 'SALES::Orders::VIEW'])[0].lines).toEqual(['Only looks at Orders and Quotes']);
    expect(accessInWords([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { getInvoicePrintSettings } from '@ui/utils/invoicePrintSettings';

describe('invoice print page selection', () => {
  it('infers A5 from an A5 template when paper has not been explicitly selected', () => {
    expect(getInvoicePrintSettings({ templates: { invoice: { templateId: 'a5Compact' } } }).paperSize).toBe('a5');
  });

  it('keeps an explicit paper selection over the template default', () => {
    expect(getInvoicePrintSettings({ templates: { invoice: { templateId: 'a5', paperSize: 'a4' } } }).paperSize).toBe('a4');
  });
});

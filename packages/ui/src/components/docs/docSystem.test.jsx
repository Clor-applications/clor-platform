import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MoneyValue, SalesMetricCard, SalesFormField, SALES_COLUMN_TYPES } from './index';
import { allStatuses, resolveStatus } from '../../utils/statusRegistry';

const CO = { id: 1 };
const role = (c) => c.querySelector('[data-role]')?.getAttribute('data-role');

/** The eight tones the Sales module is allowed to speak in. */
const SALES_TONES = ['draft', 'sent', 'partial', 'paid', 'outstanding', 'overdue', 'cancelled', 'refund'];

describe('Sales design system', () => {
  /*
   * The guarantee the module rests on: every status a Sales screen can render
   * resolves to one of the eight tones. A status without one falls back to a
   * generic pill, which is exactly the drift this system exists to stop.
   */
  it('every document status maps to a Sales tone', () => {
    const missing = allStatuses()
      .map((s) => ({ key: s.key, tone: resolveStatus(s.label).statusTone }))
      .filter((s) => !s.tone);
    expect(missing).toEqual([]);
  });

  it('uses only the eight sanctioned tones', () => {
    const tones = new Set(allStatuses().map((s) => resolveStatus(s.label).statusTone).filter(Boolean));
    expect([...tones].filter((t) => !SALES_TONES.includes(t))).toEqual([]);
  });

  it('money is coloured by what it is, not by who renders it', () => {
    expect(role(render(<MoneyValue value={1} company={CO} kind="paid" />).container)).toBe('paid');
    expect(role(render(<MoneyValue value={1} company={CO} kind="outstanding" />).container)).toBe('outstanding');
    expect(role(render(<MoneyValue value={1} company={CO} kind="overdue" />).container)).toBe('overdue');
    expect(role(render(<MoneyValue value={1} company={CO} kind="refund" />).container)).toBe('credit');
    expect(role(render(<MoneyValue value={1} company={CO} />).container)).toBe('amount');
  });

  it('a metric card takes a tone, never a colour', () => {
    const { container } = render(<SalesMetricCard label="Paid" value={100} company={CO} tone="paid" />);
    const fig = container.querySelector('.ui-mono');
    expect(container.firstChild).toHaveAttribute('data-tone', 'paid');
    expect(fig.getAttribute('style')).toContain('--st-paid-ink');
  });

  it('a form field shows an error in place of its hint, and announces it', () => {
    const { container, rerender } = render(
      <SalesFormField label="Customer" hint="Who is billed"><input /></SalesFormField>
    );
    expect(container.textContent).toContain('Who is billed');
    rerender(<SalesFormField label="Customer" hint="Who is billed" error="Pick a customer"><input /></SalesFormField>);
    expect(container.querySelector('[role="alert"]').textContent).toBe('Pick a customer');
    expect(container.textContent).not.toContain('Who is billed');
  });

  it('a table column may only be one of the known semantic types', () => {
    expect(SALES_COLUMN_TYPES.sort()).toEqual(
      ['balance', 'date', 'documentNumber', 'dueDate', 'money', 'status', 'text'].sort()
    );
  });
});

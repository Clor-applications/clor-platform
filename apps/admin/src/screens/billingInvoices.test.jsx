import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* The customer's side of roadmap item 8: CLOR's invoices in Workspace, Billing, and how to pay one. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: async () => ({ usage: { companies: 1, users: 3 } }) }));
vi.mock('@ui/api/features', () => ({ getEntitlement: async () => ({ plan: { name: 'People', inGoodStanding: true } }) }));
vi.mock('@ui/utils/printElement', () => ({ printElement: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast }));

import BillingPreview from './BillingPreview';

const invoice = {
  id: 'i1', number: 'CLOR/26-27/0007', status: 'ISSUED', overdue: false, issueDate: '2026-11-10T06:00:00Z', dueDate: '2026-11-25T06:00:00Z',
  lines: [{ description: 'CLOR People, 25 users', quantity: 25, unitAmount: 9900, amount: 247500 }], subtotal: 247500, tax: { charged: false }, taxTotal: 0, total: 247500,
  buyer: { name: 'Kaveri Traders' }, seller: { legalName: 'Clor Applications Private Limited' },
  payTo: { upiId: 'clor@okaxis', qr: 'data:image/png;base64,AAA', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234' } },
};

describe('invoices in Workspace, Billing', () => {
  it('lists the account’s invoices and opens one with its UPI QR and bank account', async () => {
    fetches.call.mockImplementation(async (path) => (path === '/billing/invoices' ? { invoices: [{ ...invoice }] } : invoice));
    render(<BillingPreview />);
    fireEvent.click(await screen.findByRole('button', { name: 'CLOR/26-27/0007' }));
    expect(screen.getByText(/One invoice is unpaid/)).toBeTruthy();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByAltText('UPI QR code to pay ₹2,475.00 to clor@okaxis')).toBeTruthy();
    expect(within(dialog).getByText('50200012345678')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Print or save as PDF' })).toBeTruthy();
  });

  it('pays online on the gateway’s page when CLOR has one on, and asks whether it was paid on the way back', async () => {
    const assign = vi.fn();
    const real = window.location;
    delete window.location;
    window.location = { ...new URL('http://localhost:5173/#/billing'), href: 'http://localhost:5173/#/billing', search: '', assign };
    try {
      fetches.call.mockImplementation(async (path) => {
        if (path === '/billing/invoices') return { invoices: [{ ...invoice }], payOnline: true };
        if (path.endsWith('/pay')) return { url: 'https://rzp.io/i/abc', gateway: 'razorpay' };
        return { ...invoice, payOnline: true };
      });
      render(<BillingPreview />);
      expect(await screen.findByText(/pay online by card, UPI or netbanking/)).toBeTruthy();
      expect(screen.queryByText(/card payment/i)).toBeNull();
      fireEvent.click(await screen.findByRole('button', { name: 'CLOR/26-27/0007' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Pay ₹2,475.00 online' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://rzp.io/i/abc'));
      const pay = fetches.call.mock.calls.find(([p]) => p.endsWith('/pay'));
      expect(pay[1].body.returnTo).toMatch(/paid=i1/);
    } finally {
      window.location = real;
    }
  });

  it('back from paying, checks the invoice and shows it', async () => {
    window.history.replaceState(null, '', '/?paid=i1#/billing');
    fetches.call.mockImplementation(async (path) => {
      if (path === '/billing/invoices') return { invoices: [{ ...invoice, status: 'PAID' }], payOnline: true };
      if (path.endsWith('/pay/check')) return { paid: true, status: 'PAID' };
      return { ...invoice, status: 'PAID', paidAt: '2026-11-11T06:00:00Z', paidAmount: 247500, paymentReference: 'pay_X' };
    });
    render(<BillingPreview />);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Paid/)));
    expect(window.location.search).toBe('');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    fetches.call.mockResolvedValue({ invoices: [] });
    render(<BillingPreview />);
    expect(await screen.findByText('No invoices yet.')).toBeTruthy();
  });
});

describe('the Invoices page’s figures (WS-10)', () => {
  it('says the period billed, and the year’s GST as input credit from the list alone', async () => {
    const { invoicePeriod } = await import('./InvoiceDrawer');
    const { invoiceFigures } = await import('./Invoices');
    expect(invoicePeriod({ periodStart: '2026-11-01', periodEnd: '2026-11-30' })).toBe('1–30 Nov 2026');
    expect(invoicePeriod({ periodStart: '2026-10-15', periodEnd: '2026-11-14' })).toBe('15 Oct – 14 Nov 2026');
    expect(invoicePeriod({ issueDate: '2026-11-10T06:00:00Z' })).toMatch(/^Issued /);
    const now = new Date('2026-11-14T00:00:00Z');
    const f = invoiceFigures(
      [
        { status: 'PAID', issueDate: '2026-10-01', paidAt: '2026-10-05', total: 118000, taxTotal: 18000 },
        { status: 'ISSUED', issueDate: '2026-11-01', dueDate: '2026-11-20', total: 59000, taxTotal: 9000 },
        { status: 'VOID', issueDate: '2026-11-02', total: 59000, taxTotal: 9000 },
        { status: 'PAID', issueDate: '2026-02-01', paidAt: '2026-02-05', total: 11800, taxTotal: 1800 },
      ],
      now,
    );
    expect(f.gstThisFy).toBe(27000);
    expect(f.gstCount).toBe(2);
    expect(f.paidThisFy).toBe(118000);
    expect(f.next.total).toBe(59000);
  });
});

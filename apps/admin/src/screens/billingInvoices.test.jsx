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

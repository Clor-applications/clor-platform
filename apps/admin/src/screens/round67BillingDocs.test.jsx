import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Round 67 in Workspace › Invoices: purchase orders, proformas and CLOR's vendor documents; the PO and TDS on the invoice paper. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
vi.mock('@ui/utils/printElement', () => ({ printElement: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: toast, confirmDialog: async () => true }));

import BillingDocs from './BillingDocs';
import { InvoiceDocument } from './InvoiceDocument';

const proforma = {
  id: 'p1', number: 'PF/26-27/0001', createdAt: '2026-11-18T06:00:00Z', validUntil: '2026-12-03T06:00:00Z', expired: false, invoiced: false,
  lines: [{ description: 'CLOR People, 10 users', quantity: 10, unitAmount: 9900, amount: 99000 }], subtotal: 99000, tax: { charged: false }, taxTotal: 0, total: 99000,
  buyer: { name: 'Kaveri Traders' }, seller: { legalName: 'Clor Applications Private Limited' },
};

describe('billing documents for companies', () => {
  it('adds a PO, makes a proforma that prints as not a tax invoice, and lists vendor documents', async () => {
    const pos = [];
    fetches.call.mockImplementation(async (path, opts = {}) => {
      if (path === '/billing/purchase-orders' && opts.method === 'POST') {
        pos.push({ id: 'po1', ...opts.body });
        return pos[0];
      }
      if (path === '/billing/purchase-orders') return { purchaseOrders: [...pos], mayChange: true };
      if (path === '/billing/proformas' && opts.method === 'POST') return proforma;
      if (path === '/billing/proformas') return { proformas: [] };
      if (path === '/billing/vendor-documents') return { documents: [{ id: 'd1', kind: 'GST', title: 'GST certificate', validUntil: null }] };
      return {};
    });
    render(<BillingDocs />);
    expect(await screen.findByRole('button', { name: 'Download GST certificate' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Add a PO' }));
    fireEvent.change(screen.getByLabelText('PO number'), { target: { value: 'PO/4471' } });
    fireEvent.change(screen.getByLabelText('Covers from'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('Covers to'), { target: { value: '2027-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PO' }));
    expect(await screen.findByText('PO/4471')).toBeTruthy();
    expect(fetches.call).toHaveBeenCalledWith('/billing/purchase-orders', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ number: 'PO/4471', fromDate: '2026-04-01' }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Get a proforma' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Proforma invoice')).toBeTruthy();
    expect(within(dialog).getByText(/Not a tax invoice/)).toBeTruthy();
    expect(within(dialog).getByText('Valid until')).toBeTruthy();
  });

  it('a plan with no price says so when a proforma is asked for', async () => {
    fetches.call.mockImplementation(async (path, opts = {}) => {
      if (path === '/billing/proformas' && opts.method === 'POST') throw new Error('Your plan has no price set yet, so a proforma cannot be made. Ask CLOR support for a quote.');
      if (path === '/billing/purchase-orders') return { purchaseOrders: [], mayChange: false };
      return { proformas: [], documents: [] };
    });
    render(<BillingDocs />);
    fireEvent.click(await screen.findByRole('button', { name: 'Get a proforma' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no price/)));
    expect(screen.queryByRole('button', { name: 'Add a PO' })).toBeNull();
  });

  it('the invoice paper prints the PO number and the TDS deducted', () => {
    render(<InvoiceDocument invoice={{ ...proforma, number: 'CLOR/26-27/0009', status: 'PAID', issueDate: proforma.createdAt, poNumber: 'PO/4471', poDate: '2026-04-02', paidAmount: 89100, paidAt: '2026-11-18T06:00:00Z', tdsDeducted: 9900 }} />);
    expect(screen.getByText('PO number')).toBeTruthy();
    expect(screen.getByText('PO/4471')).toBeTruthy();
    expect(screen.getByText(/TDS deducted/)).toBeTruthy();
  });
});

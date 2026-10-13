import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CustomerDetailPage from './CustomerDetailPage';

describe('CustomerDetailPage', () => {
  it('shows the customer master fields saved by the creation form', () => {
    const customer = {
      id: 'customer-1',
      name: 'SKAN Enterprises',
      code: '200001',
      partyGroup: 'Retail Customers',
      contactPerson: 'Anand Kumar',
      phone: '9876543210',
      email: 'accounts@skan.example',
      gstRegistrationType: 'REGULAR',
      gstin: '29ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      paymentTermName: 'Net 30',
      paymentTermDays: 30,
      creditLimit: 250000,
      currency: 'INR',
      openingBalance: 12000,
      openingBalanceType: 'DR',
      msmeNumber: 'UDYAM-KA-01-1234567',
      statutoryOther: 'LUT-2026',
      notes: 'Priority customer',
      addresses: [
        { key: 'BILLING', line1: '55, 5th Main', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
        { key: 'SHIPPING', line1: 'Warehouse Road', city: 'Mysuru', state: 'Karnataka', pincode: '570001' },
      ],
      contacts: [{ name: 'Priya Rao', position: 'Accounts', mobile: '9000000000', email: 'priya@skan.example', isPrimary: true }],
      isActive: true,
    };

    render(<CustomerDetailPage db={{ invoices: [], receipts: [], creditNotes: [], priceLists: [] }} currentCompany={{ currency: 'INR' }} customer={customer} />);

    expect(screen.getAllByText('SKAN Enterprises').length).toBeGreaterThan(0);
    expect(screen.getAllByText('200001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Retail Customers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9876543210').length).toBeGreaterThan(0);
    expect(screen.getAllByText('accounts@skan.example').length).toBeGreaterThan(0);
    expect(screen.getAllByText('29ABCDE1234F1Z5').length).toBeGreaterThan(0);
    expect(screen.getByText('55, 5th Main')).toBeInTheDocument();
    expect(screen.getByText('Warehouse Road')).toBeInTheDocument();
    expect(screen.getAllByText('Karnataka')).toHaveLength(2);
    expect(screen.getByText('560001')).toBeInTheDocument();
    expect(screen.getByText('570001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(screen.getByText(/Priya Rao/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Credit Details' }));
    expect(screen.getAllByText('Net 30').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Statutory Details' }));
    expect(screen.getByText('ABCDE1234F')).toBeInTheDocument();
    expect(screen.getByText('UDYAM-KA-01-1234567')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Others' }));
    expect(screen.getByText('Priority customer')).toBeInTheDocument();
  });

  it('shows a complete customer ledger in Statement', () => {
    const customer = { id: 7, companyId: 1, name: 'Ledger Customer', code: '200007', openingBalance: 500, openingBalanceType: 'DR' };
    const db = {
      invoices: [{ id: 1, companyId: 1, customerId: 7, number: 'INV-1', date: '2026-09-01', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, gstTotal: 180, total: 1180, paidAmount: 0, status: 'Posted', items: [{ itemId: 11, name: 'Consulting', taxableAmount: 1000 }] }],
      payments: [{ id: 2, companyId: 1, customerId: 7, number: 'RCPT-1', date: '2026-09-02', voucherType: 'receipt', amount: 400, tdsAmount: 10 }],
      creditNotes: [{ id: 3, companyId: 1, customerId: 7, number: 'CN-1', date: '2026-09-03', taxableAmount: 100, taxAmount: 18, total: 118 }],
      debitNotes: [{ id: 4, companyId: 1, customerId: 7, number: 'DN-1', date: '2026-09-04', total: 50 }],
      salesReturns: [{ id: 5, companyId: 1, customerId: 7, number: 'SR-1', date: '2026-09-05', total: 25 }],
      priceLists: [],
    };

    render(<CustomerDetailPage db={db} currentCompany={{ id: 1, currency: 'INR' }} customer={customer} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));

    for (const voucher of ['OPENING', 'INV-1', 'RCPT-1', 'CN-1', 'DN-1', 'SR-1']) {
      expect(screen.getByText(voucher)).toBeInTheDocument();
    }
    for (const heading of ['Date', 'Type', 'Voucher No.', 'Debit', 'Credit', 'Balance', 'Action']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('OPENING');

    fireEvent.click(screen.getByRole('button', { name: 'INV-1' }));
    const invoiceDialog = screen.getByRole('dialog');
    expect(invoiceDialog).toHaveTextContent('Invoice · INV-1');
    expect(invoiceDialog).toHaveTextContent('Bill To');
    expect(within(invoiceDialog).getByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(within(invoiceDialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(invoiceDialog).queryByLabelText('Close')).not.toBeInTheDocument();
  });

  it('uses the customer form series when a legacy record has an old generated code', () => {
    const customer = { id: 2, companyId: 1, name: 'Legacy Customer', code: 'CUST-002' };
    const db = { customers: [{ id: 1, companyId: 1, name: 'First', code: '200000' }, customer], invoices: [], payments: [], creditNotes: [], priceLists: [] };

    render(<CustomerDetailPage db={db} currentCompany={{ id: 1, currency: 'INR' }} customer={customer} />);

    expect(screen.getAllByText('200001').length).toBeGreaterThan(0);
    expect(screen.queryByText('CUST-002')).not.toBeInTheDocument();
  });

  it('uses the same Details, Summary and Statement experience for vendors', () => {
    const vendor = { id: 9, companyId: 1, name: 'Supply House', code: 'V-009', openingBalance: 200, openingBalanceType: 'CR', msmeRegistered: true, msmeNumber: 'UDYAM-KA-01-9999999' };
    const db = {
      vendors: [vendor],
      bills: [{ id: 10, companyId: 1, vendorId: 9, number: 'BILL-10', date: '2026-09-10', subtotal: 1000, cgstTotal: 90, sgstTotal: 90, total: 1180, paidAmount: 300, status: 'Posted' }],
      payments: [{ id: 11, companyId: 1, vendorId: 9, number: 'PAY-11', date: '2026-09-11', amount: 300, voucherType: 'payment' }],
      debitNotes: [{ id: 12, companyId: 1, vendorId: 9, number: 'DN-12', date: '2026-09-12', total: 118, subtotal: 100, cgstTotal: 9, sgstTotal: 9 }],
      invoices: [], creditNotes: [], salesReturns: [], priceLists: [],
    };

    render(<CustomerDetailPage db={db} currentCompany={{ id: 1, name: 'Neev', currency: 'INR' }} customer={vendor} partyKind="vendor" />);
    expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByText('Vendor Code')).toBeInTheDocument();
    expect(screen.getAllByText('V-009').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    expect(screen.getByText('Total purchases')).toBeInTheDocument();
    expect(screen.getByText('Amount paid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Statement' }));
    for (const voucher of ['OPENING', 'BILL-10', 'PAY-11', 'DN-12']) expect(screen.getByText(voucher)).toBeInTheDocument();
  });
});

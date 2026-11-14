// @vitest-environment jsdom
import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { TransactionView } from './TransactionsList';
import Modal from '@ui/components/ui/Modal';
import { normalizeDB } from '../../data/db';
import InvoiceTemplateDesigner from '../settings/InvoiceTemplateDesigner';

test('receipt customization persists and appears when the voucher is reopened', () => {
  let db = { companies: [{ id: 7, name: 'Example Co', docSettings: { templates: { receipt: { templateId: 'modernReceipt' } } } }], customers: [], invoices: [], chartOfAccounts: [], cashBankAccounts: [] };
  const setDb = vi.fn((updater) => { db = normalizeDB(updater(db)); });
  const actionsRef = createRef();
  const payload = () => ({ receiptView: true, db, currentCompany: db.companies[0], documentNumber: 'RCPT-1', date: '2026-10-27', amount: 100 });
  const view = render(<Modal title="Receipt RCPT-1" onClose={() => {}}><TransactionView title="Receipt RCPT-1" payload={payload()} setDb={setDb} actionsRef={actionsRef} /></Modal>);
  act(() => actionsRef.current.customize());
  expect(screen.getByRole('dialog', { name: 'Customize receipt template' }).parentElement.parentElement).toBe(document.body);
  fireEvent.change(screen.getByDisplayValue('RECEIPT'), { target: { value: 'PAYMENT RECEIPT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  expect(setDb).toHaveBeenCalled();
  expect(db.companies[0].docSettings.templates.receipt.printTitle).toBe('PAYMENT RECEIPT');
  view.unmount();
  const master = render(<InvoiceTemplateDesigner db={db} setDb={setDb} currentCompany={db.companies[0]} initialVoucherKey="receipt" />);
  expect(screen.getByLabelText('Document title').value).toBe('PAYMENT RECEIPT');
  fireEvent.change(screen.getByLabelText('Footer note'), { target: { value: 'Saved from Master Data' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(db.companies[0].docSettings.templates.receipt.footerText).toBe('Saved from Master Data');
  master.unmount();
  render(<TransactionView title="Receipt RCPT-1" payload={payload()} setDb={setDb} actionsRef={createRef()} />);
  expect(screen.getAllByText('PAYMENT RECEIPT').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Saved from Master Data').length).toBeGreaterThan(0);
});

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import Expenses from './Expenses';

/*
 * People › Expenses (People plan 8 Nov 2026, step 4): HR records a claim on
 * someone's behalf. The one primary asks which person, then their bills, and
 * sends the claim under that person's name.
 */
const api = vi.hoisted(() => ({
  listClaims: vi.fn(), payClaim: vi.fn(), sanctionClaim: vi.fn(), markRecorded: vi.fn(), listAdvances: vi.fn(), payAdvance: vi.fn(), advanceReturned: vi.fn(), recoverAdvance: vi.fn(),
  listSalaryAdvances: vi.fn(), sendToPayroll: vi.fn(), moneyRequest: vi.fn(), getReport: vi.fn(), listCategories: vi.fn(), saveCategory: vi.fn(), openBill: vi.fn(), downloadCsv: vi.fn(),
  recordClaim: vi.fn(), readBill: vi.fn(),
}));
vi.mock('../api/money', () => api);
vi.mock('@ui/personnel/PickPersonDrawer', () => ({ default: ({ title, onPick }) => <div role="dialog" aria-label={title}><button type="button" onClick={() => onPick({ id: 'e1', name: 'Asha Nair', code: 'E-1' })}>Pick Asha</button></div> }));
const perms = { current: new Set(['PEOPLE::Expenses::VIEW', 'PEOPLE::Expenses::EDIT']) };
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({ isAdmin: false, permissions: perms.current }) }));

beforeEach(() => {
  vi.clearAllMocks();
  perms.current = new Set(['PEOPLE::Expenses::VIEW', 'PEOPLE::Expenses::EDIT']);
  api.listClaims.mockResolvedValue(Object.assign([], { reimbursement: null }));
  api.listCategories.mockResolvedValue([{ id: 'cat1', name: 'Travel', active: true, limitPerBill: null }, { id: 'cat2', name: 'Food and meals', active: true, limitPerBill: 500 }]);
  api.recordClaim.mockResolvedValue({ id: 'cl1', number: 'EXP-0007', claimed: 570, status: 'SUBMITTED' });
});

it('Record a claim is the one primary; it asks which person, then the bills, and sends them under that person', async () => {
  render(<Expenses params={{}} updateParams={() => {}} />);
  await screen.findByText('Nothing to pay');
  expect(document.querySelectorAll('.ui-btn-primary')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Record a claim' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Record a claim' })).getByText('Pick Asha'));
  await screen.findByRole('heading', { name: 'Record a claim for Asha Nair' });
  /* An empty bill is refused before anything is sent. */
  fireEvent.click(screen.getByRole('button', { name: 'Record claim' }));
  expect(await screen.findByText(/Each bill needs the day/)).toBeTruthy();
  expect(api.recordClaim).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText('The shop, cab or hotel'), { target: { value: 'Uber' } });
  fireEvent.change(screen.getByLabelText('Amount for bill 1'), { target: { value: '570' } });
  /* The category picker: open it and choose Travel. */
  fireEvent.click(screen.getByRole('combobox', { name: 'For *' }));
  fireEvent.click(await screen.findByRole('option', { name: /Travel/ }));
  expect(screen.getByText('₹570')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Record claim' }));
  await waitFor(() => expect(api.recordClaim).toHaveBeenCalledTimes(1));
  const sent = api.recordClaim.mock.calls[0][0];
  expect(sent).toMatchObject({ employeeId: 'e1', lines: [{ categoryId: 'cat1', merchant: 'Uber', amount: 570 }] });
  expect(sent.lines[0].spentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('someone who may only see expenses gets no Record a claim', async () => {
  perms.current = new Set(['PEOPLE::Expenses::VIEW']);
  render(<Expenses params={{}} updateParams={() => {}} />);
  await screen.findByText('Nothing to pay');
  expect(screen.queryByRole('button', { name: 'Record a claim' })).toBeNull();
});

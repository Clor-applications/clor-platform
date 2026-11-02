import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import MyMoney from './MyMoney';
import { MyDetails } from './MyDetails';

/*
 * The Me tab on a phone (QA, 1 Nov 2026): "Add a bill" and "Change details" were
 * small buttons, 28px tall. Each sits inside a `.ui-touch-44` card, which makes
 * every control in it 44px under 768px wide (packages/ui index.css).
 */
const portal = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  todayIst: () => '2026-11-02',
  getMyDetails: vi.fn(),
  getLeaving: vi.fn(async () => null),
  getPolicies: vi.fn(async () => ({ policies: [] })),
  getPolicy: vi.fn(),
  acceptItem: vi.fn(),
  answerMyRequest: vi.fn(),
  askDetailsChange: vi.fn(),
  shrinkPhoto: vi.fn(),
  withdrawMyRequest: vi.fn(),
}));
vi.mock('./portalApi', () => portal);
const money = vi.hoisted(() => ({
  getMoney: vi.fn(), addBill: vi.fn(), answerMoney: vi.fn(), askAdvance: vi.fn(), askSalaryAdvance: vi.fn(), billData: vi.fn(), billUrl: vi.fn(),
  previewSalaryAdvance: vi.fn(), reopenClaim: vi.fn(), removeBill: vi.fn(), sendClaim: vi.fn(), withdrawMoney: vi.fn(),
}));
vi.mock('./moneyApi', () => money);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
const guard = (p) => p;

it('Add a bill is a 44px target on a phone', async () => {
  money.getMoney.mockResolvedValue({ draft: null, claims: [], advances: [], categories: [], salaryAdvance: null });
  render(<MyMoney guard={guard} />);
  const add = await screen.findByRole('button', { name: /Add a bill/ });
  expect(add.closest('.ui-touch-44')).toBeTruthy();
});

it('Change details is a 44px target on a phone', async () => {
  portal.getMyDetails.mockResolvedValue({
    terms: null, requests: [], hrDecidesWithinDays: 3,
    fields: { phone: '98450 00000' }, labels: { phone: 'Phone' }, atOnce: ['phone'], changeAtOnce: ['phone'],
  });
  render(<MyDetails guard={guard} />);
  const change = await screen.findByRole('button', { name: /Change details|Ask HR to change/ });
  expect(change.closest('.ui-touch-44')).toBeTruthy();
});

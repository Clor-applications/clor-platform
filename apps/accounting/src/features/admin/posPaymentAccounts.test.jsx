import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getPosTenderAccounts = vi.fn();
const setPosTenderAccount = vi.fn();
const clearPosTenderAccount = vi.fn();

vi.mock('../../api/posTenderAccounts', () => ({
  getPosTenderAccounts: (...a) => getPosTenderAccounts(...a),
  setPosTenderAccount: (...a) => setPosTenderAccount(...a),
  clearPosTenderAccount: (...a) => clearPosTenderAccount(...a),
}));

import PosPaymentAccounts from './PosPaymentAccounts';

/**
 * The counter's accounts, as a screen.
 *
 * What matters here is that the screen never invents an answer: it offers only
 * what the server called eligible, it selects nothing by default, and an
 * unconfigured tender says so rather than looking merely empty.
 */

const unconfigured = (controlKind) => ({ status: 'UNCONFIGURED', ledgerAccountId: null, ledgerName: null, controlKind });

const payload = (over = {}) => ({
  branchId: 'br-1',
  tenders: {
    CASH: unconfigured('CASH'),
    UPI: unconfigured('BANK'),
    CARD: unconfigured('BANK'),
    ...(over.tenders || {}),
  },
  eligibleAccounts: over.eligibleAccounts || [
    { id: 'till-1', code: '1210', name: 'Counter Till', controlKind: 'CASH', shared: false },
    { id: 'bank-1', code: '1310', name: 'HDFC Current', controlKind: 'BANK', shared: true },
  ],
});

beforeEach(() => {
  getPosTenderAccounts.mockReset().mockResolvedValue(payload());
  setPosTenderAccount.mockReset();
  clearPosTenderAccount.mockReset();
});

describe('POS payment accounts', () => {
  it('says plainly when a tender cannot be taken', async () => {
    render(<PosPaymentAccounts />);
    await screen.findByText('Cash');
    expect(screen.getByText(/counter cannot take cash/i)).toBeInTheDocument();
    expect(screen.getByText(/counter cannot take upi/i)).toBeInTheDocument();
  });

  it('selects nothing by default — a business chooses where its money lands', async () => {
    render(<PosPaymentAccounts />);
    const cash = await screen.findByLabelText('Cash account');
    expect(cash.value).toBe('');
    expect(setPosTenderAccount).not.toHaveBeenCalled();
  });

  it('offers only the accounts that suit each tender', async () => {
    render(<PosPaymentAccounts />);
    const cash = await screen.findByLabelText('Cash account');
    const upi = screen.getByLabelText('UPI account');

    const names = (el) => [...el.querySelectorAll('option')].map((o) => o.textContent);
    expect(names(cash)).toContain('Counter Till');
    expect(names(cash)).not.toContain('HDFC Current · shared');
    expect(names(upi)).toContain('HDFC Current · shared');
    expect(names(upi)).not.toContain('Counter Till');
  });

  it('saves the chosen account and shows what came back', async () => {
    setPosTenderAccount.mockResolvedValue({
      ...payload().tenders,
      CASH: { status: 'DIRECT', ledgerAccountId: 'till-1', ledgerName: 'Counter Till', controlKind: 'CASH' },
    });
    render(<PosPaymentAccounts />);
    const cash = await screen.findByLabelText('Cash account');
    fireEvent.change(cash, { target: { value: 'till-1' } });

    await waitFor(() => expect(setPosTenderAccount).toHaveBeenCalledWith({ tender: 'CASH', ledgerAccountId: 'till-1' }));
    await waitFor(() => expect(screen.getByLabelText('Cash account').value).toBe('till-1'));
    expect(screen.queryByText(/counter cannot take cash/i)).toBeNull();
  });

  it('clears the mapping back to unconfigured rather than to some other account', async () => {
    getPosTenderAccounts.mockResolvedValue(
      payload({ tenders: { CASH: { status: 'DIRECT', ledgerAccountId: 'till-1', ledgerName: 'Counter Till', controlKind: 'CASH' } } })
    );
    clearPosTenderAccount.mockResolvedValue(payload().tenders);

    render(<PosPaymentAccounts />);
    const cash = await screen.findByLabelText('Cash account');
    expect(cash.value).toBe('till-1');

    fireEvent.change(cash, { target: { value: '' } });
    await waitFor(() => expect(clearPosTenderAccount).toHaveBeenCalledWith('CASH'));
    await waitFor(() => expect(screen.getByText(/counter cannot take cash/i)).toBeInTheDocument());
  });

  it('says where to start when the business has opened no accounts', async () => {
    getPosTenderAccounts.mockResolvedValue(payload({ eligibleAccounts: [] }));
    render(<PosPaymentAccounts />);
    expect(await screen.findByText(/No cash or bank accounts have been opened/i)).toBeInTheDocument();
  });

  it('surfaces a server refusal instead of pretending it saved', async () => {
    setPosTenderAccount.mockRejectedValue(new Error('Cash has to be received into a cash account'));
    render(<PosPaymentAccounts />);
    const cash = await screen.findByLabelText('Cash account');
    fireEvent.change(cash, { target: { value: 'till-1' } });
    await waitFor(() => expect(setPosTenderAccount).toHaveBeenCalled());
    // The selection does not stick, because the server did not accept it.
    await waitFor(() => expect(screen.getByLabelText('Cash account').value).toBe(''));
  });
});

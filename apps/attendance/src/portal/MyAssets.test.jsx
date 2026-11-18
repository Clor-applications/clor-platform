import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  SignedOut: class SignedOut extends Error {},
  getMyAssets: vi.fn(),
  confirmMyAsset: vi.fn(async () => ({})),
  reportAssetProblem: vi.fn(async () => ({})),
  askForAsset: vi.fn(async () => ({})),
  askToStay: vi.fn(async () => ({})),
  getLeaving: vi.fn(),
  getMyDetails: vi.fn(async () => ({ terms: { noticeDays: 30 } })),
  getJourney: vi.fn(),
  doneJourneyTask: vi.fn(),
  getPayslips: vi.fn(),
  getPayslip: vi.fn(),
  raisePrivateCase: vi.fn(),
  resign: vi.fn(),
  todayIst: () => '2026-11-18',
}));
vi.mock('./portalApi', () => api);
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

const { default: MyAssets, assetLine } = await import('./MyAssets');
const { LeavingCompany } = await import('./MeExtras');
const guard = (p) => p;
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const LAPTOP = { id: 'a1', title: 'Laptop', tag: 'LT-9', category: 'Laptop', state: 'Good', issuedOn: '2026-01-02', confirmedOn: null, problem: null, problemOn: null };

describe('company things with me (round 51)', () => {
  it('says the tag, the condition and when I confirmed it', () => {
    expect(assetLine(LAPTOP, '2026-11-18')).toBe('LT-9 · Good');
    expect(assetLine({ ...LAPTOP, confirmedOn: '2026-11-18' }, '2026-11-18')).toBe('LT-9 · Good · You confirmed it today');
    expect(assetLine({ ...LAPTOP, confirmedOn: '2026-10-02' }, '2026-11-18')).toBe('LT-9 · Good · You confirmed it on 2 Oct');
  });

  it('shows nothing where the company does not keep assets in CLOR', async () => {
    api.getMyAssets.mockResolvedValue({ available: false, assets: [] });
    const { container } = render(<MyAssets guard={guard} />);
    await waitFor(() => expect(api.getMyAssets).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('confirms, reports a problem and asks for something, each sent once', async () => {
    api.getMyAssets.mockResolvedValue({ available: true, assets: [LAPTOP] });
    render(<MyAssets guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'I still have this' }));
    await waitFor(() => expect(api.confirmMyAsset).toHaveBeenCalledWith('a1'));

    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    const send = screen.getByRole('button', { name: 'Send to HR' });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What is wrong with Laptop?'), { target: { value: 'The hinge is cracked' } });
    fireEvent.click(send);
    await waitFor(() => expect(api.reportAssetProblem).toHaveBeenCalledWith('a1', 'The hinge is cracked'));
    expect(await screen.findByText(/answer comes in Ask HR/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ask for something you need' }));
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Headset' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to HR' }));
    await waitFor(() => expect(api.askForAsset).toHaveBeenCalledWith('Headset'));
  });

  it('shows a reported problem and hides the confirm once confirmed today', async () => {
    api.getMyAssets.mockResolvedValue({ available: true, assets: [{ ...LAPTOP, confirmedOn: '2026-11-18', problem: 'Screen flickers', problemOn: '2026-11-17' }] });
    render(<MyAssets guard={guard} />);
    expect(await screen.findByText(/Problem reported on 17 Nov: Screen flickers/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I still have this' })).toBeNull();
  });
});

describe('taking back a resignation (round 52)', () => {
  it('offers "Ask to stay" to someone on notice after resigning, and says when it is with the manager', async () => {
    api.getLeaving.mockResolvedValue({ status: 'ON_NOTICE', lastDay: '2026-12-10', leavingType: 'RESIGNED', waiting: null, staying: null });
    render(<LeavingCompany guard={guard} refreshKey={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Changed your mind? Ask to stay' }));
    await waitFor(() => expect(api.askToStay).toHaveBeenCalledTimes(1));
  });

  it('is not offered for a leaving HR recorded as a termination, and shows a waiting ask', async () => {
    api.getLeaving.mockResolvedValue({ status: 'ON_NOTICE', lastDay: '2026-12-10', leavingType: 'TERMINATED', waiting: null, staying: null });
    const { unmount } = render(<LeavingCompany guard={guard} refreshKey={0} />);
    expect(await screen.findByText(/Your last working day is/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask to stay/ })).toBeNull();
    unmount();
    api.getLeaving.mockResolvedValue({ status: 'ON_NOTICE', lastDay: '2026-12-10', leavingType: 'RESIGNED', waiting: null, staying: { id: 'r1', status: 'WAITING' } });
    render(<LeavingCompany guard={guard} refreshKey={0} />);
    expect(await screen.findByText('You asked to stay. Your manager will answer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ask to stay/ })).toBeNull();
  });
});

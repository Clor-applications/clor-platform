import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountOverview = vi.hoisted(() => vi.fn());
vi.mock('@platform/admin/admin', async (orig) => ({ ...(await orig()), getAccountOverview: (...a) => getAccountOverview(...a) }));

import Companies from './Companies';

beforeEach(() => {
  getAccountOverview.mockReset().mockResolvedValue({ companies: [{ orgId: 'c1', name: 'Neev Steels', gstin: '', people: 2, apps: [] }], plan: null });
});

/* Audit 21 Nov 2026: a failed read showed "No company yet". */
describe('Companies', () => {
  it('a failed load offers a retry instead of an empty list', async () => {
    getAccountOverview.mockRejectedValueOnce(new Error('down'));
    render(<Companies tenant={{ id: 'c1' }} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText('No company yet.')).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Neev Steels' })).toBeInTheDocument();
  });
});

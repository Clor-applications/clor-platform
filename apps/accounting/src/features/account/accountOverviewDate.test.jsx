import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/admin', () => ({
  getAccountOverview: vi.fn(async () => ({
    org: { name: 'UI QA Organisation' },
    plan: {},
    limits: {},
    usage: {},
    users: [
      { id: 1, name: 'Meera Raghunathan', email: 'meera@example.test', active: true, lastLoginAt: '2026-12-09T12:00:00.000Z' },
      { id: 2, name: 'Anand Subramanian', email: 'anand@example.test', active: true, lastLoginAt: null },
    ],
  })),
}));

import AccountOverview from './AccountOverview';
import { formatDateIn, localDateIso } from '@ui/utils/dates';

/**
 * The rendered proof, not just the helper's.
 *
 * A unit test on `formatDateIn` says the function is right; it does not say
 * the screen calls it. This one renders the real component and reads the day
 * off the page — 9 December has to arrive as `09/12/2026`, which is the
 * reading that a bare `toLocaleDateString()` got wrong on a US-locale machine.
 *
 * The expected day is derived rather than hard-coded: the screen shows the
 * LOCAL date, and no single instant is the same calendar day in every zone —
 * midday UTC on 9 December is already the 10th in Auckland. So the test pins
 * the two things that actually matter and hold everywhere: the shape is
 * `dd/mm/yyyy`, and it is not what the browser would have volunteered.
 */
describe('the people list', () => {
  it('writes a last-signed-in date the Indian way', async () => {
    render(<AccountOverview currentCompany={{ id: 1, name: 'UI QA Organisation' }} />);
    await waitFor(() => expect(screen.getByText(/Last signed in/)).toBeTruthy());
    const line = screen.getByText(/Last signed in/).textContent;

    const stamp = '2026-12-09T12:00:00.000Z';
    expect(line).toContain(formatDateIn(localDateIso(stamp)));

    /* Zero-padded day first — the product's shape, not the platform's. */
    expect(line).toMatch(/Last signed in \d{2}\/\d{2}\/\d{4}/);

    /* And explicitly not the US rendering of the same instant, which is what
       a bare `toLocaleDateString()` produced on a US-locale machine. */
    expect(line).not.toContain(new Date(stamp).toLocaleDateString('en-US'));
  });

  it('says so plainly when there is no date to write', async () => {
    render(<AccountOverview currentCompany={{ id: 1, name: 'UI QA Organisation' }} />);
    /* `new Date(null)` is the epoch, so the guard in `localDateIso` is what
       keeps this from reading "Last signed in 01/01/1970". */
    await waitFor(() => expect(screen.getByText('Never signed in')).toBeTruthy());
    expect(screen.queryByText(/1970/)).toBeNull();
  });
});

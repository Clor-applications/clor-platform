import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * GAP-006: Workspace → Outside access lists the people from other
 * accounts the company let in, in words (never colour alone), with only the
 * actions their state allows; an ended grant offers none.
 */

const api = {
  listOutsideAccess: vi.fn(),
  changeOutsideAccess: vi.fn(),
  pauseOutsideAccess: vi.fn(),
  resumeOutsideAccess: vi.fn(),
  endOutsideAccess: vi.fn(),
};
vi.mock('@platform/admin/outsideAccess', () => api);

const { default: OutsideAccess } = await import('./OutsideAccess');
const { actionsFor, appsText } = await import('./outsideAccessModel');

/* Access that ends some months from today, whatever today is: a past end date cannot be kept on a change. */
const ENDS = new Date(Date.now() + 330 * 60_000 + 150 * 86_400_000).toISOString().slice(0, 10);
const row = (over) => ({
  id: 'o1', person: { id: 'u1', name: 'Ravi Menon', email: 'ravi@firm.example', code: null }, from: { code: 'FIRM', name: 'Menon & Co' },
  status: 'ACTIVE', effective: 'ACTIVE', apps: ['accounting'], expiresAt: `${ENDS}T00:00:00Z`, grantedBy: 'Asha', grantedAt: '2026-10-24T00:00:00Z',
  endedBy: null, endedAt: null, reason: null, ...over,
});
const APPS = ['accounting', 'payroll', 'people', 'attendance'];

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('the list', () => {
  it('says who, from where, what they may use, until when, and who granted it', async () => {
    api.listOutsideAccess.mockResolvedValue({
      apps: APPS,
      outsideAccess: [
        row(),
        row({ id: 'o2', person: { id: 'u2', name: 'Auditor', email: 'a@audit.example' }, status: 'SUSPENDED', effective: 'SUSPENDED', apps: null, expiresAt: null, endedBy: 'Asha', endedAt: '2026-10-25T00:00:00Z', reason: 'Audit paused', grantedBy: null }),
        row({ id: 'o3', person: { id: 'u3', name: 'Old CA', email: 'old@ca.example' }, effective: 'EXPIRED' }),
      ],
    });
    render(<OutsideAccess />);
    await waitFor(() => expect(screen.getByText('Ravi Menon')).toBeTruthy());
    expect(screen.getAllByText(/from Menon & Co/).length).toBe(3);
    expect(screen.getAllByText('Books').length).toBeGreaterThan(0);
    expect(screen.getByText('Everything the company has')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Carried over')).toBeTruthy();
    expect(screen.getByText(/Audit paused/)).toBeTruthy();
    expect(screen.getByLabelText('Resume access for Auditor')).toBeTruthy();
    expect(screen.queryByLabelText('Pause access for Auditor')).toBeNull();
  });

  it('says how somebody gets here when nobody has', async () => {
    api.listOutsideAccess.mockResolvedValue({ apps: APPS, outsideAccess: [] });
    render(<OutsideAccess />);
    await waitFor(() => expect(screen.getByText(/Add an accountant or auditor under Users/)).toBeTruthy());
  });
});

describe('changing it', () => {
  it('changes the apps and the end date, sending only what was chosen', async () => {
    api.listOutsideAccess.mockResolvedValue({ apps: APPS, outsideAccess: [row()] });
    api.changeOutsideAccess.mockResolvedValue({ ok: true });
    render(<OutsideAccess />);
    fireEvent.click(await screen.findByLabelText('Change access for Ravi Menon'));
    fireEvent.click(screen.getByLabelText('Payroll'));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(api.changeOutsideAccess).toHaveBeenCalled());
    const [id, patch] = api.changeOutsideAccess.mock.calls[0];
    expect(id).toBe('o1');
    expect(patch.apps).toEqual(['accounting', 'payroll']);
    expect(patch.expiresAt.slice(0, 10)).toBe(ENDS);
  });

  it('ending asks first and records why', async () => {
    api.listOutsideAccess.mockResolvedValue({ apps: APPS, outsideAccess: [row()] });
    api.endOutsideAccess.mockResolvedValue({ ok: true });
    render(<OutsideAccess />);
    fireEvent.click(await screen.findByLabelText('End access for Ravi Menon'));
    fireEvent.change(screen.getByPlaceholderText('Optional — kept in the history'), { target: { value: 'Engagement over' } });
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    await waitFor(() => expect(api.endOutsideAccess).toHaveBeenCalledWith('o1', 'Engagement over'));
  });
});

describe('the rules', () => {
  it('an ended grant offers nothing; a paused one offers resume', () => {
    expect(actionsFor({ status: 'REVOKED' })).toEqual([]);
    expect(actionsFor({ status: 'SUSPENDED' })).toEqual(['resume', 'change', 'end']);
    expect(actionsFor({ status: 'ACTIVE' })).toEqual(['pause', 'change', 'end']);
    expect(appsText(null)).toBe('Everything the company has');
    expect(appsText(['accounting', 'payroll'])).toBe('Books, Payroll');
  });
});

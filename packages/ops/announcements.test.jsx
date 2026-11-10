import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsAnnouncements: vi.fn(), opsAnnouncementSave: vi.fn(), opsAnnouncementPublish: vi.fn(), opsAnnouncementEnd: vi.fn(), opsAnnouncementDelete: vi.fn() }));
vi.mock('./api', () => Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Announcements } from './Announcements';

const A = (o = {}) => ({
  id: 'n1',
  title: 'Payroll maintenance tonight',
  body: 'Payroll is down for ten minutes at 11 pm.',
  kind: 'maintenance',
  apps: ['payroll'],
  audience: 'everyone',
  startsAt: '2026-11-11T05:00:00Z',
  endsAt: null,
  publishedAt: '2026-11-11T05:00:00Z',
  endedAt: null,
  status: 'live',
  closedBy: 3,
  writtenBy: 'Ravi',
  ...o,
});
const list = (rows) => ({ announcements: rows, counts: { live: rows.filter((r) => r.status === 'live').length, scheduled: 0, draft: rows.filter((r) => r.status === 'draft').length, ended: 0 }, apps: ['accounting', 'people', 'attendance', 'payroll'] });

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: announcements', () => {
  it('lists what is showing, with who it is for, and ends one after asking', async () => {
    api.opsAnnouncements.mockResolvedValue(list([A(), A({ id: 'd1', title: 'New letters in People', kind: 'info', status: 'draft', publishedAt: null, apps: [], closedBy: 0 })]));
    api.opsAnnouncementEnd.mockResolvedValue({});
    render(<Announcements me={{ role: 'SUPPORT' }} />);
    const rows = within(await screen.findByRole('list', { name: 'Announcements' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Planned maintenance');
    expect(rows[0]).toHaveTextContent('For everyone using Payroll');
    expect(rows[0]).toHaveTextContent('closed by 3 people');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'End now' }));
    expect(await screen.findByText(/stops showing to everyone/)).toBeInTheDocument();
    const ends = screen.getAllByRole('button', { name: 'End now' });
    fireEvent.click(ends[ends.length - 1]);
    await waitFor(() => expect(api.opsAnnouncementEnd).toHaveBeenCalledWith('n1', undefined));
  });

  it('writes a draft with a live preview, then publishes it', async () => {
    api.opsAnnouncements.mockResolvedValue(list([]));
    api.opsAnnouncementSave.mockResolvedValue({ announcement: A({ id: 'n2', status: 'draft', publishedAt: null }) });
    render(<Announcements me={{ role: 'SUPER_ADMIN' }} />);
    expect(await screen.findByText('Nothing is showing to customers.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Payslips are slow' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'We are fixing it; payslips may take an hour.' } });
    fireEvent.click(screen.getByRole('radio', { name: /Problem we are fixing/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payroll' }));
    /* The preview is what customers will see; a problem notice has no close button. */
    expect(screen.getByRole('alert')).toHaveTextContent('Payslips are slow');
    expect(screen.queryByRole('button', { name: /Close: Payslips/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(api.opsAnnouncementSave).toHaveBeenCalledWith(undefined, { title: 'Payslips are slow', body: 'We are fixing it; payslips may take an hour.', kind: 'incident', apps: ['payroll'], audience: 'everyone', endsAt: null, startsAt: null }),
    );
  });

  it('read-only staff can look but not write', async () => {
    api.opsAnnouncements.mockResolvedValue(list([A()]));
    render(<Announcements me={{ role: 'READ_ONLY' }} />);
    await screen.findByRole('list', { name: 'Announcements' });
    expect(screen.queryByRole('button', { name: 'New announcement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End now' })).toBeNull();
  });
});

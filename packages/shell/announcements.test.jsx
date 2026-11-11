import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => http.apiFetch(...a) }));

import { AnnouncementBar } from './Announcements';

const N = (o = {}) => ({ id: 'n1', title: 'New letters', body: 'People can now send offer letters.', kind: 'info', dismissible: true, endsAt: null, ...o });

beforeEach(() => {
  http.apiFetch.mockReset();
});

describe('announcements bar', () => {
  it('shows a problem first and without a close button; news closes for good', async () => {
    http.apiFetch.mockImplementation((path) =>
      path === '/announcements' ? Promise.resolve({ announcements: [N({ id: 'f1', title: 'Payslips are slow', kind: 'incident', dismissible: false }), N()] }) : Promise.resolve({ dismissed: true }),
    );
    render(<AnnouncementBar />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Payslips are slow');
    expect(screen.queryByRole('button', { name: 'Close: Payslips are slow' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close: New letters' }));
    await waitFor(() => expect(http.apiFetch).toHaveBeenCalledWith('/announcements/n1/dismiss', { method: 'POST', body: {} }));
    expect(screen.queryByText('New letters')).toBeNull();
  });

  it('folds more than two behind a link', async () => {
    http.apiFetch.mockResolvedValue({ announcements: [N({ id: 'a' , title: 'One' }), N({ id: 'b', title: 'Two' }), N({ id: 'c', title: 'Three' })] });
    render(<AnnouncementBar />);
    expect(await screen.findByText('One')).toBeInTheDocument();
    expect(screen.queryByText('Three')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 more from CLOR' }));
    expect(screen.getByText('Three')).toBeInTheDocument();
  });

  it('a notice about one app shows in that app and the Workspace, not in the other apps', async () => {
    http.apiFetch.mockResolvedValue({ announcements: [N({ title: 'People maintenance', apps: ['people'] }), N({ id: 'all', title: 'For everyone', apps: [] })] });
    const { unmount } = render(<AnnouncementBar app="accounting" />);
    expect(await screen.findByText('For everyone')).toBeInTheDocument();
    expect(screen.queryByText('People maintenance')).toBeNull();
    unmount();
    render(<AnnouncementBar app="admin" />);
    expect(await screen.findByText('People maintenance')).toBeInTheDocument();
  });

  it('shows nothing, and never breaks the app, when it cannot load', async () => {
    http.apiFetch.mockImplementation(() => Promise.reject(new Error('offline')));
    const { container } = render(<AnnouncementBar />);
    await waitFor(() => expect(http.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

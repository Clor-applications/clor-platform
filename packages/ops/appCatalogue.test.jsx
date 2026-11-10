import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsApps: vi.fn(), opsSaveApp: vi.fn() }));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify }));

import { AppCatalogue } from './AppCatalogue';

const apps = [
  { code: 'books', appId: 'accounting', name: 'Books', status: 'AVAILABLE', blurb: 'GST invoicing.', changed: false },
  { code: 'workspace', appId: 'admin', name: 'Workspace', status: 'AVAILABLE', blurb: 'Your account.', changed: false },
  { code: 'timesheet', appId: 'timesheet', name: 'Timesheet', status: 'COMING_SOON', blurb: 'Time logged.', changed: false },
];
beforeEach(() => {
  api.opsApps.mockReset().mockResolvedValue({ apps });
  api.opsSaveApp.mockReset().mockResolvedValue({ apps });
});

describe('App catalogue', () => {
  it('lists each app with its status and line; the owner hides one with a reason', async () => {
    render(<AppCatalogue role="SUPER_ADMIN" />);
    expect(await screen.findByText('Timesheet')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[2]);
    fireEvent.click(screen.getByRole('radio', { name: /Hidden/ }));
    fireEvent.change(screen.getByLabelText('One line'), { target: { value: 'Time against projects.' } });
    expect(screen.getByText('22 of 160 characters')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: 'Not this year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsSaveApp).toHaveBeenCalledWith('timesheet', { status: 'HIDDEN', blurb: 'Time against projects.', reason: 'Not this year' }));
  });

  it('keeps Workspace available, and shows others no Edit', async () => {
    const { unmount } = render(<AppCatalogue role="SUPER_ADMIN" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[1]);
    expect(screen.getByRole('radio', { name: /Hidden/ })).toBeDisabled();
    unmount();
    render(<AppCatalogue role="SUPPORT" />);
    expect(await screen.findByText('Only the owner changes the catalogue.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

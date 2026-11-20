import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import EditDrawer from './EditDrawer';
import { confirmDialog } from '@ui/components/ui/notify';

vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const Form = ({ onClose }) => (
  <EditDrawer open onClose={onClose} title="Edit pay group">
    <label>
      Name
      <input defaultValue="" />
    </label>
  </EditDrawer>
);

/* Design audit, Batch 3: Payroll's drawers lost typed edits to Escape. */
it('asks before Escape throws away something typed', async () => {
  vi.mocked(confirmDialog).mockResolvedValue(false);
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Form onClose={onClose} />);
  await user.type(screen.getByLabelText('Name'), 'Factory');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
  expect(onClose).not.toHaveBeenCalled();
});

it('closes without asking when nothing was typed', async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Form onClose={onClose} />);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(confirmDialog).not.toHaveBeenCalled();
});

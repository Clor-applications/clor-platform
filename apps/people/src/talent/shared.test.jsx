import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ReasonDrawer } from './shared';

/*
 * Talent drawers save on Enter as well as on the button. While a save is on its way, a second Enter must not send
 * it again (DESIGN.md, Buttons: loading refuses a second submit), and the button shows the shared loading state.
 */
it('sends once when Enter is pressed twice while saving', async () => {
  const onDone = vi.fn(() => new Promise(() => {}));
  render(<ReasonDrawer title="Close the opening" label="Why" help="Say why." action="Close it" onClose={() => {}} onDone={onDone} />);
  const field = screen.getByRole('combobox', { name: /Why/ });
  fireEvent.change(field, { target: { value: 'Filled internally' } });
  const form = field.closest('form');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onDone).toHaveBeenCalledTimes(1);
  const button = await screen.findByRole('button', { name: 'Close it' });
  expect(button).toHaveAttribute('aria-busy', 'true');
});

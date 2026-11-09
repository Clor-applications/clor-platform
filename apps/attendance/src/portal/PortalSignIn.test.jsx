import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

vi.mock('./portalApi', async (orig) => ({ ...(await orig()), signIn: vi.fn(), activate: vi.fn(), rememberedIds: () => ({}) }));

import { PortalSignIn } from './EmployeePortal';

/*
 * UI audit, 7 Nov 2026: the sign-in / activate switch said "tab" but had no tab panel and no arrow keys.
 * It is now the whole pattern: one tab in the Tab order, arrows and Home/End move, the form is the panel.
 */
it('is a complete tab pattern: arrows switch, focus follows, the form is the labelled panel', async () => {
  const user = userEvent.setup();
  render(<PortalSignIn onDone={vi.fn()} />);
  const list = screen.getByRole('tablist', { name: 'Sign in or activate' });
  const signin = screen.getByRole('tab', { name: 'Sign in' });
  const activate = screen.getByRole('tab', { name: 'First time? Activate' });
  expect(list).toBeTruthy();
  expect(signin.getAttribute('aria-selected')).toBe('true');
  expect(signin.tabIndex).toBe(0);
  expect(activate.tabIndex).toBe(-1);
  const panel = screen.getByRole('tabpanel', { name: 'Sign in' });
  expect(signin.getAttribute('aria-controls')).toBe(panel.id);

  signin.focus();
  await user.keyboard('{ArrowRight}');
  expect(activate.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(activate);
  expect(screen.getByRole('tabpanel', { name: 'First time? Activate' })).toBeTruthy();
  expect(screen.getByLabelText('Activation code from HR')).toBeTruthy();

  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(signin);
  await user.keyboard('{End}');
  expect(document.activeElement).toBe(activate);
  await user.keyboard('{Home}');
  expect(document.activeElement).toBe(signin);
  expect(screen.queryByLabelText('Activation code from HR')).toBeNull();
  /* The submit button stays the one button named "Sign in". */
  expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(1);
});

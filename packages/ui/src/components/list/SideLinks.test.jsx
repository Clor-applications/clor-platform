import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { SideLinks } from './SidePanel';

/* A quick link to a screen this person may not open is not shown (People audit, 30 Oct 2026). */
const links = [
  { label: 'Employees', screen: 'employees', onClick: () => {} },
  { label: 'Letters', screen: 'letterTemplates', onClick: () => {} },
  { label: 'Help', onClick: () => {} },
];

it('shows only links to screens in the nav the shell kept, and links that name no screen', () => {
  render(<SideLinks links={links} navItems={[{ key: 'checklists' }, { key: 'letterTemplates' }]} />);
  expect(screen.queryByText('Employees')).toBeNull();
  expect(screen.getByText('Letters')).toBeTruthy();
  expect(screen.getByText('Help')).toBeTruthy();
});

it('shows every link when the nav is not known', () => {
  render(<SideLinks links={links} />);
  expect(screen.getByText('Employees')).toBeTruthy();
});

it('shows nothing when no link is left', () => {
  const { container } = render(<SideLinks links={[links[0]]} navItems={[{ key: 'checklists' }]} />);
  expect(container.textContent).toBe('');
});

it('marks each link with the tint it names, and none when it names none', () => {
  render(<SideLinks links={[{ label: 'Approvals', tint: 'butter', onClick: () => {} }, { label: 'Help', onClick: () => {} }]} />);
  expect(screen.getByRole('button', { name: 'Approvals' }).getAttribute('data-tint')).toBe('butter');
  expect(screen.getByRole('button', { name: 'Help' }).hasAttribute('data-tint')).toBe(false);
});

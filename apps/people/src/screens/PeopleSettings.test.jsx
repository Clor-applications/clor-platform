import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PeopleSettings from './PeopleSettings';

/* People plan, 8 Nov 2026 (§2): Settings in seven groups of plain rows, no grid of cards. */
const KEYS = ['modules', 'companyDetails', 'employeeTypes', 'tags', 'journeySteps', 'letterTemplates', 'approvalRules', 'selfService', 'leaveTypes', 'holidays', 'sso', 'integrations', 'dataImport', 'auditLogs'];
const navItems = KEYS.map((key) => ({ key, label: key }));

it('shows the seven groups of plain rows, each row opening its screen', () => {
  const openScreen = vi.fn();
  const { container } = render(<PeopleSettings openScreen={openScreen} navItems={navItems} />);
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Company', 'People', 'Time', 'Requests & approvals', 'Data & privacy', 'Access & apps',
  ]);
  expect(container.querySelector('.ui-card')).toBeNull();
  expect(container.querySelectorAll('.ui-settings-row').length).toBe(KEYS.length + 2);
  fireEvent.click(screen.getByText('journeySteps').closest('button'));
  expect(openScreen).toHaveBeenCalledWith('journeySteps');
});

it('leaves out a row this person may not open, and a group left empty', () => {
  render(<PeopleSettings openScreen={vi.fn()} navItems={[{ key: 'holidays', label: 'Holidays' }]} />);
  expect(screen.getByText('Holidays')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'People' })).toBeNull();
  /* The connected apps are links, not screens, so their group stays. */
  expect(screen.getByRole('heading', { name: 'Access & apps' })).toBeTruthy();
});

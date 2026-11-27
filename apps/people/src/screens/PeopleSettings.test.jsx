import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PeopleSettings from './PeopleSettings';

/* Settings in the groups the panel lists too (src/settingsGroups.js; R&D hand-off, 14 Nov 2026). */
const KEYS = ['modules', 'companyDetails', 'employeeTypes', 'tags', 'journeySteps', 'letterTemplates', 'approvalRules', 'selfService', 'leaveTypes', 'holidays', 'sso', 'integrations', 'dataImport', 'auditLogs'];
const navItems = KEYS.map((key) => ({ key, label: key }));

it('opens a category, its setting, and the category index', () => {
  const openScreen = vi.fn();
  render(<PeopleSettings openScreen={openScreen} navItems={navItems} />);
  fireEvent.click(screen.getByRole('button', { name: /^People records/ }));
  expect(screen.getByRole('heading', { name: 'People records' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'journeySteps' }));
  expect(openScreen).toHaveBeenCalledWith('journeySteps');
  fireEvent.click(screen.getByRole('button', { name: 'All settings' }));
  expect(screen.getByRole('navigation', { name: 'Settings categories' })).toBeTruthy();
});

it('shows only accessible categories and finds a setting outside the current category', () => {
  render(<PeopleSettings navItems={navItems.filter(item => ['holidays', 'tags'].includes(item.key))} apps={[]} />);
  expect(screen.queryByRole('button', { name: /^Access/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Organisation/ }));
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'holidays' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'holidays' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'tags' })).toBeNull();
});

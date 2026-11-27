// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { PermissionContext } from '@ui/permissions/context';

/*
 * The directory against its reference products (DESIGN.md, 24 Nov 2026): the filters in
 * force are read above the list they narrow, and a colleague's work email can be a column.
 */
const PEOPLE = [
  { id: 'e1', name: 'Asha Rao', code: 'MF-001', status: 'ACTIVE', designation: 'Accountant', workEmail: 'asha@meridian.test', branchName: 'Head Office', dateOfJoining: '2024-01-01' },
  { id: 'e2', name: 'Ravi Kumar', code: 'MF-002', status: 'ACTIVE', designation: 'Guard', workEmail: null, branchName: 'Head Office', dateOfJoining: '2024-02-01' },
];
vi.mock('./api', () => ({
  listEmployees: vi.fn(async () => ({ employees: PEOPLE, total: PEOPLE.length })),
  listAllEmployees: vi.fn(async () => ({ employees: PEOPLE, total: PEOPLE.length })),
  employeeCounts: vi.fn(async () => ({ total: 2, joining: 0, left: 0 })),
  workforcePending: vi.fn(async () => ({ requests: [], scheduled: [], invites: [], drafts: [] })),
  structure: vi.fn(async () => []),
  listTags: vi.fn(async () => []),
  listContractors: vi.fn(async () => []),
  listViews: vi.fn(async () => []),
  dataHealth: vi.fn(async () => ({})),
  openChecklistTasks: vi.fn(async () => ({})),
  bulkUpdate: vi.fn(), changeImpact: vi.fn(), employeeIds: vi.fn(), deleteView: vi.fn(), downloadText: vi.fn(), exportColumns: vi.fn(), exportEmployees: vi.fn(), saveView: vi.fn(),
}));
vi.mock('../organization/api', () => ({ listBranches: vi.fn(async () => []) }));
vi.mock('@ui/personnel/api', () => ({ getOverview: vi.fn(async () => ({ byDepartment: [] })), getPeopleHome: vi.fn(async () => ({ today: null })) }));
vi.mock('@platform/context', async (orig) => ({ ...(await orig()), hasApp: () => false }));
vi.mock('./AppAccessSend', () => ({ default: () => null }));
vi.mock('./MyTeamPanel', () => ({ default: () => null }));

import Directory from './Directory';

const KEY = 'people.workforce.columns';
const OLD_HIDDEN = ['manager', 'type', 'location', 'department', 'code', 'languages'];
const admin = { loading: false, error: '', isAdmin: true, permissions: new Set() };
const mount = (params = {}) => render(<PermissionContext.Provider value={admin}><Directory params={params} updateParams={vi.fn()} openScreen={vi.fn()} /></PermissionContext.Provider>);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('shows the filters in force above the list, not under it', async () => {
  mount({ status: 'ACTIVE' });
  const chip = await screen.findByRole('button', { name: 'Remove Status: Active' });
  const name = await screen.findAllByText('Asha Rao');
  expect(chip.compareDocumentPosition(name[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('keeps Work email hidden at first, and for a column choice saved before it existed', async () => {
  mount();
  await screen.findAllByText('Asha Rao');
  expect(screen.queryByRole('columnheader', { name: /work email/i })).toBeNull();
  cleanup();
  localStorage.setItem(KEY, JSON.stringify({ hidden: OLD_HIDDEN }));
  mount();
  await screen.findAllByText('Asha Rao');
  expect(screen.queryByRole('columnheader', { name: /work email/i })).toBeNull();
});

it('shows Work email as a mail link once the column is chosen, and a dash for none', async () => {
  localStorage.setItem(KEY, JSON.stringify({ hidden: OLD_HIDDEN, known: ['workEmail'] }));
  mount();
  const link = await screen.findByRole('link', { name: 'asha@meridian.test' });
  expect(link.getAttribute('href')).toBe('mailto:asha@meridian.test');
  expect(screen.getByRole('columnheader', { name: /work email/i })).toBeTruthy();
});

it('opens full-page activity and shows a same-day join once', async () => {
  const { getOverview, getPeopleHome } = await import('@ui/personnel/api');
  getOverview.mockResolvedValueOnce({ joinedThisMonth: [{ id: 'e1', name: 'Asha Rao', date: '2026-11-26' }] });
  getPeopleHome.mockResolvedValueOnce({ today: { date: '2026-11-26', feed: [
    { kind: 'joined', employeeId: 'e1', name: 'Asha Rao', at: '00:00', text: 'joins today' },
  ] } });
  mount({ tab: 'activity' });
  expect(await screen.findByRole('button', { name: 'Asha Rao' })).toBeTruthy();
  expect(screen.getAllByText('Asha Rao')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Employees', exact: true })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Employees' })).toBeNull();
});

it('keeps the profile link on the employee name after moving work email first', async () => {
  localStorage.setItem(KEY, JSON.stringify({ hidden: OLD_HIDDEN, known: ['workEmail'], order: ['workEmail', 'name'] }));
  mount();
  const email = await screen.findByRole('link', { name: 'asha@meridian.test' });
  expect(email.parentElement.closest('a')).toBeNull();
  expect(within(screen.getByRole('table', { name: 'Employees' })).getByRole('link', { name: /Asha Rao/ }).closest('td')?.dataset.column).toBe('name');
});

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getAttendanceSetup: vi.fn(), changeAttendanceSetup: vi.fn() }));
vi.mock('../api/attendance', () => api);
vi.mock('@ui/components/ui/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
const who = vi.hoisted(() => ({ perms: null }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => who.perms }));

import GetStarted, { GetStartedList } from './GetStarted';
import { attendanceApp } from '../../manifest.jsx';
import { peopleApp } from '../../../people/manifest.jsx';

const owner = { loading: false, error: '', isAdmin: true, ownDocumentsOnly: false, permissions: new Set() };
const step = (key, title, over = {}) => ({ key, title, blurb: `${title} blurb`, detail: 'Nothing yet', done: false, can: true, screen: key, ...over });
const SETUP = {
  steps: [
    step('shift', 'Add a shift', { screen: 'shifts', done: true, detail: 'General' }),
    step('weeklyOff', 'Set the weekly off', { screen: 'weeklyOffPolicy', done: true }),
    step('holidays', 'Add 2026’s holidays', { screen: 'holidays' }),
    step('people', 'Add your staff', { screen: 'employees', alt: { label: 'Import', screen: 'dataImport' } }),
    step('punch', 'Connect a reader or switch on phone punch', { screen: 'readers', alt: { label: 'Phone punch', screen: 'portalAccess' }, can: false }),
    step('firstDay', 'See the first day recorded', { screen: 'records' }),
  ],
  done: 2,
  total: 6,
  show: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  who.perms = null;
});

describe('Attendance Get started', () => {
  it('shows each step done or to do, from the server, with no way to tick one', () => {
    const openScreen = vi.fn();
    render(<GetStartedList setup={SETUP} openScreen={openScreen} onHide={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByText('2 of 6 done. Each step ticks itself once it is in place.')).toBeInTheDocument();
    expect(screen.getAllByText('Done')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review: Add a shift' }));
    expect(openScreen).toHaveBeenLastCalledWith('shifts');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(openScreen).toHaveBeenLastCalledWith('dataImport');
    /* A step this person cannot act on says who does it, not a button that would be refused. */
    expect(screen.queryByRole('button', { name: /Connect a reader/ })).toBeNull();
    expect(screen.getByText('Someone with access does this')).toBeInTheDocument();
  });

  it('draws nothing once the server says it is settled or hidden', () => {
    const { container } = render(<GetStartedList setup={{ ...SETUP, show: false }} openScreen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks the server only for someone who sets Attendance up, and hides for the company', async () => {
    who.perms = owner;
    api.getAttendanceSetup.mockResolvedValue({ setup: SETUP });
    api.changeAttendanceSetup.mockResolvedValue({ setup: { ...SETUP, show: false } });
    render(<GetStarted openScreen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide this list' }));
    await waitFor(() => expect(api.changeAttendanceSetup).toHaveBeenCalledWith({ action: 'hide' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull());
  });

  it('is not asked for by a team-only role or someone who cannot change shifts', () => {
    who.perms = { ...owner, isAdmin: false, ownDocumentsOnly: true, permissions: new Set(['ATTENDANCE::Shifts::EDIT']) };
    const { unmount } = render(<GetStarted openScreen={vi.fn()} />);
    unmount();
    who.perms = { ...owner, isAdmin: false, permissions: new Set(['ATTENDANCE::Attendance Records::VIEW']) };
    render(<GetStarted openScreen={vi.fn()} />);
    expect(api.getAttendanceSetup).not.toHaveBeenCalled();
  });
});

/* Every screen a step opens is a real screen of the app (server: services/attendance/setup.ts, services/people/setup.ts). */
describe('the steps open screens that exist', () => {
  const screensIn = (file) => [...readFileSync(file, 'utf8').matchAll(/\bscreen: (?:[^'\n]*\? )?'([A-Za-z]+)'(?: : '([A-Za-z]+)')?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
  it('Attendance', () => {
    const keys = screensIn('server/src/services/attendance/setup.ts');
    expect(keys).toEqual(expect.arrayContaining(['shifts', 'weeklyOffPolicy', 'workingWeek', 'holidays', 'employees', 'dataImport', 'readers', 'portalAccess', 'records']));
    for (const k of keys) expect(attendanceApp.screens[k], k).toBeTruthy();
  });
  it('People', () => {
    const keys = screensIn('server/src/services/people/setup.ts');
    expect(keys).toEqual(expect.arrayContaining(['departments', 'employeeNew', 'employeeImport', 'leaveTypes', 'companyChoices', 'approvalRules', 'selfService', 'documents']));
    for (const k of keys) expect(peopleApp.screens[k], k).toBeTruthy();
  });
});

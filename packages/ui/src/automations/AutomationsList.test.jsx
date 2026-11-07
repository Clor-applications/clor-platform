import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import AutomationsList from './AutomationsList';

/*
 * The shared Automations list (automations plan B1): any module's recipes, each with a switch, who it goes
 * to and how, a small editor for those, and its history; read only for a role that may not change them.
 */
const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => http);
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
const dialogs = vi.hoisted(() => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../components/ui/notify', () => dialogs);

const row = (over) => ({ module: 'payroll', group: 'Pay day', on: true, n: null, range: null, defaultOn: true, managedIn: null, when: 'Every morning', to: null, recipients: null, channels: ['bell'], channelOptions: null, lastRun: null, lastChecked: null, nextRun: 'Every morning', ...over });
const ROWS = [
  row({ key: 'payroll.payslipReady', sentence: 'Tell each employee when their payslip is ready', to: [{ value: 'OWNER', label: null }, { value: 'PERSON:u2', label: 'Asha Rao' }], recipients: { options: ['OWNER', 'HR', 'PERSON'], label: 'Goes to' }, channels: ['bell', 'email'], channelOptions: ['bell', 'app', 'email'], lastRun: { on: '2026-11-06', count: 3, recipients: ['Asha Rao', 'Ravi', 'Meena'] } }),
  row({ key: 'payroll.runDue', group: 'Pay runs', sentence: 'Remind the owner {n} days before the pay run', n: 3, range: { min: 1, max: 10 }, on: false, nextRun: null }),
];
const USERS = [{ id: 'u1', name: 'Owner One' }, { id: 'u2', name: 'Asha Rao' }, { id: 'u3', name: 'Kiran Das' }];
const makeApi = (canEdit = true) => ({
  load: vi.fn(async () => ({ automations: ROWS, canEdit, users: canEdit ? USERS : [] })),
  save: vi.fn(async (patch) => ({ automations: ROWS.map((a) => (patch[a.key] ? { ...a, ...patch[a.key], to: patch[a.key].to ? patch[a.key].to.map((v) => ({ value: v, label: USERS.find((u) => `PERSON:${u.id}` === v)?.name || null })) : a.to } : a)), users: USERS })),
  history: vi.fn(async () => ({ history: [{ on: '2026-11-06', count: 3, recipients: ['Asha Rao', 'Ravi', 'Meena'] }, { on: '2026-10-06', count: 2, recipients: ['Asha Rao', 'Ravi'] }] })),
});

beforeEach(() => vi.clearAllMocks());

it('shows each recipe under its group with who it goes to, how, and when it last sent', async () => {
  render(<AutomationsList module="payroll" api={makeApi()} />);
  expect(await screen.findByRole('heading', { name: 'Pay day' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Pay runs' })).toBeTruthy();
  expect(screen.getByText('Goes to Owner and Asha Rao · In the app and email')).toBeTruthy();
  expect(screen.getByText(/Last sent .*3: Asha Rao, Ravi, Meena/)).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Remind the owner 3 days before the pay run' }).getAttribute('aria-checked')).toBe('false');
});

it('who and how: changed together, saved with one button, and at least one of each kept', async () => {
  const api = makeApi();
  render(<AutomationsList module="payroll" api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Change who and how: Tell each employee/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Add someone' }), { target: { value: 'PERSON:u3' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Employee app' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'In the app' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ 'payroll.payslipReady': { to: ['PERSON:u2', 'HR', 'PERSON:u3'], channels: ['email', 'app'] } }));
  expect(await screen.findByText('Goes to Asha Rao, HR and Kiran Das · Email and employee app')).toBeTruthy();
});

it('refuses to save with nobody to tell or no way to send it', async () => {
  const api = makeApi();
  render(<AutomationsList module="payroll" api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Change who and how/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'In the app' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Email' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert').textContent).toBe('Keep at least one way to send it.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Email' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Owner' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Asha Rao' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert').textContent).toBe('Choose at least one person to tell.');
  expect(api.save).not.toHaveBeenCalled();
});

it('history lists what went, day by day', async () => {
  const api = makeApi();
  render(<AutomationsList module="payroll" api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /History: Tell each employee/ }));
  const list = await screen.findByRole('list', { name: /History: Tell each employee/ });
  expect(api.history).toHaveBeenCalledWith('payroll.payslipReady');
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Asha Rao, Ravi')).toBeTruthy();
});

it('read only: no switch to flip, no editor, no history, and the note says who changes them', async () => {
  render(<AutomationsList module="payroll" api={makeApi(false)} readOnlyNote="Payroll admins change these." />);
  expect(await screen.findByText('Payroll admins change these.')).toBeTruthy();
  expect(screen.getAllByRole('switch').every((s) => s.disabled)).toBe(true);
  expect(screen.queryByRole('button', { name: /Change who and how/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /History/ })).toBeNull();
});

it('with no api given, reads and saves its module on the shared endpoint', async () => {
  http.apiFetch.mockImplementation(async (url, o) => (o?.method === 'PUT' ? { automations: ROWS.map((a) => ({ ...a, on: true })), users: USERS } : { automations: ROWS, canEdit: true, users: USERS }));
  render(<AutomationsList module="payroll" />);
  fireEvent.click(await screen.findByRole('switch', { name: 'Remind the owner 3 days before the pay run' }));
  await waitFor(() => expect(http.apiFetch).toHaveBeenCalledWith('/orgs/org1/automations?module=payroll', expect.objectContaining({ method: 'PUT', body: { automations: { 'payroll.runDue': { on: true } } } })));
  expect(http.apiFetch.mock.calls[0][0]).toBe('/orgs/org1/automations?module=payroll');
});

it('a reader sees "a named person"; a named user who left shows, with who hears instead', async () => {
  const masked = row({ key: 'payroll.a', sentence: 'Masked', to: [{ value: 'OWNER', label: null }, { value: 'PERSON', label: null }], recipients: { options: ['OWNER', 'PERSON'], label: 'Goes to' } });
  const gone = row({ key: 'payroll.b', sentence: 'Gone', to: [{ value: 'PERSON:u9', label: null, gone: true }], fallback: ['HR'], recipients: { options: ['HR', 'PERSON'], label: 'Goes to' } });
  const api = { load: vi.fn(async () => ({ automations: [masked, gone], canEdit: false, users: [] })), save: vi.fn(), history: vi.fn() };
  render(<AutomationsList module="payroll" api={api} />);
  expect(await screen.findByText('Goes to Owner and a named person · In the app')).toBeTruthy();
  expect(screen.getByText('Goes to someone no longer a user, so HR hears instead · In the app')).toBeTruthy();
});

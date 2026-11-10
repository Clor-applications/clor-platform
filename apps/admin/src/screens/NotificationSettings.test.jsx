import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Automations B5: Workspace → Company → Email notifications. One screen for
 * every app's switchable emails, so a company with People alone can stop the
 * "document expiring" email without Accounting.
 */

const api = vi.hoisted(() => ({ getEmailSwitches: vi.fn(), saveEmailSwitches: vi.fn() }));
vi.mock('@ui/api/notifications', () => ({
  getEmailSwitches: () => api.getEmailSwitches(),
  saveEmailSwitches: (e) => api.saveEmailSwitches(e),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@platform/context', () => ({ requestOpenScreen: vi.fn(), hasApp: () => true }));

const { PermissionContext } = await import('@ui/permissions/context');
const { default: NotificationSettings, PERMISSION } = await import('./NotificationSettings');
const { appOfEmail, emailGroups } = await import('@ui/notifications/emailApps');

/* What GET /orgs/:orgId/notifications answers: the non-transactional templates only. */
const EVENTS = [
  { key: 'approval.requested', label: 'Approval requested', description: 'To the approvers.', enabled: true },
  { key: 'invoice.payment_reminder', label: 'Payment reminder', description: 'To a customer.', enabled: true },
  { key: 'people.joined', label: 'Somebody joined', description: 'To HR.', enabled: true },
  { key: 'people.document_expiring', label: 'Document expiring', description: 'Sixty, thirty and seven days before.', enabled: true },
  { key: 'people.weekly_summary', label: 'Monday summary', description: 'Each Monday.', enabled: false },
];

const withPerms = (ui, granted, isAdmin = false) => (
  <PermissionContext.Provider value={{ permissions: new Set(granted), loading: false, error: null, isAdmin }}>{ui}</PermissionContext.Provider>
);

beforeEach(() => {
  api.getEmailSwitches.mockReset().mockResolvedValue({ events: EVENTS.map((e) => ({ ...e })) });
  api.saveEmailSwitches.mockReset().mockResolvedValue({ ok: true });
});

describe('which app sends what', () => {
  it('files each email under its app, and an unknown one under every app', () => {
    expect(appOfEmail('invoice.sent')).toBe('accounting');
    expect(appOfEmail('approval.decided')).toBe('accounting');
    expect(appOfEmail('people.document_expiring')).toBe('people');
    expect(appOfEmail('attendance.anything')).toBe('attendance');
    expect(appOfEmail('payroll.payslip_ready')).toBe('payroll');
    expect(appOfEmail('account.something_new')).toBe('other');
    const groups = emailGroups([...EVENTS, { key: 'account.something_new', label: 'New', enabled: true }], ['people']);
    expect(groups.map((g) => g.id)).toEqual(['people', 'other']);
  });

  it('without the apps, shows only apps that have something to switch off', () => {
    expect(emailGroups(EVENTS).map((g) => g.id)).toEqual(['accounting', 'people']);
  });

  it('lists the Monday summary once, under the first app that sends it and is on', () => {
    const where = (subs) => emailGroups(EVENTS, subs).filter((g) => g.events.some((e) => e.key === 'people.weekly_summary')).map((g) => g.id);
    expect(where(['attendance'])).toEqual(['attendance']);
    expect(where(['people', 'attendance'])).toEqual(['people']);
    expect(where(['payroll'])).toEqual([]);
  });

  it('hides emails nothing sends yet', () => {
    const keys = emailGroups(EVENTS, ['accounting']).flatMap((g) => g.events.map((e) => e.key));
    expect(keys).toEqual(['approval.requested']);
  });
});

describe('the screen', () => {
  it('lets a People-only company switch off the document expiring email, and nothing from apps it does not have', async () => {
    render(withPerms(<NotificationSettings tenant={{ subscriptions: ['people'] }} />, [PERMISSION, 'SETTINGS::Company Profile::EDIT']));
    const people = await screen.findByRole('region', { name: 'People' });
    expect(screen.queryByRole('region', { name: 'Accounting' })).toBeNull();
    expect(screen.queryByText('Payment reminder')).toBeNull();
    expect(screen.getByText('1 switched off')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: /Save/ });
    expect(save).toBeDisabled();
    const box = within(people).getByRole('checkbox', { name: /Document expiring/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(save);

    await waitFor(() => expect(api.saveEmailSwitches).toHaveBeenCalledTimes(1));
    const sent = api.saveEmailSwitches.mock.calls[0][0];
    expect(sent).toContainEqual({ eventKey: 'people.document_expiring', enabled: false });
    expect(sent).toContainEqual({ eventKey: 'people.weekly_summary', enabled: false });
    /* Only keys the server listed go back; it refuses any other. */
    expect(sent.map((e) => e.eventKey).sort()).toEqual(EVENTS.map((e) => e.key).sort());
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('tells a Payroll-only company there is nothing to switch off, and that some mail always goes', async () => {
    render(withPerms(<NotificationSettings tenant={{ subscriptions: ['payroll'] }} />, [PERMISSION, 'SETTINGS::Company Profile::EDIT']));
    const payroll = await screen.findByRole('region', { name: 'Payroll' });
    expect(within(payroll).getByText(/Nothing to switch off/)).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Always sent' })).toHaveTextContent(/Sign-in links, password resets, invitations/);
  });

  it('is read-only for someone who may see the company profile but not change it', async () => {
    render(withPerms(<NotificationSettings tenant={{ subscriptions: ['accounting', 'people'] }} />, [PERMISSION]));
    await screen.findByRole('region', { name: 'Accounting' });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('lets an Attendance-only company stop the Monday summary, and counts only what it shows', async () => {
    api.getEmailSwitches.mockResolvedValue({ events: EVENTS.map((e) => ({ ...e, enabled: e.key !== 'approval.requested' })) });
    render(withPerms(<NotificationSettings tenant={{ subscriptions: ['attendance'] }} />, [PERMISSION, 'SETTINGS::Company Profile::EDIT']));
    const attendance = await screen.findByRole('region', { name: 'Attendance' });
    /* Approval requested is off, but Accounting is not on here: nothing shown is off. */
    expect(screen.getByText('All on')).toBeInTheDocument();
    expect(screen.queryByText('Document expiring')).toBeNull();
    fireEvent.click(within(attendance).getByRole('checkbox', { name: /Monday summary/ }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(api.saveEmailSwitches).toHaveBeenCalledTimes(1));
    expect(api.saveEmailSwitches.mock.calls[0][0]).toContainEqual({ eventKey: 'people.weekly_summary', enabled: false });
  });

  it('says so when the settings cannot be read', async () => {
    api.getEmailSwitches.mockRejectedValue(new Error('Forbidden'));
    render(withPerms(<NotificationSettings tenant={{ subscriptions: ['people'] }} />, [PERMISSION]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });
});

/*
 * The menu entry's permission is the one the server checks (routes/email.ts),
 * so somebody without it never sees an entry that would answer 403, and
 * everyone who has it reaches the screen from each app's settings.
 */
describe('route and menu agree', () => {
  const repo = process.cwd();
  const read = (p) => readFileSync(resolve(repo, p), 'utf8');

  it('the server reads with Company profile VIEW and saves with its EDIT', () => {
    const src = read('server/src/routes/email.ts');
    expect(src).toMatch(/const SETTINGS_VIEW = requirePermission\('SETTINGS', PermissionAction\.VIEW, 'Company Profile'\)/);
    expect(src).toMatch(/const SETTINGS_EDIT = requirePermission\('SETTINGS', PermissionAction\.EDIT, 'Company Profile'\)/);
    expect(src).toMatch(/emailRouter\.get\('\/orgs\/:orgId\/notifications', SETTINGS_VIEW/);
    expect(src).toMatch(/emailRouter\.put\('\/orgs\/:orgId\/notifications', SETTINGS_EDIT/);
  });

  it('every app’s entry asks for that permission and opens the Workspace screen', async () => {
    const { adminApp } = await import('../../manifest.jsx');
    const item = adminApp.nav.find((n) => n.key === 'notifications');
    expect(item.permission).toBe(PERMISSION);
    expect(adminApp.screens.notifications).toBeTruthy();
    expect(adminApp.modules.find((m) => m.key === 'company').items).toContain('notifications');

    for (const [file, screens] of [
      ['apps/people/manifest.jsx', 'apps/people/src/screens.js'],
      ['apps/attendance/manifest.jsx', 'apps/attendance/src/screens.js'],
      ['apps/payroll/manifest.jsx', 'apps/payroll/src/screens.js'],
    ]) {
      expect(read(file)).toMatch(/\{ key: 'emailNotifications', label: 'Email [Nn]otifications', icon: [\w.]+, permission: 'SETTINGS::Company Profile::VIEW'/);
      expect(read(file)).toMatch(/emailNotifications: EmailNotifications/);
      expect(read(screens)).toMatch(/EmailNotifications = \(\) => React\.createElement\(OpenInCompanyAdmin, \{ title: 'Email [Nn]otifications', screen: 'notifications' \}\)/);
    }
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import CompanyChoices from './CompanyChoices';
import { SalaryRevisionsReadOnly } from '../money/SalaryRevisionsRead';

/*
 * Settings → Company choices (SPEC 3.7): each decision as a sentence and a control, the last change named, one
 * Save top right that saves only what changed; a person who may not change one sees it read only with why.
 * And HR's read-only salary revisions list the choice opens.
 */
const api = vi.hoisted(() => ({ getCompanyChoices: vi.fn(), saveCompanyChoice: vi.fn(), getHrSalaryRevisions: vi.fn() }));
vi.mock('../api/choices', () => api);
vi.mock('../../../payroll/src/screens/SalaryRevisions', () => ({ default: () => <p>Payroll screen</p> }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => new Set() }));
const dialogs = vi.hoisted(() => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => dialogs);

const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
const CHOICES = (over = {}) => ({
  choices: [
    { key: 'attendance.correctionApproval', value: 'HR_OR_MANAGER', default: 'HR_OR_MANAGER', canChange: true, changed: null, options: [{ value: 'HR_OR_MANAGER', label: 'HR or the manager, whoever is first' }, { value: 'MANAGER', label: 'The manager; HR can step in' }, { value: 'HR', label: 'HR only' }, { value: 'MANAGER_THEN_HR', label: 'The manager, then HR' }] },
    { key: 'people.hrSeesSalaryRevisions', value: false, default: false, canChange: true, changed: { by: 'Asha Rao', at: '2026-10-31T06:00:00Z' }, options: YES_NO },
    { key: 'people.leavingsForReadOnly', value: true, default: true, canChange: true, changed: null, options: YES_NO },
    { key: 'people.leavingReasonForReadOnly', value: false, default: false, canChange: true, changed: null, options: YES_NO },
    { key: 'notifications.withdrawn', value: 'SHOW_WITHDRAWN', default: 'SHOW_WITHDRAWN', canChange: true, changed: null, options: [{ value: 'SHOW_WITHDRAWN', label: 'Shows as withdrawn' }, { value: 'REMOVE', label: 'Is removed' }] },
  ].map((c) => ({ ...c, ...(over[c.key] || {}) })),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getCompanyChoices.mockResolvedValue(CHOICES());
});

it('shows each choice as a sentence with its value, the standard or who changed it, and the two set elsewhere', async () => {
  const openScreen = vi.fn();
  render(<CompanyChoices openScreen={openScreen} />);
  expect(await screen.findByRole('heading', { name: 'Company choices' })).toBeTruthy();
  const who = screen.getByLabelText(/Missed punch, work from home, on duty, permission and shift change requests are decided by/);
  expect(who.value).toBe('HR_OR_MANAGER');
  expect(screen.getByText(/Whoever acts first/)).toBeTruthy();
  expect(screen.getByText(/Changed by Asha Rao/)).toBeTruthy();
  expect(screen.getAllByText('Standard').length).toBe(4);
  expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Attendance rules' }));
  expect(openScreen).toHaveBeenCalledWith('attendanceRules');
  expect(screen.getByText(/In Payroll, under Settings/)).toBeTruthy();
});

it('saves only what changed, one choice at a time, booleans as booleans', async () => {
  api.saveCompanyChoice.mockImplementation(async (key, value) => CHOICES({ [key]: { value } }));
  render(<CompanyChoices />);
  const who = await screen.findByLabelText(/are decided by/);
  fireEvent.change(who, { target: { value: 'HR' } });
  expect(screen.getByText('Managers see the request but cannot decide it.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/also see the reason typed for leaving/), { target: { value: 'true' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveCompanyChoice).toHaveBeenCalledTimes(2));
  expect(api.saveCompanyChoice).toHaveBeenNthCalledWith(1, 'attendance.correctionApproval', 'HR');
  expect(api.saveCompanyChoice).toHaveBeenNthCalledWith(2, 'people.leavingReasonForReadOnly', true);
  await waitFor(() => expect(dialogs.notify.success).toHaveBeenCalledWith('Choices saved.'));
});

it('a refusal says so and keeps the draft', async () => {
  api.saveCompanyChoice.mockRejectedValue(Object.assign(new Error('Only the owner or an admin can change this.'), { status: 403 }));
  render(<CompanyChoices />);
  fireEvent.change(await screen.findByLabelText(/HR without Payroll access can see salary revisions/), { target: { value: 'true' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(dialogs.notify.error).toHaveBeenCalledWith('Only the owner or an admin can change this.'));
  expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
});

it('read only for someone who may change none: no Save, the control disabled, and why', async () => {
  const why = 'Only the owner or an admin can change this.';
  api.getCompanyChoices.mockResolvedValue({ choices: CHOICES().choices.map((c) => ({ ...c, canChange: false, why })) });
  render(<CompanyChoices />);
  expect((await screen.findByLabelText(/HR without Payroll access/)).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.getAllByText(new RegExp(why)).length).toBe(5);
});

it('a failed load offers a retry', async () => {
  api.getCompanyChoices.mockRejectedValue(Object.assign(new Error('Down'), { status: 500 }));
  render(<CompanyChoices />);
  expect(await screen.findByRole('button', { name: /try again|retry/i })).toBeTruthy();
});

it('HR’s salary revisions: old and new pay, read only, no actions; empty says so', async () => {
  api.getHrSalaryRevisions.mockResolvedValue({ readOnly: true, revisions: [{ id: 'r1', employeeName: 'Pay Person', employeeCode: 'P1', currentAnnualCtc: 600000, proposedAnnualCtc: 660000, incrementPercent: 10, effectiveFrom: '2026-12-01', status: 'DRAFT' }] });
  const { unmount } = render(<SalaryRevisionsReadOnly />);
  expect(await screen.findByText('Pay Person')).toBeTruthy();
  expect(screen.getByText('₹6,00,000')).toBeTruthy();
  expect(screen.getByText('₹6,60,000')).toBeTruthy();
  expect(screen.getByText(/Read only/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /new revision|approve|review/i })).toBeNull();
  unmount();
  api.getHrSalaryRevisions.mockResolvedValue({ readOnly: true, revisions: [] });
  render(<SalaryRevisionsReadOnly />);
  expect(await screen.findByText('No salary revisions yet')).toBeTruthy();
});

it('leave on the approval rules: off with its plain words; the owner turns it on; someone else sees why they cannot', async () => {
  const onEngine = { key: 'leave.onEngine', value: false, default: false, canChange: true, changed: null, options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] };
  api.getCompanyChoices.mockResolvedValue({ choices: [...CHOICES().choices, onEngine] });
  api.saveCompanyChoice.mockResolvedValue({ choices: [...CHOICES().choices, { ...onEngine, value: true }] });
  const { unmount } = render(<CompanyChoices />);
  const control = await screen.findByLabelText('Leave requests are decided by the approval rules');
  expect(control.value).toBe('false');
  expect(screen.getByText(/Off: leave is decided as it is today/)).toBeTruthy();
  fireEvent.change(control, { target: { value: 'true' } });
  expect(screen.getByText(/The same people decide as today/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveCompanyChoice).toHaveBeenCalledWith('leave.onEngine', true));
  unmount();
  api.getCompanyChoices.mockResolvedValue({ choices: [...CHOICES().choices, { ...onEngine, canChange: false, why: 'Only the owner or an admin can change this.' }] });
  render(<CompanyChoices />);
  expect((await screen.findByLabelText('Leave requests are decided by the approval rules')).disabled).toBe(true);
  expect(screen.getAllByText(/Only the owner or an admin can change this/).length).toBeGreaterThan(0);
});

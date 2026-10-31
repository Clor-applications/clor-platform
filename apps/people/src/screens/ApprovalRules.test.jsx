import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import ApprovalRules from './ApprovalRules';

/*
 * Approval rules with version 2 rules on the server (docs/people/workflow-engine/SPEC.md 5.2): the screen edits the
 * first step shape the API still sends as `steps`, shows a variant nowhere as the main rule, and opens a rule it cannot
 * say in full read only, instead of saving a cut-down copy over it.
 */
const rule = (over) => ({ id: `r-${Math.random()}`, requestType: 'JOB_CHANGE', name: 'Job changes', version: 2, active: true, variantKey: '', specVersion: 2, editableHere: true, createdAt: '2026-10-31T05:00:00Z', steps: [{ order: 1, approver: { kind: 'MANAGER' }, condition: null, dueDays: 2, overdue: { action: 'REMIND' } }], ...over });
const api = vi.hoisted(() => ({ listRules: vi.fn(), saveRule: vi.fn(), retireRule: vi.fn() }));
vi.mock('../api/approvals', () => api);
vi.mock('../api/desk', () => ({ orgUsers: vi.fn().mockResolvedValue([]) }));
vi.mock('../workforce/api', () => ({ listEmployees: vi.fn().mockResolvedValue({ employees: [] }), structure: vi.fn().mockResolvedValue([]) }));
vi.mock('@ui/timeOff/api', () => ({ listLeaveTypes: vi.fn().mockResolvedValue([]) }));
vi.mock('@platform/http', () => ({ apiFetch: vi.fn().mockResolvedValue({ roles: [] }) }));
vi.mock('@platform/context', () => ({ orgId: () => 'org-1' }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('reads each kind’s main rule in words, says Custom steps for one it cannot show, and ignores variants', async () => {
  api.listRules.mockResolvedValue({
    requestTypes: ['JOB_CHANGE', 'SEAT_REQUEST', 'LETTER_REQUEST'],
    forms: [],
    rules: [
      rule({}),
      rule({ requestType: 'SEAT_REQUEST', name: 'Seats', editableHere: false }),
      rule({ requestType: 'LETTER_REQUEST', name: 'Pune letters', variantKey: 'pune', steps: [{ order: 1, approver: { kind: 'HR' }, dueDays: 1 }] }),
    ],
  });
  render(<ApprovalRules />);
  expect(await screen.findByRole('heading', { name: 'Approval rules' })).toBeTruthy();
  expect((await screen.findAllByText('Their manager (2 d)')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Custom steps').length).toBeGreaterThan(0);
  /* The variant is not the letters' rule: letters read as having none. */
  expect(screen.getAllByText('Nobody: applies at once').length).toBeGreaterThan(0);
});

it('opens a rule it cannot say in full read only: the note, no save', async () => {
  api.listRules.mockResolvedValue({ requestTypes: ['SEAT_REQUEST'], forms: [], rules: [rule({ requestType: 'SEAT_REQUEST', name: 'Seats', editableHere: false, spec: [{ order: 1, approvers: [{ kind: 'DEPARTMENT_HEAD' }, { kind: 'HR' }], mode: 'ALL', when: [], due: { hours: 8 } }] })] });
  render(<ApprovalRules />);
  fireEvent.click((await screen.findAllByText('Position requests'))[0]);
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByRole('note').textContent).toMatch(/cannot edit yet/);
  expect(within(drawer).getByText(/Their department head and HR \(anyone who may edit people\), all of them\. Due in 8 hours\./)).toBeTruthy();
  expect(within(drawer).queryByRole('button', { name: /Add a step/ })).toBeNull();
  expect(within(drawer).queryByRole('button', { name: 'Save as new version' })).toBeNull();
  expect(within(drawer).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
});

it('an editable rule still saves in the shape it was shown in', async () => {
  api.listRules.mockResolvedValue({ requestTypes: ['JOB_CHANGE'], forms: [], rules: [rule({})] });
  api.saveRule.mockResolvedValue({ rule: { name: 'Job changes, two', version: 3 } });
  render(<ApprovalRules />);
  fireEvent.click((await screen.findAllByText('Job changes'))[0]);
  const drawer = await screen.findByRole('dialog');
  fireEvent.change(within(drawer).getByLabelText(/Rule name/), { target: { value: 'Job changes, two' } });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save as new version' }));
  await vi.waitFor(() => expect(api.saveRule).toHaveBeenCalledWith({ requestType: 'JOB_CHANGE', name: 'Job changes, two', steps: [{ order: 1, approver: { kind: 'MANAGER' }, condition: null, dueDays: 2, overdue: { action: 'REMIND' } }] }));
});

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

/* A rule the old shape cannot say: two people (all of them), approved on its own when late and in some cases, HR may step in, own requests go up. */
const seats = (over = {}) => rule({
  requestType: 'DOCUMENT_REQUEST', name: 'Copies', editableHere: false,
  spec: [
    { order: 1, approvers: [{ kind: 'DEPARTMENT_HEAD' }, { kind: 'HR' }], mode: 'ALL', when: [], due: { hours: 8 }, overdue: { action: 'AUTO_APPROVE', afterHours: 4 }, stepIn: 'HR', ifRequester: 'NEXT_UP' },
    { order: 2, approvers: [{ kind: 'OWNER' }], mode: 'ANY', when: [{ field: 'gradeId', op: 'eq', value: 'g-1' }], due: { workingDays: 2 } },
  ],
  autoApprove: [{ when: [{ field: 'departmentId', op: 'eq', value: 'd-1' }] }],
  ...over,
});

it('reads each kind’s main rule in words, naming auto-approve, step-in, own requests and variants (review of PR #93)', async () => {
  api.listRules.mockResolvedValue({
    requestTypes: ['JOB_CHANGE', 'DOCUMENT_REQUEST', 'LETTER_REQUEST'],
    forms: [],
    rules: [
      rule({}),
      seats(),
      rule({ requestType: 'DOCUMENT_REQUEST', name: 'Pune seats', variantKey: 'pune', appliesWhen: [{ field: 'branchId', op: 'eq', value: 'b-1' }], spec: [{ order: 1, approvers: [{ kind: 'HR' }], mode: 'ANY', when: [], due: { workingDays: 1 } }] }),
      rule({ requestType: 'LETTER_REQUEST', name: 'Pune letters', variantKey: 'pune', steps: [{ order: 1, approver: { kind: 'HR' }, dueDays: 1 }] }),
    ],
  });
  render(<ApprovalRules />);
  expect(await screen.findByRole('heading', { name: 'Approval rules' })).toBeTruthy();
  expect((await screen.findAllByText('Their manager (2 d)')).length).toBeGreaterThan(0);
  const line = screen.getAllByText(/Their department head and HR \(anyone who may edit people\), all \(8 h\) → The owner \(2 d\)/)[0].textContent;
  expect(line).toContain('approves some on its own');
  expect(line).toContain('approves on its own when late');
  expect(line).toContain('others can step in');
  expect(line).toContain('own requests go up');
  expect(line).toContain('1 variant: Pune seats');
  expect(screen.queryByText('Custom steps')).toBeNull();
  /* A variant is not the letters' main rule: letters read as having none. */
  expect(screen.getAllByText('Nobody: applies at once').length).toBeGreaterThan(0);
});

it('opens a rule it cannot edit read only, saying everything it does: the note, the steps in words, no save', async () => {
  api.listRules.mockResolvedValue({ requestTypes: ['DOCUMENT_REQUEST'], forms: [], rules: [seats(), rule({ requestType: 'DOCUMENT_REQUEST', name: 'Pune seats', variantKey: 'pune', appliesWhen: [{ field: 'branchId', op: 'eq', value: 'b-1' }], spec: [{ order: 1, approvers: [{ kind: 'HR' }], mode: 'ANY', when: [], due: { workingDays: 1 } }] })] });
  render(<ApprovalRules />);
  fireEvent.click((await screen.findAllByText('Document copies'))[0]);
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByRole('note').textContent).toMatch(/does more than this screen can edit yet/);
  const text = drawer.textContent;
  expect(text).toContain('Their department head and HR (anyone who may edit people), all of them. Due in 8 hours. If late, approved on its own 4 hours after the reminder. HR can step in. If it is their own, it goes to their manager, then HR, then the owner.');
  expect(text).toContain('The owner, only when their grade is the one chosen. Due in 2 working days.');
  expect(text).toContain('Approved on its own when their department is the one chosen.');
  expect(text).toContain('Pune seats, when their branch is the one chosen: HR (anyone who may edit people). Due in 1 working day.');
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

it('offers conditions only where the request carries them: none for a letter request (re-review of PR #93)', async () => {
  api.listRules.mockResolvedValue({ requestTypes: ['LETTER_REQUEST', 'JOB_CHANGE'], forms: [], rules: [] });
  render(<ApprovalRules />);
  fireEvent.click((await screen.findAllByText('Letter requests'))[0]);
  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).queryByText('Only when')).toBeNull();
});

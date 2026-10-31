import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * Continue on Employment before the suggested employee ID has come back (a slow line, a busy phone):
 * the wizard waits for the ID instead of asking for one and staying put (H1 at phone width, 31 Oct 2026).
 */
const api = vi.hoisted(() => ({
  structure: vi.fn(async () => []),
  listContractors: vi.fn(async () => []),
  listTags: vi.fn(async () => []),
  listEmployees: vi.fn(async () => ({ employees: [] })),
  nextEmployeeCode: vi.fn(),
  createEmployee: vi.fn(),
  deleteDraft: vi.fn(),
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('./api', () => api);
vi.mock('../organization/api', () => ({ listBranches: async () => [] }));
vi.mock('./suggestions', () => ({ refreshSuggestions: () => {}, useEmailSuggestions: () => [], useSuggestions: () => [] }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({}) }));
vi.mock('./shared', () => ({ can: () => true }));
vi.mock('@platform/context', () => ({ hasApp: () => false, currentUser: () => null, orgId: () => 'org1', branchId: () => 'b1' }));
vi.mock('@platform/unsaved', () => ({ clearUnsaved: () => {} }));
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

const { default: AddEmployee } = await import('./AddEmployee');

function Wizard({ start = 'employment' }) {
  const [params, setParams] = useState({ step: start });
  return <AddEmployee params={params} updateParams={(p) => setParams((x) => ({ ...x, ...p }))} />;
}

const later = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

window.scrollTo = () => {};
beforeEach(() => vi.clearAllMocks());

const fillJoining = async () => {
  const date = await screen.findByLabelText(/Joining date/);
  fireEvent.change(date, { target: { value: '05/11/2026' } });
  fireEvent.blur(date);
};

it('waits for the suggested employee ID when Continue is pressed before it arrives', async () => {
  const code = later();
  api.nextEmployeeCode.mockReturnValue(code.promise);
  render(<Wizard />);
  await fillJoining();
  expect(screen.getByLabelText(/Employee ID/).value).toBe('');

  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  /* Still on Employment, and not told to enter an ID that is on its way. */
  expect(screen.getByRole('form', { name: 'Employment' })).toBeTruthy();
  expect(screen.queryByText('Enter an employee ID.')).toBeNull();

  await act(async () => { code.resolve('AT-013'); });
  /* Two presses while waiting move one step, not two. */
  expect(await screen.findByRole('form', { name: 'Organisation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect((await screen.findByLabelText(/Employee ID/)).value).toBe('AT-013');
});

it('Back while waiting for the ID stays where the person went', async () => {
  const code = later();
  api.nextEmployeeCode.mockReturnValue(code.promise);
  render(<Wizard />);
  await fillJoining();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect(await screen.findByRole('form', { name: 'Personal' })).toBeTruthy();
  await act(async () => { code.resolve('AT-013'); });
  expect(screen.getByRole('form', { name: 'Personal' })).toBeTruthy();
});

it('an ID that never comes is still asked for, and the ask goes once one is typed', async () => {
  api.nextEmployeeCode.mockRejectedValue(new Error('offline'));
  render(<Wizard />);
  await fillJoining();
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByText('Enter an employee ID.')).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Employment' })).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: 'AT-099' } });
  expect(screen.queryByText('Enter an employee ID.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByRole('form', { name: 'Organisation' })).toBeTruthy();
});

it('an ID typed by hand is kept when the suggestion comes after it', async () => {
  const code = later();
  api.nextEmployeeCode.mockReturnValue(code.promise);
  render(<Wizard />);
  await fillJoining();
  fireEvent.change(screen.getByLabelText(/Employee ID/), { target: { value: 'MY-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByRole('form', { name: 'Organisation' })).toBeTruthy();
  await act(async () => { code.resolve('AT-013'); });
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect((await screen.findByLabelText(/Employee ID/)).value).toBe('MY-1');
});

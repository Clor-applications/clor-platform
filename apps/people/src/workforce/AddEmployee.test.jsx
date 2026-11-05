import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
  listPayStructures: vi.fn(async () => []),
  assignSalary: vi.fn(),
  uploadEmployeeDocument: vi.fn(),
}));
const apps = vi.hoisted(() => new Set());
vi.mock('./api', () => api);
vi.mock('../organization/api', () => ({ listBranches: async () => [] }));
vi.mock('./suggestions', () => ({ refreshSuggestions: () => {}, useEmailSuggestions: () => [], useSuggestions: () => [] }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => ({}) }));
vi.mock('./shared', () => ({ can: () => true }));
vi.mock('@platform/context', () => ({ hasApp: (k) => apps.has(k), currentUser: () => null, orgId: () => 'org1', branchId: () => 'b1' }));
vi.mock('@platform/unsaved', () => ({ clearUnsaved: () => {} }));
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

const { default: AddEmployee } = await import('./AddEmployee');

function Wizard({ start = 'employment', draft }) {
  const [params, setParams] = useState({ step: start, draft });
  return <AddEmployee params={params} updateParams={(p) => setParams((x) => ({ ...x, ...p }))} />;
}

const later = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

window.scrollTo = () => {};
beforeEach(() => vi.clearAllMocks());
afterEach(() => apps.clear());

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

/* Owner's suite spec, 5–6 Nov 2026: the wizard runs basic, job, CTC, documents. The salary and the files are sent once the
   person exists, so a refused salary or file never undoes the person. */
it('Salary and Documents steps: a CTC needs its structure, and both are sent after the person is created', async () => {
  apps.add('payroll');
  api.getDraft.mockResolvedValue({ id: 'd1', data: { firstName: 'Anil', code: 'AT-1', dateOfJoining: '2026-11-09' } });
  api.listPayStructures.mockResolvedValue([{ id: 's1', name: 'Staff monthly', effectiveFrom: '2026-04-01' }]);
  api.createEmployee.mockResolvedValue({ employee: { id: 'e1', name: 'Anil' } });
  api.assignSalary.mockResolvedValue({});
  api.uploadEmployeeDocument.mockResolvedValue({});
  const { container } = render(<Wizard start="salary" draft="d1" />);
  expect(await screen.findByRole('form', { name: 'Salary' })).toBeTruthy();
  expect(screen.getAllByText(/^(Personal|Employment|Organisation|Salary|Documents|Review)$/).map((x) => x.textContent).slice(0, 6)).toEqual(['Personal', 'Employment', 'Organisation', 'Salary', 'Documents', 'Review']);

  fireEvent.change(screen.getByLabelText(/Yearly CTC/), { target: { value: '480000' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByText('Choose the salary structure this CTC is paid on.')).toBeTruthy();
  expect(screen.getByRole('form', { name: 'Salary' })).toBeTruthy();

  fireEvent.click(screen.getByRole('combobox', { name: 'Salary structure' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Staff monthly' }));
  expect(screen.getByText('Starts 9 Nov 2026, about ₹40,000 a month.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByRole('form', { name: 'Documents' })).toBeTruthy();

  const file = new File(['%PDF-1.4'], 'Aadhaar card.pdf', { type: 'application/pdf' });
  fireEvent.change(container.querySelector('#joiningFiles'), { target: { files: [file] } });
  expect(await screen.findByText('Aadhaar card.pdf')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  expect(await screen.findByRole('form', { name: 'Review' })).toBeTruthy();
  expect(screen.getByText('₹4,80,000')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Create employee' }));
  await waitFor(() => expect(api.uploadEmployeeDocument).toHaveBeenCalled());
  expect(api.createEmployee.mock.calls[0][0]).not.toHaveProperty('annualCtc');
  expect(api.assignSalary).toHaveBeenCalledWith({ employeeId: 'e1', structureId: 's1', effectiveFrom: '2026-11-09', annualCtc: 480000 });
  expect(api.uploadEmployeeDocument).toHaveBeenCalledWith('e1', expect.objectContaining({ kind: 'ID_PROOF', title: 'Aadhaar card', mime: 'application/pdf', classification: 'EMPLOYEE_VISIBLE' }));
});

it('without Payroll there is no Salary step', async () => {
  render(<Wizard start="organization" />);
  expect(await screen.findByRole('form', { name: 'Organisation' })).toBeTruthy();
  expect(screen.queryByText('Salary')).toBeNull();
  expect(screen.getByText('Documents')).toBeTruthy();
});

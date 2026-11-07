import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import PeopleDocuments from './PeopleDocuments';

/*
 * People → Documents: New document is offered only to someone who may add files. A view-only manager reads the
 * register but is not offered a button the server would refuse (audit 7 Nov 2026 follow-up).
 */
const api = vi.hoisted(() => ({ listCompanyDocuments: vi.fn(), listAllEmployees: vi.fn(), getDocument: vi.fn() }));
vi.mock('@ui/personnel/api', () => api);
vi.mock('@ui/personnel/Employees', () => ({ EmployeeDocuments: () => null }));
const perms = vi.hoisted(() => ({ current: { permissions: new Set() } }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));

const DOC = { id: 'd1', title: 'Offer letter', employeeId: 'e1', employeeName: 'Ravi Kumar', kind: 'OFFER', expiresOn: null, classification: 'EMPLOYEE_VISIBLE' };

beforeEach(() => {
  vi.clearAllMocks();
  api.listCompanyDocuments.mockResolvedValue([DOC]);
  api.listAllEmployees.mockResolvedValue({ employees: [{ id: 'e1', name: 'Ravi Kumar' }] });
});

it('offers New document to someone who may add files', async () => {
  perms.current = { permissions: new Set(['PEOPLE::Documents::VIEW', 'PEOPLE::Documents::CREATE']) };
  render(<PeopleDocuments />);
  expect((await screen.findAllByText('Offer letter')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /New document/ })).toBeTruthy();
});

it('does not offer New document to a reader who may only view', async () => {
  perms.current = { permissions: new Set(['PEOPLE::Documents::VIEW']) };
  render(<PeopleDocuments />);
  expect((await screen.findAllByText('Offer letter')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /New document/ })).toBeNull();
});

it('leaves the empty register without the add route for a view-only reader', async () => {
  perms.current = { permissions: new Set(['PEOPLE::Documents::VIEW']) };
  api.listCompanyDocuments.mockResolvedValue([]);
  render(<PeopleDocuments />);
  expect(await screen.findByText('No documents yet')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /New document/ })).toBeNull();
});

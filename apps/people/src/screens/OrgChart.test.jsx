import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { getOrgChart } from '@ui/personnel/api';
import { organization } from '../organization/api';
import OrgChart from './OrgChart';

vi.mock('@ui/personnel/api', () => ({ getOrgChart: vi.fn() }));
vi.mock('../organization/api', () => ({ organization: vi.fn() }));

it('offers a retry when the chart response is missing its nodes', async () => {
  getOrgChart.mockResolvedValueOnce({}).mockResolvedValueOnce({ nodes: [], openSeats: [] });
  render(<OrgChart />);

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Nobody yet')).toBeInTheDocument();
});

it('offers a retry when the Departments response is incomplete', async () => {
  getOrgChart.mockResolvedValueOnce({ nodes: [], openSeats: [] });
  organization.mockResolvedValueOnce({});
  render(<OrgChart params={{ view: 'departments' }} />);

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

it('collapses a department together with its subdepartments and finds people inside it', async () => {
  getOrgChart.mockResolvedValueOnce({ nodes: [{ id: 'p1', name: 'Nila Shah', departmentId: 'ops' }], openSeats: [] });
  organization.mockResolvedValueOnce({ departments: [
    { id: 'company', name: 'Company' }, { id: 'ops', name: 'Operations', parentId: 'company' },
  ] });
  render(<OrgChart params={{ view: 'departments' }} />);
  fireEvent.click(await screen.findByRole('button', { name: /Company/ }));
  expect(screen.queryByRole('treeitem', { name: /Operations/ })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search departments or people' }), { target: { value: 'Nila' } });
  expect(await screen.findByRole('button', { name: 'Nila Shah' })).toBeInTheDocument();
  expect(screen.getByRole('treeitem', { name: /Company/ })).toHaveAttribute('aria-expanded', 'true');
});

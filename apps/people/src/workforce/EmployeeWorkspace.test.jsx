import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { listCompanyDocuments } from '@ui/personnel/api';
import { pageChanges, pageJoiners, pageTasks } from '@ui/lifecycle/api';
import { employeeCounts } from './api';
import EmployeeWorkspace from './EmployeeWorkspace';

vi.mock('@ui/personnel/api', async (original) => ({ ...(await original()), listCompanyDocuments: vi.fn() }));
vi.mock('@ui/lifecycle/api', () => ({ pageChanges: vi.fn(), pageJoiners: vi.fn(), pageTasks: vi.fn() }));
vi.mock('./api', () => ({ employeeCounts: vi.fn() }));
vi.mock('../screens/usePeopleUpdates', () => ({ usePeopleUpdates: () => {} }));

it('opens the expired register and reads only the permitted document list', async () => {
  listCompanyDocuments.mockResolvedValue([{ employeeName: 'A Rao', title: 'Permit', expiresOn: '2020-05-16' }]);
  const openScreen = vi.fn();
  render(<EmployeeWorkspace overviewModule={{ items: [{ key: 'documents', label: 'Documents' }] }} openScreen={openScreen} />);
  expect(await screen.findByText(/Permit · A Rao · Expired/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review documents' }));
  expect(openScreen).toHaveBeenCalledWith('documents', { tab: 'expired' });
  expect(screen.queryByRole('button', { name: 'Add employee' })).toBeNull();
  for (const load of [employeeCounts, pageTasks, pageJoiners, pageChanges]) expect(load).not.toHaveBeenCalled();
});

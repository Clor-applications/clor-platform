import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import AudiencePicker from './AudiencePicker';

/* Time depth, gap 20: who reads an announcement, and the words shown with it follow the choice. */
vi.mock('@ui/personnel/api', () => ({
  listStructure: vi.fn((kind) => Promise.resolve(kind === 'departments' ? [{ id: 'd1', name: 'Operations' }, { id: 'd2', name: 'Finance' }] : [{ id: 'a1', name: 'Plant 2' }])),
  listBranches: vi.fn().mockResolvedValue([{ id: 'b1', branchName: 'Pune' }]),
  listAllEmployees: vi.fn().mockResolvedValue({ employees: [{ id: 'e1', name: 'Asha', code: 'A1' }, { id: 'e2', name: 'Left Person', status: 'LEFT' }] }),
}));

function Harness({ onChange }) {
  const [v, setV] = useState({ audienceKind: 'ALL', audienceIds: [], audience: 'Everyone' });
  return <><AudiencePicker kind={v.audienceKind} ids={v.audienceIds} onChange={(p) => { setV(p); onChange(p); }} /><output>{v.audience}</output></>;
}

it('starts with everyone, then reads only the chosen departments, with matching words', async () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  expect(screen.getByText(/Everyone in the company reads this/)).toBeTruthy();
  fireEvent.click(screen.getAllByText('Everyone')[0]);
  fireEvent.click(await screen.findByRole('option', { name: 'Some departments' }));
  expect(await screen.findByText('Choose at least one department.')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Operations' }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ audienceKind: 'DEPARTMENT', audienceIds: ['d1'], audience: 'Operations' }));
  expect(screen.getByRole('button', { name: 'Operations' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/Read only by Operations/)).toBeTruthy();
});

it('offers people who have not left', async () => {
  render(<Harness onChange={() => {}} />);
  fireEvent.click(screen.getAllByText('Everyone')[0]);
  fireEvent.click(await screen.findByRole('option', { name: 'Some people' }));
  expect(await screen.findByRole('button', { name: 'Asha' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Left Person' })).toBeNull();
});

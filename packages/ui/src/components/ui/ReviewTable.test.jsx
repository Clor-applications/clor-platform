import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ReviewTable from './ReviewTable';

it('reviews and exports the checked records and drops a record removed by a refresh', () => {
  const rows = [{ id: 'a', name: 'Scanner' }, { id: 'b', name: 'Laptop' }];
  const exportSelected = vi.fn();
  const table = (records) => <ReviewTable label="Assets" columns={[{ key: 'name', label: 'Asset' }]} rows={records} exportSelected={exportSelected} />;
  const { rerender } = render(table(rows));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Choose Laptop' }));
  expect(screen.getByRole('checkbox', { name: 'Choose every row on this page' }).indeterminate).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Export selected' }));
  expect(exportSelected).toHaveBeenCalledWith([rows[1]]);
  fireEvent.click(screen.getByRole('button', { name: 'Show selected' }));
  expect(screen.queryByText('Scanner')).toBeNull();
  rerender(table([rows[0]]));
  expect(screen.getByText('Scanner')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Selected records' })).toBeNull();
  rerender(table(rows));
  expect(screen.getByRole('checkbox', { name: 'Choose Laptop' }).checked).toBe(false);
});

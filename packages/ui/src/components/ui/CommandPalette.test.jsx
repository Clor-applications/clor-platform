import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommandPalette from './CommandPalette';

/* People plan, 8 Nov 2026: search found screen names only; "Priya", "probation" or "month close" found nothing. */
describe('CommandPalette', () => {
  const items = [
    { key: 'screen:employees', label: 'Employees', group: 'People', screen: 'employees', keywords: ['staff', 'directory'] },
    { key: 'do:probation', label: 'Probation ending', group: 'Do', screen: 'employees', params: { prob: 'on' }, keywords: ['probation', 'confirm'] },
    { key: 'do:punch', label: 'Fix a punch', group: 'Do', screen: 'attendanceRequests', keywords: ['punch', 'missed punch'] },
  ];

  it('finds a job by the word people use for it', () => {
    render(<CommandPalette items={items} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'punch' } });
    expect(screen.getByRole('option', { name: /Fix a punch/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Employees/ })).toBeNull();
  });

  it('finds people from the server as the person types, and opens the one chosen', async () => {
    const loadRecords = vi.fn(async (q) => (q === 'priya' ? [{ key: 'person:1', label: 'Priya Shah', detail: 'MF-001 · Accountant', group: 'People', screen: 'employee', params: { id: '1' } }] : []));
    const onSelect = vi.fn();
    render(<CommandPalette items={items} loadRecords={loadRecords} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'priya' } });
    const hit = await screen.findByRole('option', { name: /Priya Shah/ });
    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ screen: 'employee', params: { id: '1' } }));
  });

  it('does not ask the server for one letter', async () => {
    const loadRecords = vi.fn(async () => []);
    render(<CommandPalette items={items} loadRecords={loadRecords} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(loadRecords).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  });
});

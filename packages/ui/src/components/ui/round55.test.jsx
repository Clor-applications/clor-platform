import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CommandPalette from './CommandPalette';
import RecentPeople from './RecentPeople';
import { forgetPeople, forgetSearches, recentPeople, recentSearches, rememberPerson, rememberSearch } from './recents';

/* Round 55 picks (owner, 18 Nov 2026): recentsearch A, recentrecords A. */
beforeEach(() => {
  forgetSearches();
  forgetPeople();
  delete document.documentElement.dataset.palette;
});
afterEach(() => {
  delete document.documentElement.dataset.palette;
});

describe('recent searches', () => {
  it('keeps the last five, newest first, once per wording', () => {
    ['priya', 'leave', 'payslip', 'Priya', 'punch', 'holiday', 'offer'].forEach(rememberSearch);
    expect(recentSearches()).toEqual(['offer', 'holiday', 'punch', 'Priya', 'payslip']);
  });

  it('ignores blanks and single letters', () => {
    rememberSearch('');
    rememberSearch(' a ');
    expect(recentSearches()).toEqual([]);
  });

  it('is never kept or shown in Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    rememberSearch('invoice');
    expect(recentSearches()).toEqual([]);
  });

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(recentSearches()).toEqual([]);
    spy.mockRestore();
  });
});

describe('palette with remember', () => {
  const items = [{ key: 'screen:employees', label: 'Employees', group: 'People', screen: 'employees' }];

  it('opens on the last searches and types one back in', () => {
    rememberSearch('employ');
    render(<CommandPalette items={items} remember onClose={() => {}} />);
    const row = screen.getByRole('option', { name: /employ/ });
    expect(row.textContent).toContain('Recent search');
    fireEvent.click(row);
    expect(screen.getByRole('combobox').value).toBe('employ');
    expect(screen.getByRole('option', { name: /Employees/ })).toBeTruthy();
  });

  it('remembers a search that led somewhere', () => {
    const onSelect = vi.fn();
    render(<CommandPalette items={items} remember onSelect={onSelect} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'emp' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalled();
    expect(recentSearches()).toEqual(['emp']);
  });

  it('without remember, an empty box lists destinations as before', () => {
    rememberSearch('employ');
    render(<CommandPalette items={items} onClose={() => {}} />);
    expect(screen.queryByText('Recent search')).toBeNull();
    expect(screen.getByRole('option', { name: /Employees/ })).toBeTruthy();
  });
});

describe('recently opened people', () => {
  it('keeps id and name only, last five, newest first', () => {
    for (let i = 1; i <= 6; i += 1) rememberPerson({ id: `e${i}`, name: `Person ${i}`, pan: 'ABCDE1234F' });
    rememberPerson({ id: 'e3', name: 'Person 3' });
    const list = recentPeople();
    expect(list.map((p) => p.id)).toEqual(['e3', 'e6', 'e5', 'e4', 'e2']);
    expect(Object.keys(list[0])).toEqual(['id', 'name']);
  });

  it('shows nothing until someone is opened, then lists and opens them', () => {
    const onOpen = vi.fn();
    const { container } = render(<RecentPeople onOpen={onOpen} />);
    expect(container.textContent).toBe('');
    act(() => rememberPerson({ id: 'e1', name: 'Selvi K' }));
    expect(screen.getByRole('group', { name: 'Recently opened' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Selvi K' }));
    expect(onOpen).toHaveBeenCalledWith({ id: 'e1', name: 'Selvi K' });
  });

  it('is never kept in Books', () => {
    document.documentElement.dataset.palette = 'indigo';
    rememberPerson({ id: 'e1', name: 'Selvi K' });
    expect(recentPeople()).toEqual([]);
  });
});

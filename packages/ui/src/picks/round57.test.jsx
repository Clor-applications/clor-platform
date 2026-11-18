import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DataTable from '../components/ui/DataTable';
import BulkOutcome from '../components/list/BulkOutcome';
import { bulkOutcome, bulkOutcomeLine, freshFirst, isTodayDate, opensElsewhere, screenHref, todayInIndia, waitingFirst } from './round57';
import { placeFor, rememberPlace, forgetPlaces } from '../../../shell/scrollMemory';

afterEach(cleanup);

describe('round 57 helpers', () => {
  it('puts the row just added first and leaves the rest in order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(freshFirst(rows, 'c').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(freshFirst(rows, 'x')).toBe(rows);
    expect(freshFirst(rows, null)).toBe(rows);
  });

  it('reads today in India', () => {
    /* 20:00 UTC on 17 Nov is 01:30 on 18 Nov in India. */
    expect(todayInIndia(new Date('2026-11-17T20:00:00Z'))).toBe('2026-11-18');
    expect(isTodayDate('2026-11-18T09:00:00Z', '2026-11-18')).toBe(true);
    expect(isTodayDate('2026-11-17', '2026-11-18')).toBe(false);
    expect(isTodayDate(null, '2026-11-18')).toBe(false);
  });

  it('orders waiting first, the oldest on top, then the rest newest first', () => {
    const rows = [
      { id: 1, s: 'DONE', createdAt: '2026-11-01' },
      { id: 2, s: 'WAITING', createdAt: '2026-11-10' },
      { id: 3, s: 'DONE', createdAt: '2026-11-15' },
      { id: 4, s: 'WAITING', createdAt: '2026-11-02' },
    ];
    expect(waitingFirst(rows, (r) => r.s === 'WAITING').map((r) => r.id)).toEqual([4, 2, 3, 1]);
  });

  it('says what a bulk action did, by name and reason', () => {
    const out = bulkOutcome({ done: 12, results: [{ id: 'r1', ok: true }, { id: 'r2', ok: false, error: 'Already decided.' }, { id: 'r3', ok: false }], nameOf: (id) => ({ r2: 'Ravi Kumar' })[id] });
    expect(out.failed).toEqual([{ id: 'r2', name: 'Ravi Kumar', reason: 'Already decided.' }, { id: 'r3', name: 'One request', reason: 'Not done.' }]);
    expect(bulkOutcomeLine(out)).toBe('12 approved · 2 could not be');
    expect(bulkOutcomeLine({ done: 3, failed: [] }, 'rejected')).toBe('3 rejected');
  });

  it('builds a record address that keeps the app and drops the old screen state', () => {
    const loc = { pathname: '/1234567890', search: '?app=people&open=employees&s.status=LEFT' };
    expect(screenHref('employee', { id: 'e1', tab: 'overview', skip: null }, loc)).toBe('/1234567890?app=people&open=employee&s.id=e1&s.tab=overview');
  });

  it('tells a new-tab click from a plain one', () => {
    expect(opensElsewhere({ ctrlKey: true, button: 0 })).toBe(true);
    expect(opensElsewhere({ metaKey: true, button: 0 })).toBe(true);
    expect(opensElsewhere({ button: 1 })).toBe(true);
    expect(opensElsewhere({ button: 0 })).toBe(false);
  });
});

describe('round 57 scroll place', () => {
  it('keeps the place a screen was left at, per screen and state, for half an hour', () => {
    forgetPlaces();
    rememberPlace('employees', { status: 'CURRENT' }, 840, 1000);
    expect(placeFor('employees', { status: 'CURRENT' }, 2000)).toBe(840);
    expect(placeFor('employees', { status: 'LEFT' }, 2000)).toBe(null);
    expect(placeFor('employees', { status: 'CURRENT' }, 1000 + 31 * 60 * 1000)).toBe(null);
    rememberPlace('holidays', null, 0, 1000);
    expect(placeFor('holidays', null, 2000)).toBe(null);
  });
});

describe('round 57 DataTable', () => {
  const columns = [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'note', label: 'Note', render: (r) => r.note || null }];

  it('shows an empty box as a grey dash, said as "Not added"', () => {
    render(<DataTable columns={columns} rows={[{ id: '1', name: 'Asha', phone: '', note: '' }]} total={1} />);
    expect(screen.getAllByText('Not added')).toHaveLength(2);
  });

  it('puts the row just added on top and marks it', () => {
    const { container } = render(<DataTable columns={columns} rows={[{ id: '1', name: 'Asha' }, { id: '2', name: 'Bala' }]} total={2} freshKey="2" />);
    const first = container.querySelector('tbody tr');
    expect(first.textContent).toContain('Bala');
    expect(first.className).toContain('is-new');
  });

  it('marks today in a dated list', () => {
    const today = todayInIndia();
    const { container } = render(<DataTable columns={columns} rows={[{ id: '1', name: 'Asha', date: today }, { id: '2', name: 'Bala', date: '2001-01-01' }]} total={2} rowDate={(r) => r.date} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].className).toContain('is-today');
    expect(rows[1].className).not.toContain('is-today');
    expect(screen.getAllByText('Today')).toHaveLength(1);
  });

  it('makes the row name a link: a plain click opens here, Ctrl-click is left to the browser', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: '1', name: 'Asha' }]} total={1} onRowClick={onRowClick} rowHref={(r) => `/x?open=employee&s.id=${r.id}`} />);
    const link = screen.getAllByRole('link', { name: /Asha/ })[0];
    expect(link.getAttribute('href')).toBe('/x?open=employee&s.id=1');
    fireEvent.click(link);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    fireEvent.click(link, { ctrlKey: true });
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

describe('round 57 BulkOutcome', () => {
  it('lists each request that could not be done, with why, until closed', () => {
    const onClose = vi.fn();
    render(<BulkOutcome outcome={{ done: 12, failed: [{ id: 'a', name: 'Ravi Kumar', reason: 'Already decided.' }, { id: 'b', name: 'Selvi', reason: 'Over the balance.' }] }} onClose={onClose} />);
    expect(screen.getByText('12 approved · 2 could not be')).toBeTruthy();
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
    expect(screen.getByText(/Over the balance/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('draws nothing when everything went through', () => {
    const { container } = render(<BulkOutcome outcome={{ done: 3, failed: [] }} />);
    expect(container.textContent).toBe('');
  });
});

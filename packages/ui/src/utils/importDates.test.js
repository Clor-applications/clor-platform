import { describe, expect, it } from 'vitest';

import { normaliseDateColumns, toIsoDate } from './importDates';

describe('dates from a spreadsheet', () => {
  it('reads the forms an Indian sheet uses, day first', () => {
    for (const s of ['2026-10-15', '15/10/2026', '15-10-2026', '15.10.2026', '15/10/26', '5/1/2026', '15-Oct-2026', '15 Oct 2026', '15 October 2026', '15-Sept-2026']) {
      expect(toIsoDate(s), s).toBe(s === '5/1/2026' ? '2026-01-05' : s.includes('Sept') ? '2026-09-15' : '2026-10-15');
    }
  });

  it('reads an Excel day number', () => {
    expect(toIsoDate('46310')).toBe('2026-10-15');
  });

  it('refuses what is not a calendar day rather than rolling it over', () => {
    for (const s of ['31/02/2026', '2026-13-01', '15/10', 'yesterday', '15-Foo-2026', '123']) expect(toIsoDate(s), s).toBeNull();
  });

  it('rewrites only the date columns it can read and leaves the rest for the server to name', () => {
    const rows = [
      { employeeCode: 'E1', date: '15/10/2026', note: '1/2/2026' },
      { employeeCode: 'E2', date: 'not a date' },
      { employeeCode: 'E3', date: '' },
    ];
    expect(normaliseDateColumns(rows, ['date'])).toEqual([
      { employeeCode: 'E1', date: '2026-10-15', note: '1/2/2026' },
      { employeeCode: 'E2', date: 'not a date' },
      { employeeCode: 'E3', date: '' },
    ]);
  });
});

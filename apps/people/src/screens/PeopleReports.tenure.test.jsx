import { describe, expect, it } from 'vitest';
import { tenureBands } from './PeopleReports';

describe('tenureBands', () => {
  it('puts everyone working today into bands by whole years since joining', () => {
    const today = '2026-11-18';
    const people = [
      { dateOfJoining: '2026-01-10' },
      { dateOfJoining: '2025-11-19' },
      { dateOfJoining: '2025-11-18' },
      { dateOfJoining: '2023-11-18' },
      { dateOfJoining: '2021-11-19' },
      { dateOfJoining: '2018-04-01T00:00:00.000Z' },
      { dateOfJoining: '2027-01-01' },
      { dateOfJoining: null },
      { dateOfJoining: '2015-01-01', status: 'LEFT' },
    ];
    const { rows, noDate } = tenureBands(people, today);
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toEqual({
      'Under 1 year': 2,
      '1–3 years': 1,
      '3–5 years': 2,
      '5+ years': 1,
    });
    expect(noDate).toBe(1);
  });
});

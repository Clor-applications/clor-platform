import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgePanel, SpanPanel, ageBands, ageOn, managerSpans } from './round45';

/* Round 45 picks (18 Nov 2026): age mix, team size per manager. */

const today = '2026-11-18';

describe('age mix', () => {
  it('works out whole years, birthday or not', () => {
    expect(ageOn('2001-11-18', today)).toBe(25);
    expect(ageOn('2001-11-19', today)).toBe(24);
    expect(ageOn('', today)).toBeNull();
    expect(ageOn('2030-01-01', today)).toBeNull();
  });
  it('bands the people working today and counts those without a date apart', () => {
    const people = [
      { id: 'a', dateOfBirth: '2004-01-01' }, { id: 'b', dateOfBirth: '1995-06-01' }, { id: 'c', dateOfBirth: '1990-11-18' },
      { id: 'd', dateOfBirth: '1960-01-01' }, { id: 'e' }, { id: 'f', dateOfBirth: '1980-01-01', status: 'LEFT' },
    ];
    const { rows, noDate } = ageBands(people, today);
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({ u25: 1, '25to35': 1, '35to45': 1, '45to55': 0, '55p': 1 });
    expect(noDate).toBe(1);
  });
  it('is not drawn when nobody has a date of birth', () => {
    const { container } = render(<AgePanel employees={[{ id: 'a' }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('team size per manager', () => {
  const people = [
    { id: 'm1', name: 'Rahul Verma' }, { id: 'm2', name: 'Kavya Nair' },
    { id: 'p1', name: 'A', reportingManagerId: 'm1', reportingManagerName: 'Rahul Verma' },
    { id: 'p2', name: 'B', reportingManagerId: 'm1', reportingManagerName: 'Rahul Verma' },
    { id: 'p3', name: 'C', reportingManagerId: 'm2', reportingManagerName: 'Kavya Nair' },
    { id: 'p4', name: 'D', reportingManagerId: 'm2', status: 'LEFT' },
  ];
  it('lists managers largest team first, counting only people working today', () => {
    expect(managerSpans(people).map((s) => [s.name, s.team])).toEqual([['Rahul Verma', 2], ['Kavya Nair', 1]]);
  });
  it('shows a table with the count of managers', () => {
    render(<SpanPanel employees={people} />);
    expect(screen.getByRole('rowheader', { name: 'Rahul Verma' })).toBeInTheDocument();
    expect(screen.getByText(/2 managers/)).toBeInTheDocument();
  });
});

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { latestPlaces, placeOf } from './round41';

/* Round 41 picks (18 Nov 2026): where the field team is now, as a list. */

const punches = [
  { id: 'p1', employeeId: 'e1', name: 'Ravi Kumar', at: '2026-11-18T03:30:00Z', time: '2026-11-18 09:00', kind: 'IN', address: 'MG Road, Bengaluru' },
  { id: 'p2', employeeId: 'e2', name: 'Asha N', at: '2026-11-18T04:00:00Z', time: '2026-11-18 09:30', kind: 'IN', site: 'Head Office' },
  { id: 'p3', employeeId: 'e1', name: 'Ravi Kumar', at: '2026-11-18T08:15:00Z', time: '2026-11-18 13:45', kind: 'OUT', address: 'Indiranagar, Bengaluru' },
];

describe('where the field team is now', () => {
  it('keeps each person’s latest punch, newest first', () => {
    const rows = latestPlaces(punches);
    expect(rows.map((r) => r.id)).toEqual(['p3', 'p2']);
    expect(latestPlaces(null)).toEqual([]);
  });
  it('names the place by address, else the work site', () => {
    expect(placeOf(punches[2])).toBe('Indiranagar, Bengaluru');
    expect(placeOf(punches[1])).toBe('Head Office');
    expect(placeOf({})).toBe('');
  });
});

vi.mock('../api/attendance', () => ({
  todayIst: () => '2026-11-18',
  getPhonePunches: vi.fn(() => Promise.resolve({
    summary: { punches: 3, people: 2, withSelfie: 0, refused: 0, outside: 0, field: 0, waiting: 0 },
    fieldPunchApproval: false,
    accepted: punches,
    refused: [],
    sites: [],
  })),
  getPunchPhoto: vi.fn(),
  reviewFieldPunch: vi.fn(),
  setFieldPunchApproval: vi.fn(),
}));

describe('Phone punches → Where now', () => {
  it('lists each person once with their last place and time', async () => {
    const { default: PhonePunches } = await import('../screens/PhonePunches');
    render(<PhonePunches />);
    fireEvent.click(await screen.findByRole('tab', { name: /where now/i }));
    await waitFor(() => expect(screen.getByText('Indiranagar, Bengaluru')).toBeInTheDocument());
    expect(screen.queryByText('MG Road, Bengaluru')).toBeNull();
    expect(screen.getByText('Head Office')).toBeInTheDocument();
  });
});

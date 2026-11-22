import { describe, expect, it } from 'vitest';

import { dayParts } from './AttendanceToday';

/* Attendance → Today: the day as a ring of its parts (owner, 22 Nov 2026, style E). */
describe('dayParts', () => {
  const data = { headcount: 20, present: 11, halfDay: 1, late: [{}, {}, {}], onLeave: 2, absent: 1 };

  it('splits the day into on time, late, leave, absent and the rest not in yet', () => {
    const d = dayParts(data, true);
    expect(d.parts.map((p) => [p.label, p.value])).toEqual([['In on time', 9], ['In late', 3], ['On leave', 2], ['Absent', 1], ['Not in yet', 5]]);
    expect(d).toMatchObject({ total: 20, middle: '60%', middleWords: '12 of 20 in' });
  });

  it('calls the rest not marked on a past day, and never counts more late than in', () => {
    const d = dayParts({ ...data, present: 1, halfDay: 0 }, false);
    expect(d.parts.find((p) => p.key === 'late').value).toBe(1);
    expect(d.parts.find((p) => p.key === 'rest').label).toBe('Not marked');
  });
});

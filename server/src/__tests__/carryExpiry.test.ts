import { describe, expect, it } from 'vitest';

/**
 * Carried leave that must be used in time (owner, 29 Oct 2026, from ERPNext's
 * "expire carry-forwarded leaves"): carried-in days are used first, and what
 * is left of them lapses once the type's days from the period start have gone.
 */
const { balanceFor } = await import('../services/attendance/leaveAccrual.js');

const type = { id: 't', annualDays: 12, accrual: 'YEARLY', prorateForJoiners: false, carryForwardMax: 10, carryExpiresAfterDays: 90, createdAt: new Date('2025-01-01T00:00:00Z'), creditOn: 'START' };
/* 4 days taken in 2025, so 8 carry into 2026; 3 taken in 2026 before 1 April (90 days in), 2 after. */
const taken = new Map([[2025, 4], [2026, 5]]);
const takenBefore = (y: number, date: string) => (y === 2026 && date === '2026-04-01' ? 3 : y === 2026 ? 5 : 4);

describe('carried days that lapse', () => {
  it('counts every carried day while there is still time to use them', () => {
    const b = balanceFor(type, 2026, '2024-01-01', '2026-03-01', new Map(), taken, { takenBefore });
    expect(b.carriedIn).toBe(8);
    expect(b.lapsed).toBe(0);
    expect(b.allocated).toBe(20);
  });

  it('drops the carried days not used by then', () => {
    const b = balanceFor(type, 2026, '2024-01-01', '2026-05-01', new Map(), taken, { takenBefore });
    /* 8 carried, 3 used in time: 5 lapse. */
    expect(b.lapsed).toBe(5);
    expect(b.allocated).toBe(15);
  });

  it('does not carry the lapsed days again into the next period', () => {
    const next = balanceFor(type, 2027, '2024-01-01', '2027-01-10', new Map(), taken, { takenBefore });
    /* 2026: 12 earned + 8 carried − 5 lapsed − 5 taken = 10, the limit. */
    expect(next.carriedIn).toBe(10);
    const fewer = balanceFor(type, 2027, '2024-01-01', '2027-01-10', new Map(), new Map([[2025, 4], [2026, 9]]), { takenBefore: (y, d) => (y === 2026 && d === '2026-04-01' ? 3 : 9) });
    /* 12 + 8 − 5 − 9 = 6. */
    expect(fewer.carriedIn).toBe(6);
  });

  it('without a time limit, carried days last the period, as before', () => {
    const b = balanceFor({ ...type, carryExpiresAfterDays: null }, 2026, '2024-01-01', '2026-12-01', new Map(), taken, { takenBefore });
    expect(b.lapsed).toBe(0);
    expect(b.allocated).toBe(20);
  });
});

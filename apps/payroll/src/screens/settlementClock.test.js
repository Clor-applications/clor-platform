import { describe, expect, it } from 'vitest';
import { settlementClock, workingDaysUntil } from './settlementClock';

const wed = new Date('2026-11-18T06:00:00Z');

describe('settlement countdown (round 52)', () => {
  it('counts working days and skips Sunday', () => {
    expect(workingDaysUntil('2026-11-20', wed)).toBe(2);
    expect(workingDaysUntil('2026-11-23', wed)).toBe(4);
    expect(workingDaysUntil('2026-11-18', wed)).toBe(0);
    expect(workingDaysUntil('2026-11-17', wed)).toBe(-1);
  });
  it('says it in words, only while unpaid and not overdue', () => {
    expect(settlementClock({ status: 'DRAFT', dueDate: '2026-11-20' }, wed)).toBe('Due in 2 working days');
    expect(settlementClock({ status: 'APPROVED', dueDate: '2026-11-19' }, wed)).toBe('Due in 1 working day');
    expect(settlementClock({ status: 'DRAFT', dueDate: '2026-11-18' }, wed)).toBe('Due today');
    expect(settlementClock({ status: 'PAID', dueDate: '2026-11-20' }, wed)).toBe('');
    expect(settlementClock({ status: 'DRAFT', dueDate: '2026-11-10', overdue: true }, wed)).toBe('');
  });
});

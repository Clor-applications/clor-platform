import { describe, expect, it, vi } from 'vitest';

import { blockedDelete, buzzForPunch, overCapQuestion, PUNCH_BUZZ } from './round28';

describe('round 28 picks', () => {
  it('buzzes twice for in and once for out', () => {
    const nav = { vibrate: vi.fn(() => true) };
    expect(buzzForPunch('IN', nav)).toBe(true);
    expect(nav.vibrate).toHaveBeenLastCalledWith(PUNCH_BUZZ.IN);
    expect(PUNCH_BUZZ.IN.filter((_, i) => i % 2 === 0)).toHaveLength(2);
    buzzForPunch('OUT', nav);
    expect(nav.vibrate).toHaveBeenLastCalledWith([70]);
  });

  it('does nothing where the browser cannot buzz', () => {
    expect(buzzForPunch('IN', {})).toBe(false);
    expect(buzzForPunch('IN', null)).toBe(false);
    expect(buzzForPunch('SOMETHING', { vibrate: () => true })).toBe(false);
    expect(buzzForPunch('IN', { vibrate: () => { throw new Error('no'); } })).toBe(false);
  });

  it('asks before approving overtime past the cap only', () => {
    expect(overCapQuestion({ employeeName: 'Babu', overCapMinutes: 0, overCap: null })).toBeNull();
    const q = overCapQuestion({ employeeName: 'Babu', overCapMinutes: 240, overCap: '4:00 over the cap of 50:00 a quarter' });
    expect(q.message).toBe('Approving this takes Babu past the company’s overtime limit: 4:00 over the cap of 50:00 a quarter.');
    expect(q.confirmLabel).toBe('Approve anyway');
  });

  it('says why a department with people cannot be deleted and offers them', () => {
    const d = blockedDelete('Field Sales', 14);
    expect(d.message).toContain('14 people are in Field Sales');
    expect(d.confirmLabel).toBe('See the 14 people');
    expect(blockedDelete('Stores', 1).confirmLabel).toBe('See the 1 person');
    expect(blockedDelete('Stores', 1).message).toContain('1 person is in Stores');
  });
});

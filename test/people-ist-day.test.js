import { describe, expect, it } from 'vitest';
import { istDay } from '@ui/timeOff/shared';

/* A request made at 9 pm in India is stored as 15:30 UTC: its day is the Indian one, not the UTC slice. */
describe('a timestamp shown as a day', () => {
  it('is the day in India', () => {
    expect(istDay('2026-10-27T19:00:00.000Z')).toBe('2026-10-28');
    expect(istDay('2026-10-27T18:29:59.000Z')).toBe('2026-10-27');
  });
});

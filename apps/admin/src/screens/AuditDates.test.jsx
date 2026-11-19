import { describe, expect, it } from 'vitest';

import { datesInWords, messageWords } from './AuditTrail';

/* Activity said "Entered leave for Irfan Ali, 2026-12-09 to 2026-12-11" (page audit 19 Nov 2026). */
describe('Activity dates', () => {
  it('reads a route message’s ISO dates as day, month and year', () => {
    expect(messageWords('Entered leave for Irfan Ali, 2026-12-09 to 2026-12-11', 'LeaveRequest', 'CREATE')).toBe('Entered leave for Irfan Ali, 9 Dec 2026 to 11 Dec 2026');
  });
  it('leaves timestamps, invoice numbers and impossible months alone', () => {
    expect(datesInWords('at 2026-12-09T10:00:00Z')).toBe('at 2026-12-09T10:00:00Z');
    expect(datesInWords('INV-2026-13-01')).toBe('INV-2026-13-01');
  });
});

import { describe, expect, it } from 'vitest';
import { waitingWords } from './deskWaiting';

const now = new Date('2026-11-18T10:00:00Z').getTime();

describe('help desk waiting time (round 52)', () => {
  it('says how long a case has waited on HR', () => {
    expect(waitingWords({ status: 'OPEN', createdAt: '2026-11-17T09:00:00Z' }, now)).toBe('Waiting 1 day');
    expect(waitingWords({ status: 'OPEN', createdAt: '2026-11-15T09:00:00Z' }, now)).toBe('Waiting 3 days');
    expect(waitingWords({ status: 'OPEN', createdAt: '2026-11-18T07:00:00Z' }, now)).toBe('Waiting 3 hours');
    expect(waitingWords({ status: 'OPEN', createdAt: '2026-11-18T09:30:00Z' }, now)).toBe('Waiting under an hour');
  });
  it('counts a reopened case from the reopen', () => {
    expect(waitingWords({ status: 'REOPENED', createdAt: '2026-11-01T09:00:00Z', reopenedAt: '2026-11-18T08:00:00Z' }, now)).toBe('Waiting 2 hours');
  });
  it('says nothing once the case is not with HR', () => {
    expect(waitingWords({ status: 'WAITING_EMPLOYEE', createdAt: '2026-11-01T09:00:00Z' }, now)).toBe('');
    expect(waitingWords({ status: 'RESOLVED', createdAt: '2026-11-01T09:00:00Z' }, now)).toBe('');
  });
});

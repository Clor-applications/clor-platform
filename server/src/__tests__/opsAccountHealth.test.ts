import { describe, expect, it } from 'vitest';
import { accountHealth, healthRank } from '../services/opsAccountHealth.js';

const DAY = 86_400_000;
const now = Date.parse('2026-11-20T06:00:00Z');
const base = { plan: 'active', trialEndsAt: null, createdAt: new Date(now - 200 * DAY), lastActiveAt: new Date(now - DAY), overdueInvoices: 0, failedPayments: 0, openTickets: 0, urgentTickets: 0 };
const level = (over: Partial<typeof base>) => accountHealth({ ...base, ...over }, now)?.level;
const reason = (over: Partial<typeof base>, key: string) => accountHealth({ ...base, ...over }, now)?.reasons.find((r) => r.key === key);

describe('how a customer is doing', () => {
  it('is good when nothing is overdue, no ticket waits and somebody signed in lately', () => {
    const h = accountHealth(base, now)!;
    expect(h.level).toBe('good');
    expect(h.reasons.map((r) => r.key)).toEqual(['payment', 'support', 'usage']);
    expect(h.reasons.every((r) => r.action === null)).toBe(true);
    expect(reason({}, 'usage')?.text).toBe('Used 1 day ago');
  });

  it('takes the worst of the three, and says why and what to do', () => {
    expect(level({ failedPayments: 1 })).toBe('watch');
    expect(level({ failedPayments: 1, urgentTickets: 1, openTickets: 1 })).toBe('risk');
    expect(reason({ overdueInvoices: 2 }, 'payment')).toMatchObject({ level: 'risk', text: '2 invoices are past the due date', action: expect.stringContaining('call the owner') });
    expect(reason({ plan: 'past_due' }, 'payment')).toMatchObject({ level: 'risk', text: 'Payment is overdue' });
    expect(reason({ openTickets: 1 }, 'support')).toMatchObject({ level: 'watch', text: '1 ticket is waiting for CLOR' });
  });

  it('reads silence by its length', () => {
    expect(reason({ lastActiveAt: new Date(now - 13 * DAY) }, 'usage')?.level).toBe('good');
    expect(reason({ lastActiveAt: new Date(now - 14 * DAY) }, 'usage')).toMatchObject({ level: 'watch', text: 'Nobody has signed in for 14 days' });
    expect(reason({ lastActiveAt: new Date(now - 45 * DAY) }, 'usage')?.level).toBe('risk');
    /* Never signed in: a worry after a week, not on the day they signed up. */
    expect(reason({ lastActiveAt: null }, 'usage')?.level).toBe('risk');
    expect(reason({ lastActiveAt: null, createdAt: new Date(now - 2 * DAY) }, 'usage')?.level).toBe('good');
  });

  it('counts a trial that ran out as a payment risk, and a running trial as fine', () => {
    expect(reason({ plan: 'trialing', trialEndsAt: new Date(now - DAY) }, 'payment')).toMatchObject({ level: 'risk', text: 'The trial has ended with no plan chosen' });
    expect(reason({ plan: 'trialing', trialEndsAt: new Date(now + 5 * DAY) }, 'payment')).toMatchObject({ level: 'good', text: 'On trial, nothing due' });
  });

  it('does not judge an account nobody is expected to be using, and sorts those last', () => {
    for (const plan of ['suspended', 'cancelled', 'no-plan']) expect(accountHealth({ ...base, plan }, now)).toBeNull();
    const risk = accountHealth({ ...base, plan: 'past_due' }, now);
    const good = accountHealth(base, now);
    expect([null, good, risk].sort((a, b) => healthRank(b) - healthRank(a))).toEqual([risk, good, null]);
  });
});

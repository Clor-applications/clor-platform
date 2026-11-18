import { describe, expect, it, vi } from 'vitest';

/*
 * Audit, 17 Nov 2026: a lapsed People, Payroll or Attendance app refused reading too, so employees lost their
 * payslips though the message said everything could still be read.
 */
const standings: Record<string, { state: string; reason?: string }> = {};
vi.mock('../services/subscriptions.js', async (orig) => ({
  ...(await orig<any>()),
  appStanding: async (_a: string, app: string) => standings[app] || { state: 'none' },
}));
const { appGate } = await import('../services/appGate.js');
const words = { name: 'Payroll', app: 'payroll' };

describe('an app route on a lapsed subscription', () => {
  it('reads, and refuses a change with the reason', async () => {
    standings.payroll = { state: 'lapsed', reason: 'Your free trial ended.' };
    expect(await appGate('acc', ['payroll'], 'GET', words)).toBeNull();
    expect(await appGate('acc', ['payroll'], 'POST', words)).toMatchObject({ status: 402, body: { code: 'SUBSCRIPTION_LAPSED', error: 'Your free trial ended.' } });
  });

  it('refuses everything for an app never bought', async () => {
    standings.payroll = { state: 'none' };
    expect(await appGate('acc', ['payroll'], 'GET', words)).toMatchObject({ status: 402, body: { code: 'APP_NOT_SUBSCRIBED' } });
  });

  it('lets any one of several apps open it', async () => {
    Object.assign(standings, { attendance: { state: 'none' }, people: { state: 'entitled' } });
    expect(await appGate('acc', ['attendance', 'people'], 'POST', { name: 'Attendance', app: 'attendance' })).toBeNull();
  });
});

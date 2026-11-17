import { describe, expect, it, vi } from 'vitest';

/*
 * Audit, 17 Nov 2026: the employee app's People routes checked sign-in only, so in a company with
 * Attendance alone a person could file a private case nobody there could open.
 */
const standings: Record<string, { state: string; reason?: string }> = {};
vi.mock('../services/subscriptions.js', async (orig) => ({
  ...(await orig<any>()),
  appStanding: async (_account: string, app: string) => standings[app] || { state: 'none' },
}));

const { requirePortalApp } = await import('../routes/portal.js');

const run = async (apps: string[], method = 'POST') => {
  const req: any = { method, portal: { accountId: 'acc' } };
  let status = 0;
  let body: any = null;
  let passed = false;
  const res: any = { status: (s: number) => ((status = s), res), json: (b: any) => ((body = b), res) };
  await requirePortalApp(...apps)(req, res, () => {
    passed = true;
  });
  return { passed, status, body };
};

describe('employee app routes need the company to have the app', () => {
  it('refuses a People-only route in an Attendance-only company', async () => {
    Object.assign(standings, { attendance: { state: 'entitled' }, people: { state: 'none' } });
    const out = await run(['people']);
    expect(out.passed).toBe(false);
    expect(out.status).toBe(404);
    expect(out.body.code).toBe('APP_NOT_SUBSCRIBED');
  });

  it('lets a shared route through on Attendance alone', async () => {
    Object.assign(standings, { attendance: { state: 'entitled' }, people: { state: 'none' } });
    expect((await run(['people', 'attendance'])).passed).toBe(true);
  });

  it('reads on a lapsed subscription and refuses a change', async () => {
    Object.assign(standings, { attendance: { state: 'none' }, people: { state: 'lapsed', reason: 'The trial ended.' } });
    expect((await run(['people'], 'GET')).passed).toBe(true);
    const change = await run(['people'], 'POST');
    expect(change.status).toBe(402);
    expect(change.body.error).toBe('The trial ended.');
  });
});

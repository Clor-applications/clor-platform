import { describe, expect, it } from 'vitest';
import { setupSteps } from './SetupGuide';

/* The setup guide ticks a step only from what the server holds. */
describe('setup guide', () => {
  const base = {
    tenantId: 'c1',
    overview: { companies: [{ orgId: 'c1', gstin: '' }] },
    profile: { pan: '', addressLine: '' },
    directory: { members: [{ userId: 'o', accountRole: 'OWNER', status: 'ACTIVE', authenticator: false, companies: [{ orgId: 'c1', isAdmin: true, apps: [] }] }] },
    invitations: [],
    policy: { requireAdminTwoFactor: false },
  };
  const done = (s) => Object.fromEntries(s.map((x) => [x.key, x.done]));

  it('starts with nothing done for a fresh company', () => {
    expect(done(setupSteps(base))).toEqual({ company: false, invite: false, access: true, secure: false });
  });

  it('ticks each step from real data', () => {
    const s = setupSteps({
      ...base,
      overview: { companies: [{ orgId: 'c1', gstin: '29ABCDE1234F1Z5' }] },
      profile: { pan: 'AABCC1234D', addressLine: '8, Main Road' },
      invitations: [{ status: 'PENDING' }],
      policy: { requireAdminTwoFactor: true },
    });
    expect(done(s)).toEqual({ company: true, invite: true, access: true, secure: true });
  });

  it('flags a person in this company with no app', () => {
    const s = setupSteps({
      ...base,
      directory: { members: [...base.directory.members, { userId: 'm', accountRole: 'MEMBER', status: 'ACTIVE', companies: [{ orgId: 'c1', isAdmin: false, apps: [] }] }] },
    });
    expect(done(s).access).toBe(false);
    expect(done(s).invite).toBe(true);
  });
});

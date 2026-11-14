import { describe, expect, it, vi } from 'vitest';
import { assertPeriodUnlocked, defaultPeriodLockPolicy, periodLockModuleForSource, periodLockThrough } from '../services/periodLock.js';
import { isFeatureEnabled } from '../services/features.js';

vi.mock('../services/features.js', () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));

describe('organization period lock', () => {
  it('closes manual dates and keeps user exceptions', async () => {
    const policy = defaultPeriodLockPolicy();
    policy.enabled = true;
    policy.modules.sales = { enabled: true, mode: 'MANUAL', manualThrough: '2026-10-15', autoDays: 0, exemptUserIds: ['exception-user'] };
    const db = { orgMaster: { findFirst: async () => ({ dataJson: JSON.stringify(policy) }) } };
    await expect(assertPeriodUnlocked({ accountId: 'a', orgId: 'o', userId: 'regular-user', module: 'sales', date: '2026-10-15', db })).rejects.toMatchObject({ status: 409 });
    await expect(assertPeriodUnlocked({ accountId: 'a', orgId: 'o', userId: 'exception-user', module: 'sales', date: '2026-10-15', db })).resolves.toBeUndefined();
    await expect(assertPeriodUnlocked({ accountId: 'a', orgId: 'o', userId: 'regular-user', module: 'purchases', date: '2026-10-15', db })).resolves.toBeUndefined();
  });

  it('rolls automatic cutoff by full days', () => {
    const policy = defaultPeriodLockPolicy();
    policy.enabled = true;
    policy.modules.cashBank = { enabled: true, mode: 'AUTO', manualThrough: '', autoDays: 3, exemptUserIds: [] };
    expect(periodLockThrough(policy, 'cashBank', new Date(2026, 9, 28, 14))).toBe('2026-09-30');
    expect(periodLockThrough(policy, 'cashBank', new Date(2026, 9, 2, 14))).toBe('2026-08-31');
    expect(periodLockModuleForSource('CREDIT_NOTE')).toBe('sales');
    expect(periodLockModuleForSource('DEBIT_NOTE')).toBe('purchases');
    expect(periodLockModuleForSource('RECEIPT')).toBe('cashBank');
  });

  it('allows posting when the organization feature is off', async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(false);
    const db = { orgMaster: { findFirst: async () => { throw new Error('Policy should not load'); } } };
    await expect(assertPeriodUnlocked({ accountId: 'a', orgId: 'o', userId: 'u', module: 'sales', date: '2026-10-15', db })).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { appsForModule } from '../middleware/rbac.js';
import { appsOfPermissions } from '../services/accountMembers.js';

/*
 * Platform audit, 11 Nov 2026 (P0 9): an Attendance subscription opened every
 * People permission. Owner, 12 Nov 2026: Attendance alone keeps the employee
 * record and structure, documents, announcements, and the requests and approvals
 * that carry leave and regularisation; the rest of People needs People.
 */
describe('what Attendance opens in People', () => {
  it.each(['Employees', 'Org Structure', 'Documents', 'Announcements', 'Requests', 'Approvals'])('%s: People or Attendance', (sub) => {
    expect(appsForModule('PEOPLE', sub)).toEqual(['people', 'attendance']);
  });

  it.each(['Recruitment', 'Performance', 'Learning', 'Lifecycle', 'Expenses', 'Policies', 'Privacy', 'Private Cases', 'HR Cases', 'Assets', 'Benefits', 'Events', 'Statutory Details', 'Full Identifiers', ''])('%s: People only', (sub) => {
    expect(appsForModule('PEOPLE', sub)).toEqual(['people']);
  });

  it('People still opens everything Attendance does', () => {
    expect(appsForModule('ATTENDANCE')).toEqual(['attendance', 'people']);
  });

  it('a role holding only hiring rights needs People, not Attendance', () => {
    expect(appsOfPermissions(['PEOPLE::Recruitment::VIEW'])).toEqual(['people']);
    expect(appsOfPermissions(['PEOPLE::Employees::VIEW'])).toEqual(['attendance', 'people']);
  });
});

describe('People and Attendance on one plan', async () => {
  const { peopleIncludesAttendance } = await import('../services/subscriptions.js');

  it('carries Attendance free with People, keeping its tier, never priced twice', () => {
    const out = peopleIncludesAttendance([
      { appCode: 'people', priceModel: 'per_seat', unitAmount: 9900, seats: 50 },
      { appCode: 'attendance', tier: 'FULL', priceModel: 'per_seat', unitAmount: 4900, seats: 50 },
    ]);
    expect(out.find((a) => a.appCode === 'attendance')).toMatchObject({ tier: 'FULL', priceModel: 'free', unitAmount: null, seats: null });
    expect(out.find((a) => a.appCode === 'people')).toMatchObject({ unitAmount: 9900 });
  });

  it('leaves People alone as it is, and Attendance alone as it is', () => {
    expect(peopleIncludesAttendance([{ appCode: 'people' }]).map((a) => a.appCode)).toEqual(['people']);
    const solo = [{ appCode: 'attendance', priceModel: 'per_seat', unitAmount: 4900, seats: 10 }];
    expect(peopleIncludesAttendance(solo)).toEqual(solo);
  });
});

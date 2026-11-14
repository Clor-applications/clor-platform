import { beforeEach, expect, it, vi } from 'vitest';

const approvals = vi.hoisted(() => ({ getWaiting: vi.fn() }));
vi.mock('./approvals.js', () => approvals);
const talent = vi.hoisted(() => ({ listOpenings: vi.fn() }));
vi.mock('./talent.js', () => talent);
const personnel = vi.hoisted(() => ({ listEmployees: vi.fn() }));
vi.mock('@ui/personnel/api', () => personnel);
const perms = vi.hoisted(() => ({ getMyPermissions: vi.fn() }));
vi.mock('@ui/api/permissions', () => perms);

let n = 0;
const tenant = () => ({ id: `org-${(n += 1)}` }); // a new company each time, so no answer is reused
beforeEach(() => {
  vi.clearAllMocks();
  perms.getMyPermissions.mockResolvedValue({ permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Recruitment::VIEW'] });
});

it('counts employees, open jobs and what waits, leaving out a waiting nought', async () => {
  const { peoplePanelCounts } = await import('./railCounts.js');
  approvals.getWaiting.mockResolvedValue({ waiting: 7, counts: { LEAVE: 5, ATTENDANCE: 0, HELPDESK: 2, OVERTIME: 0 } });
  personnel.listEmployees.mockResolvedValue({ employees: [{}], total: 248 });
  talent.listOpenings.mockResolvedValue([{}, {}, {}, {}]);
  expect(await peoplePanelCounts({ tenant: tenant() })).toEqual({ approvals: 7, leaveRequests: 5, helpdesk: 2, employees: 248, recruitment: 4 });
});

it('leaves out what this person cannot read, and never throws', async () => {
  const { peoplePanelCounts } = await import('./railCounts.js');
  approvals.getWaiting.mockRejectedValue(new Error('403'));
  personnel.listEmployees.mockRejectedValue(new Error('403'));
  talent.listOpenings.mockResolvedValue([]);
  expect(await peoplePanelCounts({ tenant: tenant() })).toEqual({ recruitment: 0 });
});

it('never asks for what this person may not read (a manager without hiring)', async () => {
  const { peoplePanelCounts } = await import('./railCounts.js');
  perms.getMyPermissions.mockResolvedValue({ permissions: ['PEOPLE::Requests::VIEW'] });
  approvals.getWaiting.mockResolvedValue({ waiting: 2, counts: { LEAVE: 2 } });
  expect(await peoplePanelCounts({ tenant: tenant() })).toEqual({ approvals: 2, leaveRequests: 2 });
  expect(talent.listOpenings).not.toHaveBeenCalled();
  expect(personnel.listEmployees).not.toHaveBeenCalled();
});

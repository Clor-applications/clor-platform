import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import type { Check } from './dataHealth.js';
import { workingNow } from './organization.js';

/**
 * Structure checks for Data Health (Organization): deterministic, each with
 * why it matters and where to fix it. A check about a department or a team
 * names the department or team (id and name) in place of a person, so the
 * list keeps one shape; a team-scoped viewer, whose rows are filtered to
 * their own people's ids, therefore never sees them.
 */

type Row = { id: string; name: string; code: string | null; detail?: string };
type Add = (c: Omit<Check, 'count' | 'people'>, rows: Row[]) => void;

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/*
 * Names that mean the same once written the same way: lower case, no spaces
 * or punctuation, and these few abbreviations spelled out. Kept small and
 * explicit on purpose; "IT" and "HR" are the ones small firms actually write.
 */
const ABBREVIATIONS: Record<string, string> = {
  ops: 'operations', dept: 'department', mgr: 'manager', admin: 'administration', acct: 'accounts', accts: 'accounts',
  hr: 'humanresources', it: 'informationtechnology',
};
export const nameKey = (name: string) =>
  String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => ABBREVIATIONS[w] ?? w).join('');

function similar(items: Array<{ id: string; name: string }>, label: string): Row[] {
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const i of items) {
    const k = nameKey(i.name);
    if (k) groups.set(k, [...(groups.get(k) || []), i]);
  }
  return [...groups.values()].filter((g) => g.length > 1).flatMap((g) => g.map((i) => ({ id: i.id, name: i.name, code: null, detail: `${label}; looks the same as ${g.filter((o) => o.id !== i.id).map((o) => `"${o.name}"`).join(', ')}` })));
}

export async function structureChecks(accountId: string, orgId: string, add: Add) {
  const [current, departments, positions, teams, branches] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { accountId, orgId, ...workingNow() }, select: { id: true, name: true, code: true, departmentId: true, jobPositionId: true, teamId: true, branchId: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.department.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isActive: true, headEmployeeId: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.jobPosition.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    peoplePrisma.team.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isActive: true, leadEmployeeId: true }, orderBy: { name: 'asc' } }),
    platformPrisma.branch.findMany({ where: { accountId, orgId }, select: { id: true, branchName: true, isActive: true } }),
  ]);
  const openBranches = branches.filter((b) => b.isActive).length;
  const countBy = (key: 'departmentId' | 'jobPositionId' | 'teamId' | 'branchId') => {
    const m = new Map<string, number>();
    for (const e of current) if (e[key]) m.set(e[key]!, (m.get(e[key]!) || 0) + 1);
    return m;
  };
  const inDept = countBy('departmentId');
  const inPosition = countBy('jobPositionId');
  const inTeam = countBy('teamId');
  const atBranch = countBy('branchId');
  const leaderIds = [...new Set([...departments.map((d) => d.headEmployeeId), ...teams.map((t) => t.leadEmployeeId)].filter(Boolean))] as string[];
  const leaders = new Map((leaderIds.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: leaderIds } }, select: { id: true, name: true, status: true } }) : []).map((p) => [p.id, p]));
  const leftLeader = (id: string | null) => (id && leaders.get(id)?.status === 'LEFT' ? leaders.get(id)! : null);

  add({ id: 'dept-no-head', area: 'Structure', severity: 'TIDY_UP', title: 'Department without a head', why: 'Nobody is named as running it, so staff and the overview cannot say who to go to.', fix: 'Choose a head on the department. It is a name on the chart, not a permission.', screen: 'departments' },
    departments.filter((d) => d.isActive && !d.headEmployeeId && (inDept.get(d.id) || 0) > 0).map((d) => ({ id: d.id, name: d.name, code: null, detail: people(inDept.get(d.id)!) })));

  add({ id: 'dept-head-left', area: 'Structure', severity: 'FIX_SOON', title: 'Department head has left', why: 'The department still names someone who no longer works here; staff are pointed at the wrong person.', fix: 'Choose a new head on the department.', screen: 'departments' },
    departments.filter((d) => d.isActive && leftLeader(d.headEmployeeId)).map((d) => ({ id: d.id, name: d.name, code: null, detail: `${leftLeader(d.headEmployeeId)!.name} has left` })));

  add({ id: 'retired-with-people', area: 'Structure', severity: 'FIX_SOON', title: 'Retired, but people are still in it', why: 'A retired department, designation, team or closed branch no longer shows in the lists, so these people drop out of reports and new choices.', fix: 'Move them to one in use (Transfers, or retire it again with "move them to"), or bring it back.', screen: 'departments' },
    [
      ...departments.filter((d) => !d.isActive && (inDept.get(d.id) || 0) > 0).map((d) => ({ id: d.id, name: d.name, code: null, detail: `Department; ${people(inDept.get(d.id)!)}` })),
      ...positions.filter((p) => !p.isActive && (inPosition.get(p.id) || 0) > 0).map((p) => ({ id: p.id, name: p.name, code: null, detail: `Designation; ${people(inPosition.get(p.id)!)}` })),
      ...teams.filter((t) => !t.isActive && (inTeam.get(t.id) || 0) > 0).map((t) => ({ id: t.id, name: t.name, code: null, detail: `Team; ${people(inTeam.get(t.id)!)}` })),
      ...branches.filter((b) => !b.isActive && (atBranch.get(b.id) || 0) > 0).map((b) => ({ id: b.id, name: b.branchName, code: null, detail: `Branch; ${people(atBranch.get(b.id)!)}` })),
    ]);

  add({ id: 'similar-names', area: 'Structure', severity: 'TIDY_UP', title: 'Two names that look like the same thing', why: 'People get split between two entries for one department or job, so counts and reports are wrong.', fix: 'Merge one into the other; its people and history move with it.', screen: 'departments' },
    [...similar(departments.filter((d) => d.isActive), 'Department'), ...similar(positions.filter((p) => p.isActive), 'Designation')]);

  add({ id: 'team-lead-left', area: 'Structure', severity: 'FIX_SOON', title: 'Team lead has left', why: 'The team still names someone who no longer works here as its lead.', fix: 'Choose a new lead on the team.', screen: 'teams' },
    teams.filter((t) => t.isActive && leftLeader(t.leadEmployeeId)).map((t) => ({ id: t.id, name: t.name, code: null, detail: `${leftLeader(t.leadEmployeeId)!.name} has left` })));

  if (openBranches > 1) {
    add({ id: 'no-branch', area: 'Structure', severity: 'TIDY_UP', title: 'No branch', why: 'With more than one branch, payroll registers, GST and holidays follow the branch; without one they fall to nobody.', fix: 'Set the branch on their record, or move several at once with Transfers.', screen: 'branches' },
      current.filter((e) => !e.branchId).map((e) => ({ id: e.id, name: e.name, code: e.code })));
  }
}

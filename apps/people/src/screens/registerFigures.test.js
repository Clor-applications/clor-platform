import { describe, expect, it } from 'vitest';

import {
  announcementFigures, assetFigures, assetTypes, benefitFigures, eventFigures, eventOrder, isPast, isUpcoming,
  planEnrolment, reachOf, reaches, toRecover,
} from './registerFigures';
import { WORKSPACE_CONFIG, statusName, statusPill } from './workspaceConfig';

const TODAY = '2026-11-14';
const rec = (id, status, extra = {}) => ({ id, title: id, status, employeeId: null, dueDate: null, details: {}, ...extra });

describe('asset figures (PEOPLE-08)', () => {
  const people = new Map([['p1', { id: 'p1', status: 'ACTIVE' }], ['p2', { id: 'p2', status: 'ON_NOTICE' }]]);
  const rows = [
    rec('a', 'ASSIGNED', { employeeId: 'p1', details: { category: 'Laptop' } }),
    rec('b', 'ASSIGNED', { employeeId: 'p2', details: { category: 'Phone' } }),
    rec('c', 'ASSIGNED', { employeeId: 'p1', dueDate: '2026-11-30', details: { category: 'Laptop' } }),
    rec('d', 'AVAILABLE', { details: { category: 'Laptop' } }),
    rec('e', 'RETURNED'),
    rec('f', 'REPAIR'),
    rec('g', 'RETIRED', { details: { category: 'Tools' } }),
  ];
  it('counts what is held, in store and to come back, leaving retired out of the total', () => {
    expect(assetFigures(rows, people)).toEqual({ total: 6, retired: 1, types: 2, assigned: 3, inStore: 2, repair: 1, recover: 2 });
  });
  it('wants an asset back when its holder is leaving or it has a return date', () => {
    expect(toRecover(rows[0], people.get('p1'))).toBe(false);
    expect(toRecover(rows[1], people.get('p2'))).toBe(true);
    expect(toRecover(rows[2], people.get('p1'))).toBe(true);
    expect(toRecover(rows[3], undefined)).toBe(false);
  });
  it('offers the types in use, most used first', () => {
    expect(assetTypes(rows)).toEqual(['Laptop', 'Phone', 'Tools']);
  });
});

describe('benefit figures (PEOPLE-10)', () => {
  const rows = [
    rec('Group health', 'ACTIVE'),
    rec('Meal card', 'DRAFT'),
    rec('Group health', 'ACTIVE', { id: 'e1', employeeId: 'p1', details: { startDate: '2026-04-01', endDate: '2026-12-31' } }),
    rec('group health ', 'ACTIVE', { id: 'e2', employeeId: 'p2', details: { startDate: '2026-04-01' } }),
    rec('Group health', 'ACTIVE', { id: 'e3', employeeId: 'p3', details: { startDate: '2026-12-01' } }),
    rec('Group health', 'CANCELLED', { id: 'e4', employeeId: 'p4' }),
  ];
  it('counts plans, people enrolled today, what starts later and what ends within 60 days', () => {
    expect(benefitFigures(rows, 10, TODAY)).toEqual({ plans: 1, draftPlans: 1, enrolled: 2, share: 20, starting: 1, nextStart: '2026-12-01', ending: 1 });
  });
  it('matches an enrolment to its plan by name, among the people still working', () => {
    expect(planEnrolment(rows[0], rows, new Set(['p1', 'p2', 'p3', 'p4']), TODAY)).toBe(2);
    expect(planEnrolment(rows[0], rows, new Set(['p1']), TODAY)).toBe(1);
  });
});

describe('announcement reach (PEOPLE-22)', () => {
  const working = [
    { id: 'p1', departmentId: 'd1', branchId: 'b1' },
    { id: 'p2', departmentId: 'd2', branchId: 'b1', areaId: 'l1' },
    { id: 'p3', departmentId: 'd1', branchId: 'b2' },
  ];
  it('follows the server rule for each kind of audience', () => {
    expect(reaches({}, working[0])).toBe(true);
    expect(reaches({ audienceKind: 'DEPARTMENT', audienceIds: ['d1'] }, working[1])).toBe(false);
    expect(reachOf({ details: { audienceKind: 'DEPARTMENT', audienceIds: ['d1'] } }, working)).toBe(2);
    expect(reachOf({ details: { audienceKind: 'BRANCH', audienceIds: ['b1'] } }, working)).toBe(2);
    expect(reachOf({ details: { audienceKind: 'LOCATION', audienceIds: ['l1'] } }, working)).toBe(1);
    expect(reachOf({ details: { audienceKind: 'PEOPLE', audienceIds: ['p3'] } }, working)).toBe(1);
  });
  it('counts this month against last month, and what is live and waiting', () => {
    const rows = [
      rec('a', 'PUBLISHED', { createdAt: '2026-11-02T10:00:00Z' }),
      rec('b', 'PUBLISHED', { createdAt: '2026-10-20T10:00:00Z' }),
      rec('c', 'PUBLISHED', { createdAt: '2026-10-21T10:00:00Z' }),
      rec('d', 'DRAFT', { createdAt: '2026-11-10T10:00:00Z' }),
      rec('e', 'ARCHIVED', { createdAt: '2026-09-10T10:00:00Z' }),
    ];
    expect(announcementFigures(rows, working, TODAY)).toEqual({ thisMonth: 1, lastMonth: 2, published: 3, archived: 1, drafts: 1, reach: 3 });
  });
});

describe('event split (PEOPLE-23)', () => {
  const rows = [
    rec('later', 'SCHEDULED', { details: { startDate: '2026-12-13' } }),
    rec('soon', 'DRAFT', { details: { startDate: '2026-11-20' } }),
    rec('running', 'SCHEDULED', { details: { startDate: '2026-11-13', endDate: '2026-11-15' } }),
    rec('held', 'COMPLETED', { details: { startDate: '2026-07-10' } }),
    rec('over', 'SCHEDULED', { details: { startDate: '2026-11-01' } }),
    rec('off', 'CANCELLED', { details: { startDate: '2026-11-25' } }),
  ];
  it('puts an event still running or to come in Upcoming, an ended or held one in Past, and a cancelled one in neither', () => {
    expect(rows.filter((r) => isUpcoming(r, TODAY)).map((r) => r.id)).toEqual(['later', 'soon', 'running']);
    expect(rows.filter((r) => isPast(r, TODAY)).map((r) => r.id)).toEqual(['held', 'over']);
  });
  it('lists upcoming soonest first, then the rest latest first', () => {
    expect(eventOrder(rows, TODAY).map((r) => r.id)).toEqual(['running', 'soon', 'later', 'off', 'over', 'held']);
  });
  it('counts what is coming, this month, drafts and held this year', () => {
    expect(eventFigures(rows, TODAY)).toEqual({ upcoming: 3, next: '2026-11-13', thisMonth: 3, drafts: 1, held: 2 });
  });
});

describe('status words and tones', () => {
  it('says an asset nobody holds is in store, and keeps HR cases as they were', () => {
    expect(statusName(WORKSPACE_CONFIG.assets, 'AVAILABLE')).toBe('In store');
    expect(statusName(WORKSPACE_CONFIG.events, 'SCHEDULED')).toBe('Scheduled');
    expect(statusPill(WORKSPACE_CONFIG.assets, 'REPAIR')).toBe('ui-pill-warn');
    expect(statusPill(WORKSPACE_CONFIG.events, 'CANCELLED')).toBe('ui-pill-neg');
    expect(statusPill(WORKSPACE_CONFIG.helpdesk, 'OPEN')).toBe('ui-pill-pos');
    expect(statusPill(WORKSPACE_CONFIG.helpdesk, 'CLOSED')).toBe('ui-pill-neutral');
  });
});

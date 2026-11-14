/**
 * The figures the register screens open with (clor-rnd PEOPLE-08, 10, 22, 23), worked out from the rows each screen
 * already loads. Pure functions, so the counts are tested without drawing anything. `today` is an ISO day (IST).
 */

const iso = (v) => (v ? String(v).slice(0, 10) : '');
const month = (v) => iso(v).slice(0, 7);
const prevMonth = (today) => {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const norm = (s) => String(s || '').trim().toLowerCase();
const isGone = (p) => p && (p.status === 'ON_NOTICE' || p.status === 'LEFT');

/* ------------------------------------------------------------------ assets */

/** An assigned asset that has to come back: its holder is on notice or has left, or it has a return date. */
export const toRecover = (row, holder) => row.status === 'ASSIGNED' && Boolean(row.dueDate || isGone(holder));

export function assetFigures(rows, people) {
  const live = rows.filter((r) => r.status !== 'RETIRED');
  const assigned = rows.filter((r) => r.status === 'ASSIGNED');
  return {
    total: live.length,
    retired: rows.length - live.length,
    types: new Set(live.map((r) => norm(r.details?.category)).filter(Boolean)).size,
    assigned: assigned.length,
    inStore: rows.filter((r) => r.status === 'AVAILABLE' || r.status === 'RETURNED').length,
    repair: rows.filter((r) => r.status === 'REPAIR').length,
    recover: assigned.filter((r) => toRecover(r, people.get(r.employeeId))).length,
  };
}

/** The asset types already in use, for the Type filter, most used first. */
export function assetTypes(rows) {
  const n = new Map();
  for (const r of rows) { const t = String(r.details?.category || '').trim(); if (t) n.set(t, (n.get(t) || 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/* ---------------------------------------------------------------- benefits */

/** Plans are records about nobody in particular; a record about one person is that person's enrolment in a plan of the same name. */
export function benefitFigures(rows, activePeople, today) {
  const plans = rows.filter((r) => !r.employeeId);
  const enrolments = rows.filter((r) => r.employeeId);
  const live = enrolments.filter((r) => r.status === 'ACTIVE' && (!r.details?.startDate || r.details.startDate <= today));
  const enrolled = new Set(live.map((r) => r.employeeId)).size;
  const starting = rows.filter((r) => ['ACTIVE', 'DRAFT'].includes(r.status) && iso(r.details?.startDate) > today).sort((a, b) => a.details.startDate.localeCompare(b.details.startDate));
  const soon = addDays(today, 60);
  const ending = rows.filter((r) => r.status === 'ACTIVE' && iso(r.details?.endDate) && r.details.endDate >= today && r.details.endDate <= soon);
  return {
    plans: plans.filter((r) => r.status === 'ACTIVE').length,
    draftPlans: plans.filter((r) => r.status === 'DRAFT').length,
    enrolled,
    share: activePeople ? Math.round((enrolled / activePeople) * 100) : 0,
    starting: starting.length,
    nextStart: starting[0]?.details?.startDate || '',
    ending: ending.length,
  };
}

/** How many active people hold a live enrolment in this plan (same name), out of everyone working. */
export function planEnrolment(plan, rows, activeIds, today) {
  const name = norm(plan.title);
  const ids = new Set(rows
    .filter((r) => r.employeeId && activeIds.has(r.employeeId) && norm(r.title) === name && r.status === 'ACTIVE' && (!r.details?.startDate || r.details.startDate <= today))
    .map((r) => r.employeeId));
  return ids.size;
}

/* ----------------------------------------------------------- announcements */

/** Whether an announcement reaches this person: the same rule the server applies (services/people/workspace.ts announcementReaches). */
export function reaches(details, person) {
  const kind = details?.audienceKind || 'ALL';
  const ids = Array.isArray(details?.audienceIds) ? details.audienceIds : [];
  if (kind === 'ALL') return true;
  if (kind === 'PEOPLE') return ids.includes(person.id);
  if (kind === 'BRANCH') return Boolean(person.branchId && ids.includes(person.branchId));
  if (kind === 'LOCATION') return Boolean(person.areaId && ids.includes(person.areaId));
  if (kind === 'DEPARTMENT') return Boolean(person.departmentId && ids.includes(person.departmentId));
  return true;
}

/** How many of the people still working an announcement reaches. */
export const reachOf = (row, working) => working.filter((p) => reaches(row.details, p)).length;

export function announcementFigures(rows, working, today) {
  const published = rows.filter((r) => r.status === 'PUBLISHED');
  const thisMonth = published.filter((r) => month(r.createdAt) === today.slice(0, 7)).length;
  const lastMonth = published.filter((r) => month(r.createdAt) === prevMonth(today)).length;
  return {
    thisMonth,
    lastMonth,
    published: published.length,
    archived: rows.filter((r) => r.status === 'ARCHIVED').length,
    drafts: rows.filter((r) => r.status === 'DRAFT').length,
    reach: working.length,
  };
}

/* ------------------------------------------------------------------ events */

const lastDay = (r) => iso(r.details?.endDate) || iso(r.details?.startDate);
/** Still to come: not cancelled or marked held, and not over yet. */
export const isUpcoming = (r, today) => !['CANCELLED', 'COMPLETED'].includes(r.status) && lastDay(r) >= today;
export const isPast = (r, today) => r.status !== 'CANCELLED' && (r.status === 'COMPLETED' || lastDay(r) < today);

/** Upcoming soonest first; everything else latest first. */
export function eventOrder(rows, today) {
  const up = rows.filter((r) => isUpcoming(r, today)).sort((a, b) => iso(a.details?.startDate).localeCompare(iso(b.details?.startDate)));
  const rest = rows.filter((r) => !isUpcoming(r, today)).sort((a, b) => iso(b.details?.startDate).localeCompare(iso(a.details?.startDate)));
  return [...up, ...rest];
}

export function eventFigures(rows, today) {
  const upcoming = eventOrder(rows.filter((r) => isUpcoming(r, today)), today);
  const year = today.slice(0, 4);
  return {
    upcoming: upcoming.length,
    next: upcoming[0]?.details?.startDate || '',
    thisMonth: rows.filter((r) => r.status !== 'CANCELLED' && iso(r.details?.startDate).slice(0, 7) === today.slice(0, 7)).length,
    drafts: rows.filter((r) => r.status === 'DRAFT').length,
    held: rows.filter((r) => isPast(r, today) && iso(r.details?.startDate).slice(0, 4) === year).length,
  };
}

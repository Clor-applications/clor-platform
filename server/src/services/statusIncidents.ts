import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Incidents and maintenance posted by CLOR staff (routes/opsStatus.ts), as
 * clor.in/status shows them: everything still open, maintenance planned in
 * the next 14 days, and what was resolved in the last 7 days.
 */
export const STATUS_PARTS = ['platform', 'accounting', 'people', 'payroll'] as const;
export const INCIDENT_STATES = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'] as const;
export const MAINTENANCE_STATES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const closingState = (kind: string) => (kind === 'MAINTENANCE' ? 'COMPLETED' : 'RESOLVED');

const DAY = 86_400_000;

export async function publicIncidents(now = new Date()) {
  const rows = await outsideTenant('status page: incidents', () =>
    platformPrisma.statusIncident.findMany({
      where: {
        OR: [
          { resolvedAt: null, startsAt: { lte: new Date(now.getTime() + 14 * DAY) } },
          { resolvedAt: { gte: new Date(now.getTime() - 7 * DAY) } },
        ],
      },
      orderBy: { startsAt: 'desc' },
      take: 20,
      include: { updates: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }),
  );
  return rows.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    parts: i.parts,
    impact: i.impact,
    state: i.state,
    startsAt: i.startsAt.toISOString(),
    endsAt: i.endsAt ? i.endsAt.toISOString() : null,
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
    /* Planned and not begun: shown as coming, not as a problem now. */
    upcoming: !i.resolvedAt && i.startsAt > now,
    updates: i.updates.map((u) => ({ state: u.state, body: u.body, at: u.createdAt.toISOString() })),
  }));
}

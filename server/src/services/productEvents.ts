import { platformPrisma } from '../utils/platformPrisma.js';
import { runInTenant } from '../utils/tenantScope.js';

/**
 * Product events (PRODUCT-VIEW §7): which companies reach first value, and
 * which come back. Written here, on the server, into our own database, so no
 * third-party tracker sees a company's or a person's data (DPDP).
 *
 * The R1 events, by name:
 *   employee_added        { source, first }   a person created (form, import, payroll, reader, api)
 *   leave_decided         { decision, first } an approver approved or rejected leave
 *   portal_activated      { first }           a person set their employee-app password
 *   setup_step_done       { step }            a People Home setup step ticked itself
 *   simple_mode_toggled   { on, trigger }     simple mode switched (company creation or a person)
 *   digest_sent           { week, recipients }
 *   digest_opened         { kind, channel }   a weekly summary notice opened
 *
 * Props are counts, sources and steps; never names, e-mails or free text.
 */
export type ProductEventName =
  | 'employee_added'
  | 'leave_decided'
  | 'portal_activated'
  | 'setup_step_done'
  | 'simple_mode_toggled'
  | 'digest_sent'
  | 'digest_opened';

type Props = Record<string, string | number | boolean | null | undefined>;

async function roleOf(orgId: string, userId: string | null) {
  if (!userId || userId.includes(':') || userId === 'system') return userId?.startsWith('portal:') ? 'employee' : userId ? 'system' : null;
  const a = await platformPrisma.userRoleAssignment.findFirst({ where: { orgId, userId }, select: { role: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
  return a?.role?.name?.slice(0, 60) || null;
}

/**
 * Record one event. Never throws and never makes the caller wait for more
 * than the insert: telemetry must not break, or slow, the thing it counts.
 * Resolves to true when a row was written.
 */
export async function track(orgId: string, userId: string | null | undefined, name: ProductEventName, props: Props = {}): Promise<boolean> {
  try {
    if (!orgId) return false;
    return await runInTenant(orgId, async () => {
      const uid = userId || null;
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props || {})) if (v !== undefined && k !== 'app' && k !== 'accountId') clean[k] = typeof v === 'string' ? v.slice(0, 80) : v;
      const [org, userRole] = await Promise.all([
        platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } }).catch(() => null),
        roleOf(orgId, uid).catch(() => null),
      ]);
      await platformPrisma.productEvent.create({
        data: {
          accountId: (props.accountId as string) || org?.accountId || null,
          orgId,
          userId: uid,
          userRole,
          app: typeof props.app === 'string' ? props.app.slice(0, 30) : null,
          name,
          props: Object.keys(clean).length ? JSON.stringify(clean).slice(0, 2000) : null,
        },
      });
      return true;
    });
  } catch (e) {
    console.error('[product-events]', name, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Whether the company has ever recorded this event (for "first ..." props). */
export async function hasEvent(orgId: string, name: ProductEventName) {
  try {
    return await runInTenant(orgId, async () => Boolean(await platformPrisma.productEvent.findFirst({ where: { orgId, name }, select: { id: true } })));
  } catch {
    return false;
  }
}

/**
 * Record an event with `first`: whether it is the company's first of its
 * name (first employee added, first leave approved, first app sign-in).
 * `firstOf` narrows "first" to earlier events whose props match (approved, not rejected).
 */
export async function trackFirst(orgId: string, userId: string | null | undefined, name: ProductEventName, props: Props = {}, firstOf?: Props): Promise<boolean> {
  try {
    const earlier = await runInTenant(orgId, async () => {
      const rows = await platformPrisma.productEvent.findMany({ where: { orgId, name }, select: { props: true }, take: firstOf ? 500 : 1 });
      if (!firstOf) return rows.length > 0;
      return rows.some((r) => {
        const p = r.props ? (JSON.parse(r.props) as Record<string, unknown>) : {};
        return Object.entries(firstOf).every(([k, v]) => p[k] === v);
      });
    });
    return track(orgId, userId, name, { ...props, first: !earlier });
  } catch (e) {
    console.error('[product-events]', name, e instanceof Error ? e.message : e);
    return false;
  }
}

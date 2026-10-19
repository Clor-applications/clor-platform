import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { pinKey } from './adms.js';

/**
 * Who a reader ID belongs to, and which ID a person has on a given reader.
 *
 *   1. At a reader of a site (a reader with an area), a site ID wins:
 *      ReaderIdAtSite says "at the depot, 105 is Sita".
 *   2. Otherwise the company-wide ID: Employee.devicePin.
 *   3. Otherwise the employee code, when only one person has it.
 *
 * A person who has a site ID is known at that site's readers by that ID only,
 * so their company ID there can belong to someone else. Readers with no site
 * see company IDs alone. Everything that turns a reader ID into a person, or
 * a person into the ID to put on a reader, goes through here.
 */
export type Person = { id: string; code: string | null; devicePin: string | null; branchId: string | null; areaId: string | null };

export type Matcher = ((pin: string, areaId?: string | null) => Person | null) & {
  /** Is this ID, at this site, someone's site ID (rather than a company ID)? */
  isSiteId: (pin: string, areaId?: string | null) => boolean;
  /** The ID to use for this person on a reader of this site. */
  pinFor: (person: { id: string; devicePin?: string | null; code?: string | null }, areaId?: string | null) => string;
  /** Every ID this person answers to anywhere (company + each site). */
  pinsOf: (personId: string) => string[];
};

export async function readerIdMatcher(orgId: string): Promise<Matcher> {
  const [people, sited] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId }, select: { id: true, code: true, devicePin: true, branchId: true, areaId: true } }),
    peoplePrisma.readerIdAtSite.findMany({ where: { orgId }, select: { employeeId: true, areaId: true, pin: true } }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const byPin = new Map<string, Person>();
  const byCode = new Map<string, Person>();
  const ambiguous = new Set<string>();
  for (const p of people) if (p.devicePin) byPin.set(pinKey(p.devicePin), p);
  for (const p of people) {
    if (!p.code) continue;
    const k = pinKey(p.code);
    if (byCode.has(k)) ambiguous.add(k);
    else byCode.set(k, p);
  }
  const atSite = new Map<string, Person>();
  const siteIdOf = new Map<string, string>();
  for (const s of sited) {
    const p = byId.get(s.employeeId);
    if (!p) continue;
    atSite.set(`${s.areaId}|${pinKey(s.pin)}`, p);
    siteIdOf.set(`${s.areaId}|${p.id}`, s.pin);
  }

  const match = ((pin: string, areaId?: string | null) => {
    const k = pinKey(pin);
    if (areaId) {
      const s = atSite.get(`${areaId}|${k}`);
      if (s) return s;
    }
    const p = byPin.get(k) || (ambiguous.has(k) ? null : byCode.get(k)) || null;
    /* Someone with a site ID is not their company ID at that site's readers. */
    if (p && areaId && siteIdOf.has(`${areaId}|${p.id}`)) return null;
    return p;
  }) as Matcher;
  match.isSiteId = (pin, areaId) => Boolean(areaId && atSite.has(`${areaId}|${pinKey(pin)}`));
  match.pinFor = (person, areaId) => {
    const site = areaId ? siteIdOf.get(`${areaId}|${person.id}`) : null;
    if (site) return site;
    const company = String(person.devicePin || person.code || '').trim();
    /* Their company ID is someone else's site ID there: they have no ID on that site's readers. */
    const taken = areaId && company ? atSite.get(`${areaId}|${pinKey(company)}`) : null;
    return taken && taken.id !== person.id ? '' : company;
  };
  match.pinsOf = (personId) => {
    const p = byId.get(personId);
    const out = new Set<string>();
    const own = String(p?.devicePin || p?.code || '').trim();
    if (own) out.add(own);
    for (const s of sited) if (s.employeeId === personId) out.add(s.pin);
    return [...out];
  };
  return match;
}

/**
 * Can this person have this ID at this site? A site ID must be the only one of
 * its kind there: no other site ID, and not the company ID of someone who works
 * at that site (or at every site) and has no site ID of their own there.
 */
export async function siteIdClash(orgId: string, areaId: string, pin: string, employeeId: string): Promise<string | null> {
  const k = pinKey(pin);
  const [sited, people] = await Promise.all([
    peoplePrisma.readerIdAtSite.findMany({ where: { orgId, areaId }, select: { employeeId: true, pin: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, status: { not: 'LEFT' }, id: { not: employeeId } }, select: { id: true, name: true, code: true, devicePin: true, areaId: true } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const other = sited.find((s) => s.employeeId !== employeeId && pinKey(s.pin) === k);
  if (other) return `${pin} is already ${name.get(other.employeeId) || 'someone else'}'s ID at this site.`;
  const hasSiteId = new Set(sited.map((s) => s.employeeId));
  const holder = people.find((p) => (p.areaId === areaId || !p.areaId) && !hasSiteId.has(p.id) && pinKey(String(p.devicePin || p.code || '')) === k);
  if (holder) return `${pin} is ${holder.name}'s company-wide ID, and ${holder.name} ${holder.areaId ? 'works at this site' : 'is on every site'}. Give ${holder.name} a site ID here first, or choose another.`;
  return null;
}

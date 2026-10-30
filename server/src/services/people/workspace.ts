import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { z } from 'zod';

const text = (max = 2000) => z.string().trim().max(max).default('');
/* Optional unless a register says otherwise: left out means empty, like text. */
/* The picture HR puts on an announcement or event (apps/people/src/screens/symbols.js holds the same keys). */
export const SYMBOL_KEYS = ['party', 'cake', 'diya', 'confetti', 'balloon', 'gift', 'trophy', 'star', 'sparkles', 'heart', 'wave', 'megaphone', 'pin', 'pizza', 'cricket', 'music', 'rocket', 'books', 'plane', 'sun'] as const;
const symbol = z.enum(SYMBOL_KEYS).nullable().optional().or(z.literal(''));
const date = z.string().default('').refine((s) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s), 'Enter a valid calendar date.');
/** Who an announcement is for: everyone, or only these departments, branches, locations (areas) or people. */
export const AUDIENCE_KINDS = ['ALL', 'DEPARTMENT', 'BRANCH', 'LOCATION', 'PEOPLE'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];
const email = z.union([z.string().trim().email(), z.literal('')]).default('');
// A separate permission for each register: hiring and employee cases must not
// become visible merely because somebody can read the staff directory.
/* Hiring, goals and training moved to their own tables (Talent, TALENT-DECISIONS.md; routes/peopleTalent.ts). */
export const WORKSPACE = {
  /* `audience` is the words shown with it ("Operations", "Pune branch"); `audienceKind` and `audienceIds` decide who reads it (time depth, gap 20). */
  announcements: { resource: 'Announcements', statuses: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], schema: z.object({ body: z.string().trim().min(1).max(10000), audience: text(120), audienceKind: z.enum(AUDIENCE_KINDS).default('ALL'), audienceIds: z.array(z.string().trim().min(1).max(100)).max(500).default([]), symbol }).strict() },
  events: { resource: 'Events', statuses: ['DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED'], schema: z.object({ description: text(), startDate: date.refine(Boolean, 'An event needs a start date.'), endDate: date, location: text(200), organiser: text(120), symbol }).strict() },
  helpdesk: { resource: 'HR Cases', statuses: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], schema: z.object({ category: z.enum(['GENERAL', 'PAYROLL', 'LEAVE', 'DOCUMENTS', 'OTHER']), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']), description: z.string().trim().min(1).max(5000), resolution: text(5000) }).strict() },
  assets: { resource: 'Assets', statuses: ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'REPAIR', 'RETIRED'], schema: z.object({ assetTag: z.string().trim().min(1).max(80), serialNumber: text(120), category: text(80), issuedOn: date, condition: text(500) }).strict() },
  benefits: { resource: 'Benefits', statuses: ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'], schema: z.object({ provider: text(200), eligibility: text(2000), coverage: text(2000), startDate: date, endDate: date }).strict() },
} as const;
export type WorkspaceKind = keyof typeof WORKSPACE;
export const recordSchema = z.object({
  title: z.string().trim().min(1).max(200), status: z.string(),
  employeeId: z.string().max(100).nullable().default(null),
  dueDate: date.nullable().default(null), details: z.record(z.string(), z.unknown()),
  version: z.number().int().positive().optional(),
}).strict();
export function parseRecord(kind: WorkspaceKind, raw: unknown) {
  const body = recordSchema.parse(raw);
  const config = WORKSPACE[kind];
  if (!(config.statuses as readonly string[]).includes(body.status)) throw Object.assign(new Error('Invalid status for this module.'), { status: 400 });
  const details = config.schema.parse(body.details);
  if ('startDate' in details && 'endDate' in details && details.endDate && details.endDate < details.startDate) throw Object.assign(new Error('End date must be on or after the start date.'), { status: 400 });
  if (kind === 'announcements' && 'audienceKind' in details && details.audienceKind !== 'ALL' && !details.audienceIds.length) throw Object.assign(new Error('Choose who this is for, or send it to everyone.'), { status: 400 });
  if (kind === 'announcements' && 'audienceKind' in details && details.audienceKind === 'ALL') details.audienceIds = [];
  if (kind === 'helpdesk' && !body.employeeId) throw Object.assign(new Error('Select an employee.'), { status: 400 });
  if (kind === 'assets' && body.status === 'ASSIGNED' && !body.employeeId) throw Object.assign(new Error('An assigned asset needs an employee.'), { status: 400 });
  if (kind === 'helpdesk' && ['RESOLVED', 'CLOSED'].includes(body.status) && 'resolution' in details && !details.resolution) throw Object.assign(new Error('Add a resolution before closing the case.'), { status: 400 });
  return { ...body, employeeId: body.employeeId || null, dueDate: body.dueDate || null, details };
}

/** The People module switch each register belongs to (featureCatalog: peopleHiring…). */
export const MODULE_OF_KIND: Record<string, { feature: string; label: string }> = {
  announcements: { feature: 'peopleEngage', label: 'Engage' },
  events: { feature: 'peopleEngage', label: 'Engage' },
  helpdesk: { feature: 'peopleEngage', label: 'Engage' },
  assets: { feature: 'peopleBenefits', label: 'Pay, Benefits & Assets' },
  benefits: { feature: 'peopleBenefits', label: 'Pay, Benefits & Assets' },
};

/**
 * Whether a published announcement reaches this person (time depth, gap 20).
 * One written before the audience was a choice (free words only) reached
 * everyone, and still does. A department matches by its id; only a file with
 * no department id (it names its department in words) is matched by name.
 */
export function announcementReaches(details: any, person: { id: string; branchId?: string | null; areaId?: string | null; departmentId?: string | null; department?: string | null }, departmentNames: Map<string, string> = new Map()) {
  const kind = String(details?.audienceKind || 'ALL') as AudienceKind;
  const ids: string[] = Array.isArray(details?.audienceIds) ? details.audienceIds.map(String) : [];
  if (kind === 'ALL' || !AUDIENCE_KINDS.includes(kind)) return true;
  if (kind === 'PEOPLE') return ids.includes(person.id);
  if (kind === 'BRANCH') return Boolean(person.branchId && ids.includes(person.branchId));
  if (kind === 'LOCATION') return Boolean(person.areaId && ids.includes(person.areaId));
  /* By id; a file with no department id (older imports) is matched by its department's name. */
  if (person.departmentId) return ids.includes(person.departmentId);
  const named = String(person.department || '').trim().toLowerCase();
  return Boolean(named && ids.some((id) => String(departmentNames.get(id) || '').trim().toLowerCase() === named));
}

/** Department names by id: a person whose file names a department only in words still matches it. */
export async function departmentNames(orgId: string) {
  return new Map((await peoplePrisma.department.findMany({ where: { orgId }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
}

import { z } from 'zod';

const text = (max = 2000) => z.string().trim().max(max).default('');
/* Optional unless a register says otherwise: left out means empty, like text. */
const date = z.string().default('').refine((s) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s), 'Enter a valid calendar date.');
const email = z.union([z.string().trim().email(), z.literal('')]).default('');
// A separate permission for each register: hiring and employee cases must not
// become visible merely because somebody can read the staff directory.
export const WORKSPACE = {
  announcements: { resource: 'Announcements', statuses: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], schema: z.object({ body: z.string().trim().min(1).max(10000), audience: text(120) }).strict() },
  events: { resource: 'Events', statuses: ['DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED'], schema: z.object({ description: text(), startDate: date.refine(Boolean, 'An event needs a start date.'), endDate: date, location: text(200), organiser: text(120) }).strict() },
  recruitment: { resource: 'Recruitment', statuses: ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED'], schema: z.object({ department: text(120), location: text(120), openings: z.coerce.number().int().min(1).max(10000), description: text(10000) }).strict() },
  candidates: { resource: 'Recruitment', statuses: ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'], schema: z.object({ email, phone: text(40), jobId: z.string().min(1), notes: text(4000) }).strict() },
  performance: { resource: 'Performance', statuses: ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], schema: z.object({ description: text(), measure: z.string().trim().min(1).max(200), progress: z.coerce.number().min(0).max(100), feedback: text(4000) }).strict() },
  learning: { resource: 'Learning', statuses: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], schema: z.object({ provider: text(200), description: text(), certificateUrl: z.union([z.string().url().regex(/^https:\/\//, 'Use an HTTPS link.'), z.literal('')]).default(''), hours: z.coerce.number().min(0).max(10000) }).strict() },
  helpdesk: { resource: 'HR Cases', statuses: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], schema: z.object({ category: z.enum(['GENERAL', 'PAYROLL', 'LEAVE', 'DOCUMENTS', 'OTHER']), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']), description: z.string().trim().min(1).max(5000), resolution: text(5000) }).strict() },
  assets: { resource: 'Assets', statuses: ['AVAILABLE', 'ASSIGNED', 'RETURNED', 'REPAIR', 'RETIRED'], schema: z.object({ assetTag: z.string().trim().min(1).max(80), serialNumber: text(120), category: text(80), issuedOn: date, condition: text(500) }).strict() },
  benefits: { resource: 'Benefits', statuses: ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'], schema: z.object({ provider: text(200), eligibility: text(2000), coverage: text(2000), startDate: date, endDate: date }).strict() },
} as const;
export type WorkspaceKind = keyof typeof WORKSPACE;
export const recordSchema = z.object({
  title: z.string().trim().min(1).max(200), status: z.string(),
  employeeId: z.string().max(100).nullable().default(null),
  dueDate: date.nullable().default(null), details: z.record(z.unknown()),
  version: z.number().int().positive().optional(),
}).strict();
export function parseRecord(kind: WorkspaceKind, raw: unknown) {
  const body = recordSchema.parse(raw);
  const config = WORKSPACE[kind];
  if (!(config.statuses as readonly string[]).includes(body.status)) throw Object.assign(new Error('Invalid status for this module.'), { status: 400 });
  const details = config.schema.parse(body.details);
  if ('startDate' in details && 'endDate' in details && details.endDate && details.endDate < details.startDate) throw Object.assign(new Error('End date must be on or after the start date.'), { status: 400 });
  if (['performance', 'learning', 'helpdesk'].includes(kind) && !body.employeeId) throw Object.assign(new Error('Select an employee.'), { status: 400 });
  if (kind === 'assets' && body.status === 'ASSIGNED' && !body.employeeId) throw Object.assign(new Error('An assigned asset needs an employee.'), { status: 400 });
  if (kind === 'helpdesk' && ['RESOLVED', 'CLOSED'].includes(body.status) && 'resolution' in details && !details.resolution) throw Object.assign(new Error('Add a resolution before closing the case.'), { status: 400 });
  if (kind === 'performance' && body.status === 'COMPLETED' && 'progress' in details && details.progress !== 100) throw Object.assign(new Error('A completed goal must have 100% progress.'), { status: 400 });
  return { ...body, employeeId: body.employeeId || null, dueDate: body.dueDate || null, details };
}

/** The People module switch each register belongs to (featureCatalog: peopleHiring…). */
export const MODULE_OF_KIND: Record<string, { feature: string; label: string }> = {
  recruitment: { feature: 'peopleHiring', label: 'Hiring' },
  candidates: { feature: 'peopleHiring', label: 'Hiring' },
  performance: { feature: 'peoplePerformance', label: 'Performance' },
  learning: { feature: 'peoplePerformance', label: 'Performance' },
  announcements: { feature: 'peopleEngage', label: 'Engage' },
  events: { feature: 'peopleEngage', label: 'Engage' },
  helpdesk: { feature: 'peopleEngage', label: 'Engage' },
  assets: { feature: 'peopleBenefits', label: 'Pay, Benefits & Assets' },
  benefits: { feature: 'peopleBenefits', label: 'Pay, Benefits & Assets' },
};

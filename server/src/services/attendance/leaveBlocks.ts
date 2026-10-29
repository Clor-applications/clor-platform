import { z } from 'zod';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { ISO_DATE, daysBetween } from './days.js';

/**
 * Leave block dates (owner, 29 Oct 2026, from ERPNext's Leave Block List):
 * days nobody may ask for leave, such as a year-end close or a peak season.
 * A block holds for the whole company or some departments, for every leave
 * type or some; the people it names may still ask. It is checked when leave
 * is asked for and changed, where the preview says so in plain words; HR
 * entering leave for someone is not held to it, as with notice and how far
 * back. Leave asked for before a block was made stands.
 */

const MAX_BLOCK_DAYS = 92;
const ids = z.array(z.string().trim().min(1).max(60)).max(500).default([]);
export const blockSchema = z.object({
  name: z.string().trim().min(2, 'Name the block, such as Year-end close.').max(120),
  fromDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  toDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  departmentIds: ids,
  leaveTypeIds: ids,
  allowedEmployeeIds: ids,
}).refine((b) => b.toDate >= b.fromDate, { message: 'The last day is before the first.', path: ['toDate'] })
  .refine((b) => daysBetween(b.fromDate, b.toDate).length <= MAX_BLOCK_DAYS, { message: `A block covers at most ${MAX_BLOCK_DAYS} days.`, path: ['toDate'] });
export type BlockInput = z.infer<typeof blockSchema>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const spanWords = (from: string, to: string) => (from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`);

/** Does this block hold for this person and leave type? */
export const blockHolds = (b: { departmentIds: string[]; leaveTypeIds: string[]; allowedEmployeeIds: string[] }, person: { id: string; departmentId?: string | null }, leaveTypeId: string) =>
  !b.allowedEmployeeIds.includes(person.id)
  && (!b.departmentIds.length || (person.departmentId != null && b.departmentIds.includes(person.departmentId)))
  && (!b.leaveTypeIds.length || b.leaveTypeIds.includes(leaveTypeId));

/**
 * The block, if any, that stops this person asking for this leave on these
 * dates (the days the leave would charge): its name and the days it hits, in
 * the words the form shows.
 */
export async function blockFor(orgId: string, person: { id: string; departmentId?: string | null }, leaveTypeId: string, dates: string[]) {
  if (!dates.length) return null;
  const sorted = [...dates].sort();
  const rows = await peoplePrisma.leaveBlock.findMany({ where: { orgId, fromDate: { lte: sorted[sorted.length - 1] }, toDate: { gte: sorted[0] } }, orderBy: { fromDate: 'asc' } });
  for (const b of rows) {
    if (!blockHolds(b, person, leaveTypeId)) continue;
    const hit = sorted.filter((d) => d >= b.fromDate && d <= b.toDate);
    if (!hit.length) continue;
    return { id: b.id, name: b.name, message: `No leave on ${spanWords(hit[0], hit[hit.length - 1])}: ${b.name}. Choose other days, or ask HR.` };
  }
  return null;
}

/** The ids a block names, checked against this company: departments, leave types and people elsewhere are refused. */
export async function checkBlockIds(orgId: string, b: BlockInput) {
  const [departments, types, people] = await Promise.all([
    b.departmentIds.length ? peoplePrisma.department.count({ where: { orgId, id: { in: b.departmentIds } } }) : 0,
    b.leaveTypeIds.length ? peoplePrisma.leaveType.count({ where: { orgId, id: { in: b.leaveTypeIds } } }) : 0,
    b.allowedEmployeeIds.length ? peoplePrisma.employee.count({ where: { orgId, id: { in: b.allowedEmployeeIds } } }) : 0,
  ]);
  if (departments !== new Set(b.departmentIds).size) return 'A department chosen is not in this company.';
  if (types !== new Set(b.leaveTypeIds).size) return 'A leave type chosen is not in this company.';
  if (people !== new Set(b.allowedEmployeeIds).size) return 'A person chosen is not in this company.';
  return null;
}

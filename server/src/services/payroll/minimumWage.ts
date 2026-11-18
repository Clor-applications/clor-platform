import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { round2 } from '../../utils/money.js';
import { canonicalState, stateLabel } from '../../constants/stateLevies.js';
import { wagesCheck } from './labourCodes.js';
import { calculateStructure } from './engine/calculator.js';
import { toEngineComponents } from './structureEngine.js';

/**
 * Round 66: minimum wages per state.
 *
 * Every state notifies minimum rates of wages by skill level (and some by
 * zone), and revises the dearness part twice a year, in April and October.
 * CLOR ships no rates: a wrong figure here would tell a company it pays the
 * minimum when it does not. HR enters or imports them from the state labour
 * department's notification, and CLOR compares each person's wages with the
 * rate for their state, zone and skill level.
 */

export const SKILLS = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'] as const;
export type Skill = (typeof SKILLS)[number];

export const SKILL_LABELS: Record<Skill, string> = {
  UNSKILLED: 'unskilled',
  SEMI_SKILLED: 'semi-skilled',
  SKILLED: 'skilled',
  HIGHLY_SKILLED: 'highly skilled',
};

/** "semi skilled", "Semi-Skilled", "SEMI_SKILLED" → SEMI_SKILLED. */
export function skillOf(value: unknown): Skill | null {
  const s = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((SKILLS as readonly string[]).includes(s)) return s as Skill;
  if (s === 'SEMISKILLED') return 'SEMI_SKILLED';
  if (s === 'HIGHLYSKILLED') return 'HIGHLY_SKILLED';
  return null;
}

export type RateRow = { id?: string; state: string; zone: string; skill: string; effectiveFrom: string; monthlyRate: unknown; note?: string | null };

const zoneKey = (z: unknown) => String(z ?? '').trim().toUpperCase();

/**
 * The rate for a state, zone and skill on a date: the latest one in force.
 * A row for the person's own zone beats the whole-state row ("" zone).
 */
export function rateFor(rows: RateRow[], state: string, zone: string | null | undefined, skill: string, onDate: string): RateRow | null {
  const st = canonicalState(state);
  if (!st) return null;
  const z = zoneKey(zone);
  const pick = (zoneWanted: string) =>
    rows
      .filter((r) => canonicalState(r.state) === st && r.skill === skill && zoneKey(r.zone) === zoneWanted && r.effectiveFrom <= onDate)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))[0] || null;
  return (z && pick(z)) || pick('');
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Whether a month's pay meets the minimum wage.
 *
 * What is compared is wages as the Code on Wages counts them (basic and DA,
 * never less than half of pay; wagesCheck) for a full month, so unpaid leave
 * does not read as underpayment.
 */
export function minimumWageCheck(input: {
  rows: RateRow[];
  state: string | null | undefined;
  zone?: string | null;
  skill?: string | null;
  onDate: string;
  wages: number;
  gross: number;
}) {
  const state = canonicalState(input.state);
  if (!state) return null;
  const skill = skillOf(input.skill) || 'UNSKILLED';
  const rate = rateFor(input.rows, state, input.zone, skill, input.onDate);
  if (!rate) return null;
  const minimum = round2(Number(rate.monthlyRate) || 0);
  const counted = wagesCheck(input.wages, input.gross);
  const pays = round2(counted ? counted.countedWages : Number(input.wages) || 0);
  const zone = String(rate.zone || '').trim();
  const where = `${stateLabel(state)}${zone ? ` (${zone})` : ''}, ${SKILL_LABELS[skill]}`;
  return {
    state,
    zone,
    skill,
    minimum,
    pays,
    effectiveFrom: rate.effectiveFrom,
    below: pays + 0.005 < minimum,
    shortBy: round2(Math.max(0, minimum - pays)),
    message: `Below minimum wage for ${where}: ${rupees(minimum)} a month, pays ${rupees(pays)}`,
  };
}

/** Rows an org has on file, oldest first by state. */
export function listRates(orgId: string) {
  return payrollPrisma.payrollMinimumWage.findMany({
    where: { orgId, deletedAt: null },
    orderBy: [{ state: 'asc' }, { zone: 'asc' }, { skill: 'asc' }, { effectiveFrom: 'desc' }],
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RateInput = { state: string; zone: string; skill: Skill; effectiveFrom: string; monthlyRate: number; note: string | null };

/** One row checked; a plain-word error or the cleaned row. */
export function validateRate(raw: Record<string, unknown>): { ok: true; row: RateInput } | { ok: false; error: string } {
  const state = canonicalState(String(raw.state ?? ''));
  if (!state) return { ok: false, error: 'Add the state.' };
  const skill = skillOf(raw.skill);
  if (!skill) return { ok: false, error: 'Skill level is one of unskilled, semi-skilled, skilled or highly skilled.' };
  const effectiveFrom = String(raw.effectiveFrom ?? raw.effective_from ?? '').trim();
  if (!ISO_DATE.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) return { ok: false, error: 'Applies from is a date like 2026-04-01.' };
  const rate = Number(String(raw.monthlyRate ?? raw.monthly_rate ?? '').replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: 'Monthly rate is an amount above zero.' };
  if (rate > 1_000_000) return { ok: false, error: 'Monthly rate looks too large: enter a month’s minimum wage in rupees.' };
  const zone = String(raw.zone ?? '').trim().slice(0, 60);
  const note = String(raw.note ?? '').trim().slice(0, 300) || null;
  return { ok: true, row: { state, zone, skill, effectiveFrom, monthlyRate: round2(rate), note } };
}

/** A CSV line split on commas, with "quoted, values" kept whole. */
function splitCsvLine(line: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export const CSV_COLUMNS = ['state', 'zone', 'skill', 'effective_from', 'monthly_rate', 'note'];

/**
 * A CSV of rates: a header row naming the columns (state, zone, skill,
 * effective_from, monthly_rate, note; zone and note may be left out), then
 * one rate per line. Every bad line is reported by number; none is saved
 * unless all are good.
 */
export function parseRatesCsv(text: string): { rows: RateInput[]; errors: { line: number; error: string }[] } {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const errors: { line: number; error: string }[] = [];
  const rows: RateInput[] = [];
  const headerAt = lines.findIndex((l) => l.trim() !== '');
  if (headerAt < 0) return { rows, errors: [{ line: 1, error: 'The file is empty.' }] };
  const header = splitCsvLine(lines[headerAt]).map((h) => h.toLowerCase().replace(/[\s-]+/g, '_'));
  const missing = ['state', 'skill', 'effective_from', 'monthly_rate'].filter((c) => !header.includes(c));
  if (missing.length) return { rows, errors: [{ line: headerAt + 1, error: `The first line names the columns; ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.` }] };
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const raw: Record<string, unknown> = {};
    header.forEach((h, j) => { raw[h] = cells[j] ?? ''; });
    const checked = validateRate(raw);
    if (checked.ok) rows.push(checked.row);
    else errors.push({ line: i + 1, error: checked.error });
  }
  if (!rows.length && !errors.length) errors.push({ line: headerAt + 2, error: 'There are no rates under the column names.' });
  return { rows, errors };
}

/**
 * The April and October reminder.
 *
 * From 1 April and from 1 October, every state that somebody in payroll
 * works in and that has rates on file, but none applying from that date or
 * later, is named: its rates are probably the old ones. Nothing is said for
 * a company with no rates on file at all; the empty table says that itself.
 */
export function revisionReminder(today: string, rows: RateRow[], statesInUse: string[]) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const since = month >= 10 ? `${year}-10-01` : month >= 4 ? `${year}-04-01` : `${year - 1}-10-01`;
  const label = since.slice(5, 7) === '04' ? `April ${since.slice(0, 4)}` : `October ${since.slice(0, 4)}`;
  const used = [...new Set(statesInUse.map((s) => canonicalState(s)).filter(Boolean))];
  const stale = used.filter((st) => {
    const ofState = rows.filter((r) => canonicalState(r.state) === st);
    return ofState.length > 0 && !ofState.some((r) => r.effectiveFrom >= since);
  });
  if (!stale.length) return null;
  const names = stale.map((s) => stateLabel(s));
  return {
    since,
    states: stale,
    message: `States revise minimum wages in April and October. No ${label} rates yet for ${names.join(', ')}: add them from the state's notification.`,
  };
}

/**
 * The check on a salary as it is saved: this person, on this structure, at
 * this CTC, from this date. A full month of 30 days, nothing variable. Null
 * when there is nothing to say (no rate on file, no state, or the pay meets it).
 */
export async function minimumWageForSalary(orgId: string, input: { employeeId: string; structureId: string; annualCtc: number; effectiveFrom: string; periodsPerYear: number }) {
  const rows = await payrollPrisma.payrollMinimumWage.findMany({ where: { orgId, deletedAt: null } });
  if (!rows.length) return null;
  const profile = await payrollPrisma.employeePayrollProfile.findFirst({
    where: { orgId, employeeId: input.employeeId },
    select: { professionalTaxState: true, minimumWageZone: true, skillLevel: true },
  });
  if (!profile || !canonicalState(profile.professionalTaxState)) return null;
  const lines = await payrollPrisma.salaryStructureComponent.findMany({ where: { orgId, structureId: input.structureId } });
  if (!lines.length) return null;
  const components = await payrollPrisma.salaryComponent.findMany({ where: { orgId, id: { in: lines.map((l) => l.componentId) } } });
  const { engine } = toEngineComponents(lines as any, components);
  if (!engine.length) return null;
  let month;
  try {
    month = calculateStructure(engine, { annualCtc: input.annualCtc, periodsPerYear: input.periodsPerYear, workingDays: 30, payableDays: 30, lwpDays: 0, variableAmounts: {} });
  } catch {
    return null;
  }
  const check = minimumWageCheck({
    rows,
    state: profile.professionalTaxState,
    zone: profile.minimumWageZone,
    skill: profile.skillLevel,
    onDate: input.effectiveFrom,
    wages: month.gratuityWage,
    gross: month.grossEarnings,
  });
  return check?.below ? check : null;
}

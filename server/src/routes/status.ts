import cors from 'cors';
import { Router } from 'express';

/**
 * Is CLOR working, for anybody to ask: clor.in/status reads this from the browser.
 *
 * It says which part answers and which does not, never why: no error text, host name or
 * connection string leaves the server. The four stores are asked at most once every 20
 * seconds however many people have the page open, so the page cannot be used to load them.
 */
export type StoreChecks = { accounting: boolean; payroll: boolean; people: boolean; platform: boolean };

/** Each of the four databases answers within two seconds. The same check the readiness probe makes (app.ts, /ready). */
export async function storeChecks(): Promise<StoreChecks> {
  const { prisma } = await import('../utils/prisma.js');
  const { payrollPrisma } = await import('../utils/payrollPrisma.js');
  const { peoplePrisma } = await import('../utils/peoplePrisma.js');
  const { platformPrisma } = await import('../utils/platformPrisma.js');
  const within = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]).catch(() => false);
  const [accounting, payroll, people, platform] = await Promise.all([
    within(prisma.$queryRaw`SELECT 1`),
    within(payrollPrisma.$queryRaw`SELECT 1`),
    within(peoplePrisma.$queryRaw`SELECT 1`),
    within(platformPrisma.$queryRaw`SELECT 1`),
  ]);
  return { accounting, payroll, people, platform };
}

/* What a customer calls each part, in the order the page lists them. Sign-in lives in the platform store. */
const PARTS: Array<[keyof StoreChecks, string]> = [
  ['platform', 'Sign-in and Workspace'],
  ['accounting', 'Books'],
  ['people', 'People and Attendance'],
  ['payroll', 'Payroll'],
];

const FRESH_MS = 20_000;
let last: { at: number; checks: StoreChecks } | null = null;
let asking: Promise<StoreChecks> | null = null;

/** The last answer while it is fresh; one question to the stores at a time. */
export async function publicStatus(now = Date.now()) {
  if (!last || now - last.at >= FRESH_MS) {
    asking ||= storeChecks().finally(() => { asking = null; });
    last = { at: now, checks: await asking };
  }
  const parts = PARTS.map(([key, name]) => ({ key, name, ok: last!.checks[key] }));
  return { ok: parts.every((p) => p.ok), parts, checkedAt: new Date(last.at).toISOString() };
}

/** For tests: forget the kept answer. */
export const forgetPublicStatus = () => { last = null; };

export const publicStatusRouter = Router();
/* clor.in reads it from the browser: any origin, no credentials, GET only. */
export const statusCors = cors({ origin: true, methods: ['GET'], credentials: false, maxAge: 7200 });

publicStatusRouter.get('/public/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=20');
  res.json(await publicStatus());
});

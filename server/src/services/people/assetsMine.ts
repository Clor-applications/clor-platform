import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../features.js';
import { notifyPermission } from '../notifications.js';
import { todayIst } from '../../utils/istDate.js';
import { raiseRequest } from './desk.js';

/**
 * The company things a person holds, in the employee app (picks round 51):
 * they confirm "I still have this", report a problem with one, or ask for
 * something they need. A problem and an ask both become an Ask HR case in
 * the IT queue, so the person follows the answer where they follow every
 * other; a problem is also marked on the asset for whoever keeps the register.
 */
type Me = { accountId: string; orgId: string; employeeId: string };

/* Written by the holder from the app, not by HR's register form: kept when HR saves the asset (routes/peopleWorkspace.ts). */
export const HOLDER_KEYS = ['confirmedOn', 'problem', 'problemOn'] as const;

export class AssetError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const STATE_WORDS: Record<string, string> = { GOOD: 'Good', FAIR: 'Fair', DAMAGED: 'Damaged' };

async function moduleOn(me: Me) {
  if (!(await isFeatureEnabled(me.accountId, me.orgId, 'peopleBenefits'))) throw new AssetError('Company things are not kept in CLOR here. Ask HR.', 403);
}

const shape = (r: { id: string; title: string; details: unknown }) => {
  const d = (r.details || {}) as Record<string, unknown>;
  return {
    id: r.id, title: r.title, tag: String(d.assetTag || '') || null, category: String(d.category || '') || null, serialNumber: String(d.serialNumber || '') || null,
    issuedOn: String(d.issuedOn || '') || null, state: STATE_WORDS[String(d.state || '')] || null,
    confirmedOn: String(d.confirmedOn || '') || null, problem: String(d.problem || '') || null, problemOn: String(d.problemOn || '') || null,
  };
};

/** What I hold now. Never the value the company put on it. */
export async function myAssets(me: Me) {
  if (!(await isFeatureEnabled(me.accountId, me.orgId, 'peopleBenefits'))) return { available: false, assets: [] };
  const rows = await peoplePrisma.peopleRecord.findMany({ where: { orgId: me.orgId, kind: 'assets', status: 'ASSIGNED', employeeId: me.employeeId }, orderBy: { title: 'asc' }, select: { id: true, title: true, details: true } });
  return { available: true, assets: rows.map(shape) };
}

async function mine(me: Me, id: string) {
  await moduleOn(me);
  const r = await peoplePrisma.peopleRecord.findFirst({ where: { id, orgId: me.orgId, kind: 'assets', status: 'ASSIGNED', employeeId: me.employeeId } });
  if (!r) throw new AssetError('That is not with you any more.', 404);
  return r;
}

/* The holder's own keys only, over the version read: an HR save at the same moment wins and this asks again. */
async function writeHolder(r: { id: string; orgId: string; version: number; details: unknown }, patch: Record<string, string | null>) {
  const details = { ...((r.details || {}) as Record<string, unknown>), ...patch };
  const done = await peoplePrisma.peopleRecord.updateMany({ where: { id: r.id, orgId: r.orgId, version: r.version }, data: { details: details as any, version: { increment: 1 } } });
  if (!done.count) throw new AssetError('This changed a moment ago. Try again.', 409);
}

/** "I still have this": today's date on the asset. */
export async function confirmAsset(me: Me, id: string) {
  const r = await mine(me, id);
  await writeHolder(r, { confirmedOn: todayIst() });
  return shape({ ...r, details: { ...(r.details as object), confirmedOn: todayIst() } });
}

const nameOf = (r: { title: string; details: unknown }) => {
  const tag = String(((r.details || {}) as Record<string, unknown>).assetTag || '');
  return `${r.title}${tag ? ` (${tag})` : ''}`;
};

/** "Report a problem": marked on the asset, and an Ask HR case in the IT queue the person follows. */
export async function reportProblem(me: Me, id: string, text: unknown) {
  const what = String(text ?? '').trim().slice(0, 1000);
  if (what.length < 5) throw new AssetError('Say what is wrong with it.');
  const r = await mine(me, id);
  const today = todayIst();
  await writeHolder(r, { problem: what.slice(0, 300), problemOn: today });
  const desk = await caseFor(me, `Problem with ${nameOf(r)}`.slice(0, 200), what);
  await notifyPermission(me.accountId, me.orgId, 'PEOPLE::Assets::EDIT', { kind: 'people.asset', title: `Problem reported: ${nameOf(r)}`, body: what.slice(0, 200), link: { app: 'people', screen: 'assets' } as any }).catch(() => undefined);
  return { asset: shape({ ...r, details: { ...(r.details as object), problem: what.slice(0, 300), problemOn: today } }), caseId: desk?.id ?? null };
}

/** "Ask for something": a free-text ask (a headset, a second screen) as an Ask HR case in the IT queue. */
export async function askForAsset(me: Me, text: unknown) {
  await moduleOn(me);
  const what = String(text ?? '').trim().slice(0, 1000);
  if (what.length < 3) throw new AssetError('Say what you need.');
  const desk = await caseFor(me, `Asking for: ${what.split('\n')[0]}`.slice(0, 200), what.length < 5 ? `${what} (asked from the app)` : what);
  if (!desk) throw new AssetError('Ask HR is switched off here, so this cannot be sent. Ask HR in person.', 403);
  return { caseId: desk.id };
}

/* Ask HR is a different module: when it is off a problem is still marked on the asset; an ask has nowhere to go. */
async function caseFor(me: Me, subject: string, description: string) {
  if (!(await isFeatureEnabled(me.accountId, me.orgId, 'peopleEngage'))) return null;
  return raiseRequest({ accountId: me.accountId, orgId: me.orgId, userId: null, employeeId: me.employeeId }, me.employeeId, { category: 'IT', subject, description, urgency: 'NORMAL' });
}

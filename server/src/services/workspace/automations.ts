import { platformPrisma } from '../../utils/platformPrisma.js';
import { dayWords, istDate } from '../../utils/istDate.js';
import { sendNotice } from '../notifications.js';
import { companyUsers, defineRecipe, ownerUsers, recipientUsers, type RecipientKind } from '../people/engagement/automations.js';
import { adminUserIds } from '../roleGuards.js';

/**
 * Workspace's ready-made automations (platform audit, 11 Nov 2026: the registry listed Workspace but nothing
 * was defined). Each is a plain sentence with a switch and one number of days, run by the daily job
 * (`people.automations`) once per company and day, and each starts off. They are saved per company, like
 * every other recipe, and each speaks about the company it is switched on in:
 *
 *  - an invitation into this company still not accepted: whoever sent it hears, once per time it was sent;
 *  - an administrator of this company with no authenticator app: the owner hears, once per administrator;
 *  - this company's closure is near: the owner hears, once per closing date;
 *  - an accountant's (outside firm's) access to this company is about to end: the owner hears, once per end date;
 *  - somebody who can open this company has stopped signing in: the owner hears, once per person and quiet spell.
 *
 * Each is about one thing that happens once, so each is one notice per person under its own key (`sendNotice`
 * with a dedupe key): a second run, the same day or the next, sends nothing more.
 */

const TO_OWNER = { default: ['OWNER'], options: ['OWNER', 'PERSON'] as RecipientKind[] };
const MORNING = { job: 'people.automations', when: 'Every morning', channels: ['bell' as const] };
const ACCESS = 'Access';
const SECURITY = 'Security';
const DATA = 'Data';

const DAY = 86_400_000;
const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const namesOf = async (ids: string[]) => new Map((ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));

/** The companies an invitation gives access to. */
const orgsOf = (grants: string): string[] => {
  try {
    const g = JSON.parse(grants);
    return Array.isArray(g) ? g.map((x) => String(x?.orgId || '')).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export const invitationWaiting = defineRecipe({
  module: 'workspace', key: 'invitationWaiting', group: ACCESS,
  sentence: 'Remind whoever sent an invitation when it is still not accepted after {n} days',
  defaultOn: false, n: { default: 3, min: 1, max: 30 }, ...MORNING,
  run: async ({ accountId, orgId, n, now }) => {
    const days = n ?? 3;
    const waiting = (await platformPrisma.accountInvitation.findMany({ where: { accountId, status: 'PENDING', expiresAt: { gt: now }, lastSentAt: { lte: new Date(now.getTime() - days * DAY) } }, select: { id: true, email: true, grants: true, invitedByUserId: true, sendCount: true, expiresAt: true }, take: 500 }))
      .filter((i) => orgsOf(i.grants).includes(orgId));
    if (!waiting.length) return { count: 0, recipients: [] };
    /* Whoever sent it, while they are still a user of this company; else the owner, so it is not lost. */
    const here = new Set((await companyUsers(orgId, [...new Set(waiting.map((i) => i.invitedByUserId))])).map((u) => u.id));
    let owners: string[] | null = null;
    const told = new Set<string>();
    let count = 0;
    let failed = 0;
    for (const i of waiting) {
      const ids = here.has(i.invitedByUserId) ? [i.invitedByUserId] : (owners ??= await ownerUsers(accountId, orgId).catch(() => [] as string[]));
      try {
        const sent = await sendNotice(accountId, orgId, ids, {
          kind: 'workspace.invitation_waiting',
          title: `${i.email} has not accepted the invitation yet`,
          body: `Sent ${daysWord(days)} or more ago; the link works until ${dayWords(istDate(i.expiresAt))}. Send it again, or check the address.`,
          link: { app: 'admin', screen: 'invitations' },
        }, { dedupeKey: `invitation-waiting:${i.id}:${i.sendCount}` });
        count += sent;
        if (sent) ids.forEach((id) => told.add(id));
      } catch (e) {
        console.error('[automations] workspace notice not sent:', e instanceof Error ? e.message : e);
        failed += 1;
      }
    }
    const names = await namesOf([...told]);
    return { count, recipients: [...told].map((id) => names.get(id) || 'A user'), failed };
  },
});

export const adminNoAuthenticator = defineRecipe({
  module: 'workspace', key: 'adminNoAuthenticator', group: SECURITY,
  sentence: 'Tell when an administrator has had no authenticator app for {n} days',
  defaultOn: false, n: { default: 7, min: 1, max: 90 }, ...MORNING, recipients: TO_OWNER,
  run: async ({ accountId, orgId, n, now, to }) => {
    const days = n ?? 7;
    const admins = [...(await adminUserIds(platformPrisma, accountId, orgId))];
    if (!admins.length) return { count: 0, recipients: [] };
    /* Counted from when they joined this company: a new administrator gets the chosen days to set one up. */
    const longHere = await platformPrisma.userOrgMembership.findMany({ where: { accountId, orgId, userId: { in: admins }, createdAt: { lte: new Date(now.getTime() - days * DAY) } }, select: { userId: true } });
    const without = longHere.length ? await platformPrisma.user.findMany({ where: { id: { in: longHere.map((m) => m.userId) }, isActive: true, totpEnabledAt: null, smsTwoFactorEnabledAt: null }, select: { id: true, fullName: true }, orderBy: { id: 'asc' } }) : [];
    if (!without.length) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_OWNER.default });
    const told = new Set<string>();
    let count = 0;
    let failed = 0;
    for (const a of without) {
      /* Each hears about the others; about themselves the words change. */
      for (const id of ids) {
        try {
          const sent = await sendNotice(accountId, orgId, [id], {
            kind: 'workspace.admin_no_authenticator',
            title: id === a.id ? 'You have no authenticator app set up' : `${a.fullName} has no authenticator app set up`,
            body: `An administrator of this company for ${daysWord(days)} or more, signing in with a password alone. ${id === a.id ? 'Set one up under your profile.' : 'Ask them to set one up, or require it under Sign-in and sessions.'}`,
            link: { app: 'admin', screen: 'security' },
          }, { dedupeKey: `admin-no-authenticator:${a.id}` });
          count += sent;
          if (sent) told.add(id);
        } catch (e) {
          console.error('[automations] workspace notice not sent:', e instanceof Error ? e.message : e);
          failed += 1;
        }
      }
    }
    const names = await namesOf([...told]);
    return { count, recipients: [...told].map((id) => names.get(id) || 'A user'), failed };
  },
});

export const closureSoon = defineRecipe({
  module: 'workspace', key: 'closureSoon', group: DATA,
  sentence: 'Tell {n} days before this company is closed and its data deleted',
  defaultOn: false, n: { default: 7, min: 1, max: 30 }, ...MORNING, recipients: TO_OWNER,
  run: async ({ accountId, orgId, n, now, to }) => {
    const days = n ?? 7;
    const c = await platformPrisma.orgClosure.findUnique({ where: { orgId }, select: { id: true, status: true, orgName: true, deleteAfter: true } });
    if (!c || c.status !== 'SCHEDULED' || c.deleteAfter.getTime() <= now.getTime() || c.deleteAfter.getTime() - now.getTime() > days * DAY) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_OWNER.default });
    const on = istDate(c.deleteAfter);
    const left = Math.max(1, Math.ceil((c.deleteAfter.getTime() - now.getTime()) / DAY));
    const names = await namesOf(ids);
    const told: string[] = [];
    let failed = 0;
    for (const id of ids) {
      try {
        const sent = await sendNotice(accountId, orgId, [id], {
          kind: 'workspace.closure_soon',
          title: `${c.orgName} will be closed in ${daysWord(left)}`,
          body: `Everything it holds is deleted after ${dayWords(on)} and cannot be brought back. Take a full export first, or cancel the closure to keep the company.`,
          link: { app: 'admin', screen: 'close' },
        }, { dedupeKey: `closure-soon:${c.id}:${on}` });
        if (sent) told.push(names.get(id) || 'A user');
      } catch (e) {
        console.error('[automations] workspace notice not sent:', e instanceof Error ? e.message : e);
        failed += 1;
      }
    }
    return { count: told.length, recipients: told, failed };
  },
});

export const outsideAccessEnding = defineRecipe({
  module: 'workspace', key: 'outsideAccessEnding', group: ACCESS,
  sentence: 'Tell {n} days before an accountant’s access to this company ends',
  defaultOn: false, n: { default: 7, min: 1, max: 30 }, ...MORNING, recipients: TO_OWNER,
  run: async ({ accountId, orgId, n, now, to }) => {
    const days = n ?? 7;
    const ending = await platformPrisma.outsideAccess.findMany({
      where: { accountId, orgId, status: 'ACTIVE', expiresAt: { gt: now, lte: new Date(now.getTime() + days * DAY) } },
      select: { id: true, userId: true, expiresAt: true },
      orderBy: { expiresAt: 'asc' },
    });
    if (!ending.length) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_OWNER.default });
    const who = await namesOf(ending.map((e) => e.userId));
    const told = new Set<string>();
    let count = 0;
    let failed = 0;
    for (const e of ending) {
      const on = istDate(e.expiresAt!);
      const left = Math.max(1, Math.ceil((e.expiresAt!.getTime() - now.getTime()) / DAY));
      try {
        /* Keyed on the end date: extended and coming up again, it is said again; otherwise once. */
        const sent = await sendNotice(accountId, orgId, ids, {
          kind: 'workspace.outside_access_ending',
          title: `${who.get(e.userId) || 'An accountant'}’s access ends in ${daysWord(left)}`,
          body: `After ${dayWords(on)} they can no longer open this company. Extend it if their work is not finished; otherwise nothing needs doing.`,
          link: { app: 'admin', screen: 'outsideAccess' },
        }, { dedupeKey: `outside-access-ending:${e.id}:${on}` });
        count += sent;
        if (sent) ids.forEach((id) => told.add(id));
      } catch (err) {
        console.error('[automations] workspace notice not sent:', err instanceof Error ? err.message : err);
        failed += 1;
      }
    }
    const names = await namesOf([...told]);
    return { count, recipients: [...told].map((id) => names.get(id) || 'A user'), failed };
  },
});

/** At most this many people are named in one morning; the rest follow on the mornings after, each once. */
const QUIET_PER_RUN = 10;

export const notSigningIn = defineRecipe({
  module: 'workspace', key: 'notSigningIn', group: ACCESS,
  sentence: 'Tell when somebody who can open this company has not signed in for {n} days',
  defaultOn: false, n: { default: 30, min: 14, max: 180 }, ...MORNING, recipients: TO_OWNER,
  run: async ({ accountId, orgId, n, now, to }) => {
    const days = n ?? 30;
    const cutoff = new Date(now.getTime() - days * DAY);
    /* In this company for the chosen days at least: somebody added last week is not "quiet" yet. */
    const members = await platformPrisma.userOrgMembership.findMany({ where: { accountId, orgId, createdAt: { lte: cutoff } }, select: { userId: true } });
    if (!members.length) return { count: 0, recipients: [] };
    const quiet = await platformPrisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) }, isActive: true, OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }] },
      select: { id: true, fullName: true, lastLoginAt: true },
      /* Never signed in first, then the longest away. */
      orderBy: [{ lastLoginAt: { sort: 'asc', nulls: 'first' } }, { fullName: 'asc' }],
    });
    if (!quiet.length) return { count: 0, recipients: [] };
    const ids = await recipientUsers({ accountId, orgId }, to, { fallback: TO_OWNER.default });
    const told = new Set<string>();
    let count = 0;
    let failed = 0;
    let named = 0;
    for (const u of quiet) {
      if (named >= QUIET_PER_RUN) break;
      /* Nobody is told about themself: whoever reads the notice has signed in. */
      const others = ids.filter((id) => id !== u.id);
      if (!others.length) continue;
      const last = u.lastLoginAt ? istDate(u.lastLoginAt) : null;
      try {
        /* Keyed on the last sign-in: once per quiet spell. Back and quiet again later, it is said again. */
        const sent = await sendNotice(accountId, orgId, others, {
          kind: 'workspace.not_signing_in',
          title: last ? `${u.fullName} has not signed in for ${daysWord(Math.floor((now.getTime() - u.lastLoginAt!.getTime()) / DAY))}` : `${u.fullName} has never signed in`,
          body: `${last ? `Last signed in on ${dayWords(last)}.` : `Added ${daysWord(days)} or more ago.`} If they no longer need CLOR, take away their access to free the seat.`,
          link: { app: 'admin', screen: 'usage' },
        }, { dedupeKey: `not-signing-in:${u.id}:${last || 'never'}` });
        count += sent;
        if (sent) {
          named += 1;
          others.forEach((id) => told.add(id));
        }
      } catch (err) {
        console.error('[automations] workspace notice not sent:', err instanceof Error ? err.message : err);
        failed += 1;
      }
    }
    const names = await namesOf([...told]);
    return { count, recipients: [...told].map((id) => names.get(id) || 'A user'), failed };
  },
});

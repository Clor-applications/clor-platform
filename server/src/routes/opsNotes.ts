import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { audit } from './ops.js';

/**
 * Notes and tags on a customer (docs/workspace/OPS_PORTAL_GAPS.md #1).
 *
 * CLOR staff's own memory of a customer: "called the owner on 12 Nov, the
 * e-invoice password was wrong", and labels such as "CA firm" or "pilot" to
 * find a group again. The customer never sees either; the tables are open
 * only outside any company (migration 20261215090000_ops_modules). Every
 * operator reads them; Sales, Support and Billing write them. A note can be
 * changed or removed only by whoever wrote it, or the owner.
 */
export const opsNotesRouter = Router();
opsNotesRouter.use('/ops/accounts', requireAuth, requireOperator);
opsNotesRouter.use('/ops/tags', requireAuth, requireOperator);

const WRITERS = ['SALES', 'SUPPORT', 'BILLING'] as const;
/* Staff's own notes stay out of the customer's security activity. */
const STAFF_ONLY = { customerLog: false };
const noteBody = z.object({
  body: z.string().trim().min(2, 'Write the note.').max(2000, 'Keep a note under 2,000 characters.'),
  pinned: z.boolean().optional(),
});
const notePatch = noteBody.partial();
/* A tag is a short label: letters, numbers, spaces and - & . / */
const tagBody = z.object({
  tag: z
    .string()
    .trim()
    .min(2, 'A tag needs two letters at least.')
    .max(30, 'Keep a tag under 30 characters.')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} &./-]*$/u, 'Use letters, numbers, spaces and - & . / only.')
    .transform((t) => t.replace(/\s+/g, ' ')),
});

const accountExists = (id: string) => platformPrisma.account.findUnique({ where: { id }, select: { id: true } });

async function authorNames(ids: string[]) {
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

/** The customer's notes, pinned first then newest, and its tags. */
opsNotesRouter.get('/ops/accounts/:id/notes', (req, res) =>
  outsideTenant('ops: customer notes', async () => {
    if (!(await accountExists(req.params.id))) return res.status(404).json({ error: 'No such customer.' });
    const [notes, tags] = await Promise.all([
      platformPrisma.accountNote.findMany({ where: { accountId: req.params.id }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 200 }),
      platformPrisma.accountTag.findMany({ where: { accountId: req.params.id }, orderBy: { tag: 'asc' } }),
    ]);
    const names = await authorNames(notes.map((n) => n.authorUserId));
    const me = req.auth!.userId;
    const owner = res.locals.operatorRole === 'SUPER_ADMIN';
    res.json({
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        pinned: n.pinned,
        author: names.get(n.authorUserId) || 'CLOR staff',
        mine: n.authorUserId === me,
        mayChange: n.authorUserId === me || owner,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      tags: tags.map((t) => t.tag),
    });
  }),
);

opsNotesRouter.post('/ops/accounts/:id/notes', requireOperatorRole(...WRITERS), (req, res) =>
  outsideTenant('ops: add a customer note', async () => {
    const parsed = noteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Write the note.', code: 'INVALID' });
    if (!(await accountExists(req.params.id))) return res.status(404).json({ error: 'No such customer.' });
    const note = await platformPrisma.accountNote.create({ data: { accountId: req.params.id, body: parsed.data.body, pinned: Boolean(parsed.data.pinned), authorUserId: req.auth!.userId } });
    await audit(req, 'CUSTOMER_NOTE_ADDED', { accountId: req.params.id }, { noteId: note.id, pinned: note.pinned }, STAFF_ONLY);
    res.status(201).json({ note: { id: note.id } });
  }),
);

async function ownNote(req: any, res: any) {
  const note = await platformPrisma.accountNote.findFirst({ where: { id: req.params.noteId, accountId: req.params.id } });
  if (!note) {
    res.status(404).json({ error: 'No such note.' });
    return null;
  }
  if (note.authorUserId !== req.auth!.userId && res.locals.operatorRole !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Only whoever wrote a note, or the owner, can change it.', code: 'NOT_YOUR_NOTE' });
    return null;
  }
  return note;
}

opsNotesRouter.patch('/ops/accounts/:id/notes/:noteId', requireOperatorRole(...WRITERS), (req, res) =>
  outsideTenant('ops: change a customer note', async () => {
    const parsed = notePatch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the note.', code: 'INVALID' });
    const note = await ownNote(req, res);
    if (!note) return;
    await platformPrisma.accountNote.update({ where: { id: note.id }, data: parsed.data });
    await audit(req, 'CUSTOMER_NOTE_CHANGED', { accountId: req.params.id }, { noteId: note.id, ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}) }, STAFF_ONLY);
    res.json({ ok: true });
  }),
);

opsNotesRouter.delete('/ops/accounts/:id/notes/:noteId', requireOperatorRole(...WRITERS), (req, res) =>
  outsideTenant('ops: remove a customer note', async () => {
    const note = await ownNote(req, res);
    if (!note) return;
    await platformPrisma.accountNote.delete({ where: { id: note.id } });
    await audit(req, 'CUSTOMER_NOTE_REMOVED', { accountId: req.params.id }, { noteId: note.id }, STAFF_ONLY);
    res.json({ ok: true });
  }),
);

opsNotesRouter.post('/ops/accounts/:id/tags', requireOperatorRole(...WRITERS), (req, res) =>
  outsideTenant('ops: tag a customer', async () => {
    const parsed = tagBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the tag.', code: 'INVALID' });
    if (!(await accountExists(req.params.id))) return res.status(404).json({ error: 'No such customer.' });
    /* One spelling per tag across customers: reuse an existing one whatever its case. */
    const known = await platformPrisma.accountTag.findFirst({ where: { tag: { equals: parsed.data.tag, mode: 'insensitive' } }, select: { tag: true } });
    const tag = known?.tag || parsed.data.tag;
    const had = await platformPrisma.accountTag.findFirst({ where: { accountId: req.params.id, tag }, select: { id: true } });
    if (had) return res.json({ ok: true, tag });
    if ((await platformPrisma.accountTag.count({ where: { accountId: req.params.id } })) >= 20) return res.status(400).json({ error: 'A customer can carry 20 tags at most.', code: 'TOO_MANY_TAGS' });
    await platformPrisma.accountTag.create({ data: { accountId: req.params.id, tag, addedByUserId: req.auth!.userId } });
    await audit(req, 'CUSTOMER_TAGGED', { accountId: req.params.id }, { tag }, STAFF_ONLY);
    res.status(201).json({ ok: true, tag });
  }),
);

opsNotesRouter.delete('/ops/accounts/:id/tags/:tag', requireOperatorRole(...WRITERS), (req, res) =>
  outsideTenant('ops: untag a customer', async () => {
    const tag = String(req.params.tag || '');
    const { count } = await platformPrisma.accountTag.deleteMany({ where: { accountId: req.params.id, tag } });
    if (count) await audit(req, 'CUSTOMER_UNTAGGED', { accountId: req.params.id }, { tag }, STAFF_ONLY);
    res.json({ ok: true });
  }),
);

/** Every tag in use, with how many customers carry it: the filter on the customers list. */
opsNotesRouter.get('/ops/tags', (_req, res) =>
  outsideTenant('ops: tags in use', async () => {
    const rows = await platformPrisma.accountTag.groupBy({ by: ['tag'], _count: { _all: true }, orderBy: { tag: 'asc' } });
    res.json({ tags: rows.map((r) => ({ tag: r.tag, customers: r._count._all })) });
  }),
);

import { Router, urlencoded } from 'express';

import { enterTenant, outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { applyLimiter } from '../middleware/rateLimit.js';
import { TalentError, applyFromLink, openingByToken } from '../services/people/talent/hiring.js';

/**
 * A job opening's public apply page (Talent, TALENT-DECISIONS.md): the link HR shares on
 * WhatsApp or a job site. No sign-in; the token is kept only as its sha256 and works while the
 * opening is open and its link is on. Name, e-mail or phone, a résumé link and a note; no file
 * upload from strangers. A hidden field catches bots; a few applications an hour per address.
 */
export const peopleTalentApplyRouter = Router();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
  `<style>body{font-family:Inter,system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#1a1d3d}label{display:block;margin:.9rem 0 .25rem;font-size:.875rem;font-weight:600}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.55rem .7rem;border:1px solid #d0cdde;border-radius:8px}button{margin-top:1.2rem;font:inherit;padding:.65rem 1.2rem;border-radius:8px;border:0;background:#232a66;color:#fff;cursor:pointer}.muted{color:#484d78}.trap{position:absolute;left:-9999px}</style>` +
  `<body>${body}</body>`;

async function findOpening(token: string) {
  const o = await outsideTenant('apply link: find the opening', () => openingByToken(token));
  if (!o) return null;
  enterTenant(o.orgId);
  const org = await platformPrisma.org.findUnique({ where: { id: o.orgId }, select: { name: true } });
  return { o, orgName: org?.name || '' };
}

const form = (title: string, orgName: string, description: string | null, error = '', values: Record<string, string> = {}) => page(`${title} at ${orgName}`, `
  <h1 style="font-size:1.35rem;margin:0">${esc(title)}</h1><p class="muted">${esc(orgName)}</p>
  ${description ? `<p style="white-space:pre-line">${esc(description)}</p>` : ''}
  ${error ? `<p role="alert" style="color:#b91c1c">${esc(error)}</p>` : ''}
  <form method="post">
    <label for="name">Your name *</label><input id="name" name="name" required maxlength="120" value="${esc(values.name || '')}">
    <label for="email">E-mail</label><input id="email" name="email" type="email" maxlength="200" value="${esc(values.email || '')}">
    <label for="phone">Phone</label><input id="phone" name="phone" inputmode="tel" maxlength="40" value="${esc(values.phone || '')}">
    <label for="resumeUrl">Link to your résumé (optional)</label><input id="resumeUrl" name="resumeUrl" type="url" placeholder="https://" maxlength="500" value="${esc(values.resumeUrl || '')}">
    <label for="note">Anything you want them to know (optional)</label><textarea id="note" name="note" rows="4" maxlength="2000">${esc(values.note || '')}</textarea>
    <div class="trap" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
    <p class="muted" style="font-size:.8rem">Give an e-mail or a phone number. ${esc(orgName)} uses what you send only to consider you for this job, and clears it within a year if you are not taken on.</p>
    <button type="submit">Send application</button>
  </form>`);

peopleTalentApplyRouter.get('/people/apply/:token', async (req, res) => {
  const found = await findOpening(String(req.params.token || ''));
  if (!found || !found.o.applyOpen || found.o.status !== 'OPEN') return res.status(410).type('html').send(page('Not taking applications', '<h1 style="font-size:1.25rem">This job is not taking applications</h1><p class="muted">It may have been filled or closed.</p>'));
  res.type('html').send(form(found.o.title, found.orgName, found.o.description));
});

peopleTalentApplyRouter.post('/people/apply/:token', ...applyLimiter, urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const found = await findOpening(String(req.params.token || ''));
  if (!found || !found.o.applyOpen || found.o.status !== 'OPEN') return res.status(410).type('html').send(page('Not taking applications', '<h1 style="font-size:1.25rem">This job is not taking applications</h1>'));
  const b = (req.body || {}) as Record<string, string>;
  const thanks = page('Application sent', `<h1 style="font-size:1.25rem">Thank you</h1><p>${esc(found.orgName)} has your application for ${esc(found.o.title)} and will contact you.</p>`);
  /* A bot filled the hidden field: say thanks and keep nothing. */
  if (String(b.website || '').trim()) return res.type('html').send(thanks);
  try {
    /* The company found by the token, held for the write: enterTenant inside findOpening does not reach back out to this handler, and the policies fail closed. */
    await runInTenant(found.o.orgId, () => applyFromLink(found.o, b));
    res.type('html').send(thanks);
  } catch (e) {
    if (e instanceof TalentError) return res.status(e.status === 410 ? 410 : 400).type('html').send(form(found.o.title, found.orgName, found.o.description, e.message, b));
    console.error('[apply]', e instanceof Error ? e.message : e);
    res.status(500).type('html').send(page('Not sent', '<p>Something went wrong. Try again in a little while.</p>'));
  }
});
